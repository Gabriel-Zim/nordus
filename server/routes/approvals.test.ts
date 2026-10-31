import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { APPROVAL_TTL_MS, PLAIN_DECLINE_REASON, approvalId, decidableOutsideCard, type ApprovalItem } from "../../shared/approvals.ts";
import { createActionTokens, ownerOfRequest } from "../approval-push.ts";
import { createApprovalSettings } from "../approval-settings.ts";
import { createApprovalsIndex, type ApprovalsStore } from "../approvals-index.ts";
import type { RequestAuth } from "../request-auth.ts";
import type { VisibleSet } from "../bot-visibility.ts";
import type { Scope, SessionRecord } from "../sessions.ts";
import type { Message, StoreChange } from "../store.ts";
import { createApprovalRoutes, type ApprovalRoutesDeps } from "./approvals.ts";
import { PASS, type RouteContext } from "./table.ts";

const NOW = 1_700_000_000_000;
const BOTS = [
  { id: "atlas", name: "Atlas", color: "#4f46e5", owner: "rafael@example.test", threadId: "t-atlas" },
  { id: "pepper", name: "Pepper", color: "#16a34a", threadId: "t-pepper" },
];

const loopback: RequestAuth = { kind: "loopback", scopes: ["admin", "client"] };
const session = (id: string, email: string, scopes: Scope[] = ["client"]): RequestAuth => ({
  kind: "session", via: "cookie", scopes, session: { id, label: id, scopes, email } as unknown as SessionRecord,
});
const rafael = session("s-rafael", "rafael@example.test");
const ada = session("s-ada", "ada@example.test");

const permission = (id: string, extra: Partial<NonNullable<Message["card"]>> = {}): Message => ({
  id, role: "bot", kind: "options", at: NOW,
  card: { title: "Permission", subtitle: "echo hi", options: ["Allow", "Deny"], requestId: `req-${id}`, tool: "bash", intent: "Rodar um comando", ...extra },
});

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function world(options: { answer?: (threadId: string, body: any) => { status: number; body: Record<string, unknown> }; canAnswer?: (auth: RequestAuth) => boolean; now?: () => number } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "nordus-approvals-routes-"));
  dirs.push(dir);
  const threads = new Map<string, Message[]>();
  const listeners = new Set<(change: StoreChange) => void>();
  const appended: Array<{ threadId: string; message: Omit<Message, "id" | "at"> }> = [];
  const store: ApprovalsStore & { patchMessage: ApprovalRoutesDeps["store"]["patchMessage"]; add(threadId: string, message: Message): void } = {
    onChange: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    messagesFor: (threadId) => threads.get(threadId) ?? [],
    bot: (id) => BOTS.find((bot) => bot.id === id),
    botByThread: (threadId) => BOTS.find((bot) => bot.threadId === threadId),
    groupByThread: () => undefined,
    add(threadId, message) {
      threads.set(threadId, [...(threads.get(threadId) ?? []), message]);
      for (const listener of listeners) listener({ type: "message", threadId, message });
    },
    patchMessage(threadId, messageId, patch) {
      const list = threads.get(threadId) ?? [];
      const at = list.findIndex((message) => message.id === messageId);
      list[at] = { ...list[at]!, ...patch } as Message;
      for (const listener of listeners) listener({ type: "message.patch", threadId, message: list[at]! });
      return list[at];
    },
  };
  const index = createApprovalsIndex({ store, ttlMs: () => APPROVAL_TTL_MS, nameOf: (email) => (email === "rafael@example.test" ? "Rafael" : undefined) });
  index.start([]);
  const settings = createApprovalSettings(dir);
  const tokens = createActionTokens({ now: options.now });
  const answered: Array<{ threadId: string; body: any; auth: RequestAuth }> = [];
  const dispatch: ApprovalRoutesDeps["dispatch"] = async (ctx) => {
    const threadId = /\/api\/threads\/([\w-]+)\/respond/.exec(ctx.path)![1]!;
    const body = await ctx.readBody(ctx.req, 1_000);
    answered.push({ threadId, body, auth: ctx.auth });
    const reply = options.answer?.(threadId, body) ?? { status: 200, body: { ok: true, outcome: "delivered" } };
    const res = ctx.res as unknown as { writeHead(code: number): void; end(data: string): void };
    res.writeHead(reply.status);
    res.end(JSON.stringify(reply.body));
    return true;
  };
  const deps: ApprovalRoutesDeps = {
    index,
    tokens,
    settings,
    visibleFor: (auth) => ({
      bot: (id: string) => auth.kind === "loopback" || auth.scopes.includes("admin") || (auth.session.email === "ada@example.test" ? id === "pepper" : true),
      thread: () => true,
      group: () => true,
    }) as unknown as VisibleSet,
    refusal: (auth) => (options.canAnswer && !options.canAnswer(auth) ? "Only the person who started this conversation can answer." : null),
    dispatch,
    personName: (auth) => (auth.kind === "session" ? auth.session.email?.split("@")[0] ?? "Alguém" : "Avery"),
    lessons: {
      appendMessage(threadId, message) {
        appended.push({ threadId, message });
        const made = { ...message, id: `lesson-${appended.length}`, at: NOW } as Message;
        store.add(threadId, made);
        return made;
      },
    },
    store: { messagesFor: store.messagesFor, patchMessage: store.patchMessage },
  };
  const handler = createApprovalRoutes(deps);

  async function call(method: string, path: string, auth: RequestAuth, body?: unknown) {
    const out: { status?: number; value?: any; headers: Record<string, string> } = { headers: {} };
    const res = { setHeader: (name: string, value: string) => { out.headers[name] = value; }, headersSent: false, writableEnded: false } as unknown as RouteContext["res"];
    const verdict = await handler({
      req: { headers: {} } as RouteContext["req"], res, url: new URL(`http://x${path}`), path, method, auth,
      json: ((_res: unknown, status: number, value: unknown) => { out.status = status; out.value = value; }) as RouteContext["json"],
      readBody: (async () => body) as RouteContext["readBody"],
    });
    return verdict === PASS ? ({ pass: true } as const) : { pass: false as const, ...out };
  }
  return { store, index, settings, tokens, answered, appended, call, dir };
}

