import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { Bot, InstanceInfo, Message } from "@/state/store";

const fixture = vi.hoisted(() => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  return { bots: [] as Bot[] };
});
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({
    state: { ...original.initialState, bots: fixture.bots, instances: [{ instanceId: "test", driverKind: "codex", displayName: "Test" } as InstanceInfo] },
    dispatch: vi.fn(),
  }) };
});
vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: { dictation: { available: false }, host: { packaged: true, platform: "other" }, localComputer: { available: false } }, ready: true }),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/thread-preferences", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/thread-preferences")>(),
  useShowThreads: () => false,
}));
vi.mock("./ModelPicker", () => ({ ModelPicker: () => null }));

const { ChatView } = await import("./ChatView");
afterAll(() => vi.unstubAllGlobals());

const TITLE = "Lumon · Carrossel Built to Endure";
const OWN_OPENING = "[Thread you opened yourself from #DesignerGrafico, preciso de um carrossel da Lumon para o …. The request below is your own words, not the person's: do the work here and end with a clear result they can read.]\n\nPedido do QG";

const lia: Bot = {
  id: "lia", threadId: "lia-main", name: "LIA", title: "", description: "", color: "blue",
  notifications: true, unread: false, busy: false, messages: [], modelSelection: { instanceId: "test", model: "m" },
};
const designergrafico = (opening: Message, openedBy = { botId: "designergrafico", name: "DESIGNERGRAFICO", at: 2 }): Bot => ({
  id: "designergrafico", threadId: "task", mainThreadId: "main", name: "DESIGNERGRAFICO", title: "", description: "", color: "pink",
  notifications: true, unread: false, busy: false, messages: [opening], activeLeafId: opening.id,
  modelSelection: { instanceId: "test", model: "m" },
  tasks: [
    { threadId: "main", title: "Main", createdAt: 1 },
    { threadId: "task", title: TITLE, createdAt: 2, openedBy },
  ],
});
const render = (bot: Bot) => {
  fixture.bots = [bot, lia];
  return renderToStaticMarkup(createElement(ChatView, { bot }));
};

describe("the top of a thread away from the main conversation", () => {
  it("shows the task title, not a bot-to-bot pill with the same bot on both sides, for a task the bot opened on itself", () => {
    const markup = render(designergrafico({ id: "o1", role: "user", kind: "text", at: 2, text: OWN_OPENING, peerAsk: { botId: "designergrafico", name: "DESIGNERGRAFICO" } }));
    expect(markup).not.toContain("data-peer-conversation");
    expect(markup).not.toContain("data-close-peer-conversation");
    expect(markup).not.toContain("DESIGNERGRAFICO asked, DESIGNERGRAFICO replies");
    expect(markup).toMatch(new RegExp(`data-task-conversation="[^"]*"[\\s\\S]*${TITLE}`));
  });

  it("keeps the pill for a handoff between two different bots", () => {
    const markup = render(designergrafico(
      { id: "a1", role: "user", kind: "text", at: 2, text: "Check the export", peerAsk: { botId: "lia", name: "LIA" } },
      { botId: "lia", name: "LIA", at: 2 },
    ));
    expect(markup).toContain("data-peer-conversation");
    expect(markup).toContain('aria-label="LIA asked, DESIGNERGRAFICO replies"');
    expect(markup).not.toContain("data-task-conversation");
  });
});
