// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";
import { restoreComposerDraft } from "@/lib/drafts";

const fixture = vi.hoisted(() => ({ dispatch: vi.fn() }));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({
    state: { ...original.initialState, bots: [bot], instances: [] },
    dispatch: fixture.dispatch,
  }) };
});
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => false }));
vi.mock("./CallView", () => ({ CallButton: () => null }));

import { sendOutbox } from "@/lib/app-outbox";
import { Composer } from "./Composer";

const bot: Bot = {
  id: "new-bot", threadId: "new-thread", name: "Atlas", title: "", description: "",
  color: "blue", notifications: false, unread: false, busy: false, messages: [],
  modelSelection: { instanceId: "fake", model: "fake" },
};
const draftId = `bot:${bot.id}:${bot.threadId}`;

describe("/new no compositor", () => {
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
    for (const entry of sendOutbox.entries()) sendOutbox.cancel(entry.sendId);
    flushSync(() => root.unmount());
    container.remove();
    restoreComposerDraft(draftId, { text: "", attachments: [] });
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const queued = () => sendOutbox.entries().filter((entry) => entry.draftId === draftId);

  function fill(text: string) {
    flushSync(() => restoreComposerDraft(draftId, { text, attachments: [] }));
    const input = container.querySelector("textarea")!;
    input.setSelectionRange(text.length, text.length);
    flushSync(() => input.dispatchEvent(new KeyboardEvent("keyup", { key: "a", bubbles: true })));
    return input;
  }

  function press(input: HTMLTextAreaElement, key: string) {
    flushSync(() => input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })));
  }

  it("oferece /new na lista de comandos e, escolhido, abre uma conversa nova sem mandar mensagem", () => {
    const input = fill("/ne");
    expect(container.querySelector('[role="listbox"]')?.textContent).toContain("/new");
    press(input, "Enter");
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "newTask", botId: bot.id });
    expect(input.value).toBe("");
    expect(queued()).toEqual([]);
  });

  it("/new digitado inteiro e enviado também abre a conversa nova, sem virar mensagem", () => {
    const input = fill("/new ");
    press(input, "Enter");
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "newTask", botId: bot.id });
    expect(input.value).toBe("");
    expect(queued()).toEqual([]);
  });
});