const id = (messageId: string, threadId = "t-atlas") => approvalId(threadId, messageId);

describe("GET /api/approvals", () => {
  it("lists what waits, cut by what the person asking is shown", async () => {
    const w = world();
    w.store.add("t-atlas", permission("a"));
    w.store.add("t-pepper", permission("p"));
    const everyone = await w.call("GET", "/api/approvals", loopback);
    expect(everyone).toMatchObject({ status: 200, headers: { "cache-control": "no-store" } });
    expect((everyone as any).value.items.map((item: any) => item.id).sort()).toEqual([id("a"), id("p", "t-pepper")].sort());
    const asAda = await w.call("GET", "/api/approvals", ada);
    expect((asAda as any).value.items.map((item: any) => item.id)).toEqual([id("p", "t-pepper")]);
    expect((asAda as any).value.items[0]).toMatchObject({ canDecide: false, decider: "Administradores", kind: "permission" });
  });

  it("says who may decide each one", async () => {
    const w = world();
    w.store.add("t-atlas", permission("a"));
    const asOwner = await w.call("GET", "/api/approvals", rafael);
    expect((asOwner as any).value.items[0]).toMatchObject({ canDecide: true, decider: "Rafael" });
    const asOther = await w.call("GET", "/api/approvals", session("s-lia", "lia@example.test"));
    expect((asOther as any).value.items[0]).toMatchObject({ canDecide: false, decider: "Rafael" });
  });

  it("answers nothing but a read, and passes every other address on", async () => {
    const w = world();
    expect(await w.call("POST", "/api/approvals", loopback)).toMatchObject({ status: 405 });
    expect(await w.call("GET", "/api/threads", loopback)).toEqual({ pass: true });
    expect(await w.call("GET", `/api/approvals/${id("a")}`, loopback)).toEqual({ pass: true });
  });
});

