// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, Message } from "@/state/store";
import { restoreComposerDraft } from "@/lib/drafts";

const fixture = vi.hoisted(() => ({ dispatch: vi.fn() }));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({
    state: { ...original.initialState, bots: [bot], instances: [{
      instanceId: "fake", driverKind: "claude", displayName: "Fake",
      capabilities: { agentsMcp: true },
    }] },
    dispatch: fixture.dispatch,
  }) };
});
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => false }));
vi.mock("./CallView", () => ({ CallButton: () => null }));

import { sendOutbox } from "@/lib/app-outbox";
import { Composer } from "./Composer";

const waitingApproval: Message = {
  id: "approval-1", role: "bot", kind: "options", at: 1,
  card: { title: "Approval needed", subtitle: "pnpm test", options: ["Allow", "Deny"], requestId: "req-1", tool: "Bash", intent: "rodar os testes" },
};
const bot: Bot = {
  id: "approval-bot", threadId: "approval-thread", name: "Programador", title: "", description: "",
  color: "blue", notifications: false, unread: false, busy: true, messages: [waitingApproval],
  modelSelection: { instanceId: "fake", model: "fake" },
};
const draftId = `bot:${bot.id}:${bot.threadId}`;

describe("the composer while a bot waits for an approval", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(() => {});
    restoreComposerDraft(draftId, { text: "", attachments: [] });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    flushSync(() => root.render(createElement(Composer, { bot, onEditLast: vi.fn() })));
  });

  afterEach(() => {
    flushSync(() => root.unmount());
    container.remove();
    restoreComposerDraft(draftId, { text: "", attachments: [] });
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("stays open for typing, as for any busy bot, and shows no approval strip", () => {
    const input = container.querySelector("textarea")!;
    expect(input.disabled).toBe(false);
    expect(input.placeholder).not.toMatch(/approval/i);
    expect(container.querySelector('[role="region"]')).toBeNull();
    expect(container.textContent).not.toContain("Allow once");
  });

  it("queues a message sent meanwhile like any busy bot", () => {
    flushSync(() => restoreComposerDraft(draftId, { text: "e depois confere o resultado", attachments: [] }));
    const input = container.querySelector("textarea")!;
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(sendOutbox.entries()).toContainEqual(expect.objectContaining({
      target: { kind: "bot", botId: bot.id }, threadId: bot.threadId, requestText: "e depois confere o resultado",
    }));
  });
});
