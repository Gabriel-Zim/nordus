// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Action, AppState, Bot, InstanceInfo, Message } from "@/state/store";

vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: { dictation: { available: false }, host: { packaged: true, platform: "other" }, localComputer: { available: false } }, ready: true }),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/cloud-guest", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/cloud-guest")>(),
  useCanWriteIn: () => true,
}));
vi.mock("./ModelPicker", () => ({ ModelPicker: () => null }));

const { ChatView } = await import("./ChatView");
const { BotEditorStore, initialState } = await import("@/state/store");
const { t } = await import("@/lib/i18n");

const line = (id: string, role: Message["role"], at: number, parentId?: string): Message =>
  ({ id, role, kind: "text", text: `${id} text`, at, parentId });

const bot: Bot = {
  id: "scout", threadId: "scout-thread", name: "Scout", title: "", description: "", color: "green",
  notifications: false, unread: false, busy: false,
  messages: [line("m1", "user", 1), line("m2", "bot", 2, "m1")],
  activeLeafId: "m2",
  hasMore: true,
  modelSelection: { instanceId: "test", model: "m" },
  tasks: [{ threadId: "scout-thread", title: "Thread", createdAt: 1, busy: false, activity: "idle", unread: false, approvalMode: "ask" }],
};

const dispatched: Action[] = [];
let state: AppState;
let root: Root;
let host: HTMLDivElement;

const draw = () => {
  const value = {
    state,
    dispatch: (action: Action) => { dispatched.push(action); },
    flushBotPatches: async () => null,
    refreshInstances: async () => {},
    refreshModels: async () => {},
  };
  const children = createElement(ChatView, { bot: state.bots[0] });
  flushSync(() => root.render(createElement(BotEditorStore, { value, children })));
};

const retryButton = () =>
  [...host.querySelectorAll("button")].find((button) => button.textContent?.includes(t("chat.loadEarlier")));

beforeEach(() => {
  dispatched.length = 0;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  state = {
    ...initialState,
    connected: true,
    selectedId: "scout",
    bots: [bot],
    olderFailed: { "scout-thread": true },
    instances: [{ instanceId: "test", driverKind: "codex", displayName: "Test", snapshot: { state: "available" } } as InstanceInfo],
  };
  vi.stubGlobal("fetch", () => new Promise(() => {}));
});

afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("chat older-page retry", () => {
  it("shows the retry control instead of an invisible top sentinel", () => {
    draw();
    expect(host.textContent).toContain(t("chat.loadEarlierFailed"));
    expect(host.querySelector(".h-2.w-full")).toBeNull();
  });

  it("asks for the older page when the reader presses retry", () => {
    draw();
    const retry = retryButton();
    expect(retry).toBeDefined();
    flushSync(() => retry!.click());
    expect(dispatched).toContainEqual({ type: "loadOlderMessages", threadId: "scout-thread" });
  });
});