describe("approving and declining from the list", () => {
  it("approves through the answer route, as the same person", async () => {
    const w = world();
    w.store.add("t-atlas", permission("a"));
    const done = await w.call("POST", `/api/approvals/${id("a")}/approve`, rafael, {});
    expect(done).toMatchObject({ status: 200, value: { ok: true, outcome: "delivered" } });
    expect(w.answered).toEqual([{ threadId: "t-atlas", body: { requestId: "req-a", behavior: "allow" }, auth: rafael }]);
  });

  it("declines with the plain reason when no one says why, and teaches nothing", async () => {
    const w = world();
    w.store.add("t-atlas", permission("a"));
    const done = await w.call("POST", `/api/approvals/${id("a")}/decline`, rafael, {});
    expect(done).toMatchObject({ status: 200 });
    expect(w.answered[0]!.body).toEqual({ requestId: "req-a", behavior: "deny", message: PLAIN_DECLINE_REASON });
    expect(w.appended).toEqual([]);
    expect((done as any).value.lesson).toBeUndefined();
  });

  it("sends a reason to the agent and proposes it as a lesson, marked as from the refusal", async () => {
    const w = world();
    w.store.add("t-atlas", permission("a", { intent: "Publicar a página" }));
    const done = await w.call("POST", `/api/approvals/${id("a")}/decline`, rafael, { reason: "  ainda falta revisar o título  " });
    expect(done).toMatchObject({ status: 200, value: { ok: true, lesson: { requestId: expect.any(String), messageId: "lesson-1" } } });
    expect(w.answered[0]!.body).toEqual({ requestId: "req-a", behavior: "deny", message: "ainda falta revisar o título" });
    expect(w.appended).toHaveLength(1);
    expect(w.appended[0]!.message).toMatchObject({
      kind: "options",
      card: { tool: "propose_lesson", options: ["Make it a rule", "Discard"], approval: { fromRefusal: true }, lessonRequest: { lesson: "ainda falta revisar o título (rafael recusou “Publicar a página”)" } },
    });
    expect(w.store.messagesFor("t-atlas").find((message) => message.id === "a")?.card?.approval?.declinedWhy).toBe("ainda falta revisar o título");
    expect(w.index.items({ who: { admin: true }, visible: { bot: () => true, thread: () => true, group: () => true } }).map((item) => [item.kind, item.messageId]))
      .toContainEqual(["lesson", "lesson-1"]);
  });

  it("keeps a reason on a lesson that is declined, without teaching anyone about it", async () => {
    const w = world();
    w.store.add("t-atlas", permission("l", { lessonRequest: { lesson: "Pergunte antes" }, tool: "propose_lesson" }));
    const done = await w.call("POST", `/api/approvals/${id("l")}/decline`, rafael, { reason: "não é verdade" });
    expect(done).toMatchObject({ status: 200 });
    expect(w.appended).toEqual([]);
    expect(w.store.messagesFor("t-atlas")[0]?.card?.approval?.declinedWhy).toBe("não é verdade");
  });

  it("refuses a card the person is not shown, and one that does not exist, with the same words", async () => {
    const w = world();
    w.store.add("t-atlas", permission("a"));
    const hidden = await w.call("POST", `/api/approvals/${id("a")}/approve`, ada, {});
    const missing = await w.call("POST", `/api/approvals/${id("nope")}/approve`, ada, {});
    expect(hidden).toMatchObject({ status: 404 });
    expect(hidden).toEqual(missing);
    expect(w.answered).toEqual([]);
  });

  it("refuses someone who may see it but not decide it, naming who does", async () => {
    const w = world();
    w.store.add("t-atlas", permission("a"));
    const done = await w.call("POST", `/api/approvals/${id("a")}/approve`, session("s-lia", "lia@example.test"), {});
    expect(done).toMatchObject({ status: 403, value: { error: "Quem decide aqui é Rafael." } });
    expect(w.answered).toEqual([]);
  });

  it("refuses what the answer route would refuse", async () => {
    const w = world({ canAnswer: () => false });
    w.store.add("t-atlas", permission("a"));
    expect(await w.call("POST", `/api/approvals/${id("a")}/approve`, loopback, {})).toMatchObject({ status: 403 });
    expect(w.answered).toEqual([]);
  });

  it("sends a card that has to be read first back to its conversation", async () => {
    const w = world();
    w.store.add("t-atlas", permission("s", { skillRequest: { name: "Resumo", gist: "x" } as never }));
    const done = await w.call("POST", `/api/approvals/${id("s")}/approve`, loopback, {});
    expect(done).toMatchObject({ status: 409, value: { code: "open-the-card" } });
    expect(w.answered).toEqual([]);
  });

  it("passes on what the answer route says when it refuses, and says plainly when the request is gone", async () => {
    const refused = world({ answer: () => ({ status: 403, body: { error: "Nope." } }) });
    refused.store.add("t-atlas", permission("a"));
    expect(await refused.call("POST", `/api/approvals/${id("a")}/approve`, loopback, {})).toMatchObject({ status: 403, value: { error: "Nope." } });
    const gone = world({ answer: () => ({ status: 200, body: { outcome: "unavailable" } }) });
    gone.store.add("t-atlas", permission("a"));
    expect(await gone.call("POST", `/api/approvals/${id("a")}/approve`, loopback, {})).toMatchObject({ status: 409, value: { outcome: "unavailable" } });
    const broken = world({ answer: () => ({ status: 500, body: {} }) });
    broken.store.add("t-atlas", permission("a"));
    expect(await broken.call("POST", `/api/approvals/${id("a")}/approve`, loopback, {})).toMatchObject({ status: 500, value: { error: expect.any(String) } });
  });

  it("never lets a bot's own shell, which reaches the server as a service caller, decide anything", async () => {
    const w = world();
    w.store.add("t-atlas", permission("a"));
    const shell: RequestAuth = { kind: "loopback", scopes: ["admin", "client"], trust: "service" };
    expect(await w.call("POST", `/api/approvals/${id("a")}/approve`, shell, {})).toMatchObject({ status: 403 });
    expect(w.answered).toEqual([]);
  });

  it("takes only a POST", async () => {
    const w = world();
    w.store.add("t-atlas", permission("a"));
    expect(await w.call("GET", `/api/approvals/${id("a")}/approve`, loopback)).toMatchObject({ status: 405 });
  });
});

