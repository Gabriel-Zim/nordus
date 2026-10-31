// @vitest-environment happy-dom
// LUMON's conversation after asking DESIGNERGRAFICO for work: everything the two said to each other is one pill.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppState, Bot, InstanceInfo, Message } from "@/state/store";

vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: { dictation: { available: false }, host: { packaged: true, platform: "other" }, localComputer: { available: false } }, ready: true }),
  useCaptionChrome: () => ({}),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/cloud-guest", () => ({ useCanWriteIn: () => true, useReactor: () => "user" }));
vi.mock("./ModelPicker", () => ({ ModelPicker: () => null }));

const { ChatView } = await import("./ChatView");
const { BotEditorStore, initialState } = await import("@/state/store");
const { setAdvancedMode } = await import("@/lib/interface-mode");
const { t, setLocale } = await import("@/lib/i18n");

const at = new Date(2026, 9, 17, 9, 0).getTime();
const model = { instanceId: "test", model: "m" };

const bot = (id: string, name: string, messages: Message[] = [], extra: Partial<Bot> = {}): Bot => ({
  id, threadId: `${id}-main`, name, title: "", description: "", color: "green",
  notifications: true, unread: false, busy: false, messages, modelSelection: model,
  tasks: [{ threadId: `${id}-main`, title: "Principal", createdAt: 1, busy: false, activity: "idle", modelSelection: model, approvalMode: "ask" }],
  ...extra,
});
const line = (id: string, name: string, parentId: string | undefined): Message => ({
  id, parentId, at, role: "bot", kind: "activity", tool: { name, ok: true },
  from: { botId: "designergrafico", name: "DESIGNERGRAFICO", color: "green" }, threadRef: { botId: "designergrafico", threadId: "designergrafico-work", title: "@LUMON · work" },
});

const messages: Message[] = [{ id: "ask", at, role: "user", kind: "text", text: "Pede o carrossel à DESIGNERGRAFICO" }];
const chain = [
  ["sent", "Sent to DESIGNERGRAFICO"],
  ...[1, 2, 3, 4, 5].map((n) => [`needs${n}`, "DESIGNERGRAFICO needs your input: aprovação do orçamento"]),
  ...[1, 2, 3].map((n) => [`failed${n}`, "DESIGNERGRAFICO — failed: o motor caiu"]),
] as const;
for (const [id, name] of chain) messages.push(line(id, name, messages.at(-1)!.id));

function mount(state: AppState, children: React.ReactElement) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const value = { state, dispatch: vi.fn(), flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} };
  flushSync(() => root.render(createElement(BotEditorStore, { value, children })));
  return { container, unmount: () => { root.unmount(); container.remove(); } };
}

afterEach(() => {
  vi.unstubAllGlobals();
  setAdvancedMode(false);
  setLocale("pt-br");
});

describe("a conversation between two bots in the chat", () => {
  it.each([false, true])("is one pill that counts every line, with the detail only in the tooltip (advanced: %s)", (advanced) => {
    vi.stubGlobal("fetch", () => new Promise(() => {}));
    setLocale("pt-br");
    setAdvancedMode(advanced);
    const lumon = bot("lumon", "LUMON", messages, { activeLeafId: messages.at(-1)!.id });
    const state: AppState = {
      ...initialState, connected: true, selectedId: lumon.id, bots: [lumon, bot("designergrafico", "DESIGNERGRAFICO")],
      instances: [{ instanceId: "test", driverKind: "codex", displayName: "Test", snapshot: { state: "available" } } as InstanceInfo],
      config: { features: { showToolCalls: false }, rooms: { turnTimeoutMinutes: 30 } } as unknown as AppState["config"],
    };
    const mounted = mount(state, createElement(ChatView, { bot: lumon }));
    try {
      const chips = [...mounted.container.querySelectorAll("[data-thread-chip]")];
      expect(chips.map((chip) => chip.textContent)).toEqual([t("handoff.messages", { count: 9, name: "DESIGNERGRAFICO" })]);
      expect(chips[0]!.getAttribute("title")).toBe("DESIGNERGRAFICO falhou: o motor caiu");
      const text = mounted.container.textContent ?? "";
      for (const word of ["needs your input", "failed", "precisa de você", "falhou"]) expect(text).not.toContain(word);
    } finally {
      mounted.unmount();
    }
  });

  it("shows the files of every folded line under the pill, each once", () => {
    vi.stubGlobal("fetch", () => new Promise(() => {}));
    setLocale("pt-br");
    const withFiles: Message[] = [{ id: "ask2", at, role: "user", kind: "text", text: "Pede as artes à DESIGNERGRAFICO" }];
    const rows = [
      ["sent", "Sent to DESIGNERGRAFICO", undefined],
      ["r1", "DESIGNERGRAFICO replied", [{ kind: "image", path: "/tmp/arte-1.png" }, { kind: "image", path: "/tmp/arte-2.png" }]],
      ["r2", "DESIGNERGRAFICO replied", [{ kind: "image", path: "/tmp/arte-2.png" }, { kind: "image", path: "/tmp/arte-3.png" }]],
    ] as const;
    for (const [id, name, attachments] of rows) withFiles.push({ ...line(id, name, withFiles.at(-1)!.id), ...(attachments ? { attachments: [...attachments] } : {}) } as Message);
    const lumon = bot("lumon", "LUMON", withFiles, { activeLeafId: withFiles.at(-1)!.id });
    const state: AppState = {
      ...initialState, connected: true, selectedId: lumon.id, bots: [lumon, bot("designergrafico", "DESIGNERGRAFICO")],
      instances: [{ instanceId: "test", driverKind: "codex", displayName: "Test", snapshot: { state: "available" } } as InstanceInfo],
      config: { features: { showToolCalls: false }, rooms: { turnTimeoutMinutes: 30 } } as unknown as AppState["config"],
    };
    const mounted = mount(state, createElement(ChatView, { bot: lumon }));
    try {
      expect([...mounted.container.querySelectorAll("[data-thread-chip]")].map((chip) => chip.textContent)).toEqual([t("handoff.messages", { count: 3, name: "DESIGNERGRAFICO" })]);
      const groups = [...mounted.container.querySelectorAll("[data-handoff-attachments]")];
      expect(groups).toHaveLength(2);
      expect(groups.flatMap((group) => [...group.querySelectorAll("img, button")]).length).toBeGreaterThanOrEqual(3);
    } finally {
      mounted.unmount();
    }
  });
});
