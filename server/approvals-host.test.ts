import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Notification } from "../shared/notification.ts";
import { deciderOf } from "./approval-decider.ts";
import { createApprovalsHost } from "./approvals-host.ts";
import type { VisibleSet } from "./bot-visibility.ts";
import type { RequestAuth } from "./request-auth.ts";
import { PASS, type RouteHandler } from "./routes/table.ts";
import type { Message, StoreChange } from "./store.ts";

const NOW = 1_700_000_000_000;
const HOUR = 3_600_000;
const ATLAS = { id: "atlas", name: "Atlas", color: "#4f46e5", threadId: "t-atlas" };
const everything = { bot: () => true, thread: () => true, group: () => true } as unknown as VisibleSet;

let dataDir: string;
beforeEach(() => { dataDir = mkdtempSync(join(tmpdir(), "nordus-approvals-host-")); });
afterEach(() => { rmSync(dataDir, { recursive: true, force: true }); });

const waiting = (extra: Partial<NonNullable<Message["card"]>> = {}): Message => ({
  id: "m1", role: "bot", kind: "options", at: NOW - 25 * HOUR,
  card: { title: "Permission", subtitle: "pnpm build", options: ["Allow", "Deny"], requestId: "req-1", tool: "Bash", intent: "montar o site", approval: { expiresAt: NOW - HOUR }, ...extra },
});

function build(message: Message = waiting()) {
  const threads = new Map<string, Message[]>([[ATLAS.threadId, [message]]]);
  const listeners = new Set<(change: StoreChange) => void>();
  const store = {
    onChange(listener: (change: StoreChange) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    messagesFor: (threadId: string) => threads.get(threadId) ?? [],
    bot: (id: string) => (id === ATLAS.id ? ATLAS : undefined),
    botByThread: (threadId: string) => (threadId === ATLAS.threadId ? ATLAS : undefined),
    groupByThread: () => undefined,
    patchMessage(threadId: string, messageId: string, patch: Partial<Message>) {
      const found = threads.get(threadId)?.find((candidate) => candidate.id === messageId);
      if (found) Object.assign(found, patch);
    },
    appendMessage: vi.fn(),
  };
  const answers: Array<{ auth: RequestAuth; path: string; body: unknown }> = [];
  const respond: RouteHandler = async (ctx) => {
    if (!ctx.path.endsWith("/respond")) return PASS;
    answers.push({ auth: ctx.auth, path: ctx.path, body: await ctx.readBody(ctx.req) });
    return ctx.json(ctx.res, 200, { ok: true, outcome: "denied" });
  };
  const host = createApprovalsHost({
    store: store as never,
    dataDir,
    routes: [respond],
    visibleFor: () => everything,
    cardRefusal: () => null,
    sessions: { list: () => [], isLive: () => false },
    profile: () => undefined,
    personName: () => "Marina",
    recentLog: () => [],
    recordShown: vi.fn(),
    now: () => NOW,
  });
  host.index.start([{ threadId: ATLAS.threadId, messageId: message.id }]);
  return { host, answers };
}

describe("what runs out", () => {
  it("is declined as a local service, which can only decline, and never as the machine's owner", async () => {
    const { host, answers } = build();
    expect(await host.expiry.sweep()).toBe(1);
    expect(answers).toHaveLength(1);
    expect(answers[0]).toMatchObject({ path: "/api/threads/t-atlas/respond", body: { requestId: "req-1", behavior: "deny", message: "expirou" } });
    expect(answers[0]!.auth).toEqual({ kind: "loopback", scopes: ["client"], trust: "service" });
    expect(deciderOf(answers[0]!.auth)).toEqual({ admin: false });
  });
});

describe("the machine's own phone", () => {
  const banner: Notification = { kind: "approval", botId: "atlas", botName: "Atlas", threadId: "t-atlas", title: "x", body: "y", requestId: "req-1" };

  it("still gets Approve and Decline: it belongs to the owner, who decides, not to the local service", () => {
    const { host } = build(waiting({ approval: { expiresAt: NOW + HOUR } }));
    const decoration = host.decorate(banner, { owner: "loopback" });
    expect(decoration?.actions?.map((action) => action.action)).toEqual(["approve", "decline"]);
    expect(decoration?.approval?.token).toBeTruthy();
  });

  it("gets nothing for a phone that is not signed in", () => {
    const { host } = build(waiting({ approval: { expiresAt: NOW + HOUR } }));
    expect(host.decorate(banner, { owner: "session-gone" })).toBeUndefined();
  });
});