describe("approving from a phone's banner", () => {
  const tap = (w: ReturnType<typeof world>, messageId: string, action: "approve" | "decline", auth: RequestAuth, token: string) =>
    w.call("POST", `/api/approvals/${id(messageId)}/${action}`, auth, { token });
  const issue = (w: ReturnType<typeof world>, messageId: string, owner: string) => w.tokens.issue({ approvalId: id(messageId), owner });

  it("decides once with a token for that approval and that device, and not twice", async () => {
    const w = world();
    w.store.add("t-atlas", permission("a"));
    const token = issue(w, "a", "s-rafael");
    expect(await tap(w, "a", "approve", rafael, token)).toMatchObject({ status: 200 });
    expect(w.answered).toHaveLength(1);
    expect(await tap(w, "a", "approve", rafael, token)).toMatchObject({ status: 403, value: { code: "token-unknown" } });
    expect(w.answered).toHaveLength(1);
  });

  it("declines with the token too", async () => {
    const w = world();
    w.store.add("t-atlas", permission("a"));
    expect(await tap(w, "a", "decline", rafael, issue(w, "a", "s-rafael"))).toMatchObject({ status: 200 });
    expect(w.answered[0]!.body).toMatchObject({ behavior: "deny", message: PLAIN_DECLINE_REASON });
  });

  it("is useless to another person, or for another approval, and is spent by trying", async () => {
    const w = world();
    w.store.add("t-atlas", permission("a"));
    w.store.add("t-atlas", permission("b"));
    const forRafael = issue(w, "a", "s-rafael");
    const asAdmin = session("s-boss", "boss@example.test", ["admin", "client"]);
    expect(await tap(w, "a", "approve", asAdmin, forRafael)).toMatchObject({ status: 403, value: { code: "token-wrong-person" } });
    expect(await tap(w, "a", "approve", rafael, forRafael)).toMatchObject({ status: 403, value: { code: "token-unknown" } });
    const forB = issue(w, "b", "s-rafael");
    expect(await tap(w, "a", "approve", rafael, forB)).toMatchObject({ status: 403, value: { code: "token-wrong-approval" } });
    expect(w.answered).toEqual([]);
  });

  it("never decides for someone who may not decide the card, token or not", async () => {
    const w = world();
    w.store.add("t-atlas", permission("a"));
    const lia = session("s-lia", "lia@example.test");
    expect(await tap(w, "a", "approve", lia, issue(w, "a", "s-lia"))).toMatchObject({ status: 403, value: { error: "Quem decide aqui é Rafael." } });
    expect(w.answered).toEqual([]);
  });

  it("runs out", async () => {
    let at = NOW;
    const w = world({ now: () => at });
    w.store.add("t-atlas", permission("a"));
    const token = issue(w, "a", "s-rafael");
    at += 31 * 60_000;
    expect(await tap(w, "a", "approve", rafael, token)).toMatchObject({ status: 403, value: { code: "token-expired" } });
    expect(w.answered).toEqual([]);
  });

  it("never approves a critical action, whoever holds the token: that takes the held button on the card", async () => {
    const w = world();
    w.store.add("t-atlas", permission("c", { heldCode: "approval.held.sensitive" }));
    const done = await tap(w, "c", "approve", rafael, issue(w, "c", "s-rafael"));
    expect(done).toMatchObject({ status: 403, value: { code: "critical" } });
    expect(w.answered).toEqual([]);
  });

  it("rejects a token that is not text", async () => {
    const w = world();
    w.store.add("t-atlas", permission("a"));
    expect(await w.call("POST", `/api/approvals/${id("a")}/approve`, rafael, { token: 7 })).toMatchObject({ status: 400 });
  });
});

describe("the wait", () => {
  it("is read by anyone who can reach the address, and changed only by an administrator", async () => {
    const w = world();
    expect(await w.call("GET", "/api/approvals/settings", loopback)).toMatchObject({ status: 200, value: { ttlMs: APPROVAL_TTL_MS } });
    expect(await w.call("PUT", "/api/approvals/settings", rafael, { ttlMs: 3_600_000 })).toMatchObject({ status: 403 });
    expect(w.settings.ttlMs()).toBe(APPROVAL_TTL_MS);
    expect(await w.call("PUT", "/api/approvals/settings", loopback, { ttlMs: 3_600_000 })).toMatchObject({ status: 200, value: { ttlMs: 3_600_000 } });
    expect(w.settings.ttlMs()).toBe(3_600_000);
  });

  it("must be a number, and stays within what makes sense", async () => {
    const w = world();
    for (const bad of [{}, { ttlMs: "soon" }, { ttlMs: null }, { ttlMs: Number.POSITIVE_INFINITY }]) {
      expect(await w.call("PUT", "/api/approvals/settings", loopback, bad), JSON.stringify(bad)).toMatchObject({ status: 400 });
    }
    const low = await w.call("PUT", "/api/approvals/settings", loopback, { ttlMs: 1 });
    expect((low as any).value.ttlMs).toBe((low as any).value.minMs);
    expect(await w.call("DELETE", "/api/approvals/settings", loopback)).toMatchObject({ status: 405 });
  });
});

describe("answering without opening the card", () => {
  const cases: Array<[string, RequestAuth, string, string, Partial<NonNullable<Message["card"]>>]> = [
    ["a plain request, for the agent's owner", rafael, "t-atlas", "a", {}],
    ["a plain request, for the machine's owner", loopback, "t-atlas", "a", {}],
    ["a critical action, for the agent's owner", rafael, "t-atlas", "a", { heldCode: "approval.held.sensitive", subtitle: "git push origin main" }],
    ["a request that has to be read first", rafael, "t-atlas", "a", { skillRequest: { name: "Brief" } as never }],
    ["a request the person may not answer", ada, "t-pepper", "p", {}],
    ["a request the person is not shown", ada, "t-atlas", "a", {}],
  ];

  it.each(cases)("is answered by the list and by a banner's button exactly when decidableOutsideCard says so: %s", async (_name, caller, threadId, messageId, extra) => {
    for (const surface of ["list", "banner"] as const) {
      const w = world();
      w.store.add(threadId, permission(messageId, extra));
      const listed = ((await w.call("GET", "/api/approvals", caller)) as any).value.items as ApprovalItem[];
      const shown = listed.find((candidate) => candidate.id === id(messageId, threadId));
      const body = surface === "banner" ? { token: w.tokens.issue({ approvalId: id(messageId, threadId), owner: ownerOfRequest(caller as never) }) } : {};
      const answer = await w.call("POST", `/api/approvals/${id(messageId, threadId)}/approve`, caller, body);
      const accepted = (answer as any).status === 200;
      expect(accepted, `${surface}: ${JSON.stringify((answer as any).value)}`).toBe(shown ? decidableOutsideCard(shown, surface) : false);
    }
  });
});
