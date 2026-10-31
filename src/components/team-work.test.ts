// @vitest-environment happy-dom
// DESIGNERGRAFICO's conversation while her teammates work on what she sent: their lines in "Agora", no handoff pills in simple mode.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppState, Bot, InstanceInfo, Message, Task } from "@/state/store";

vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: { dictation: { available: false }, host: { packaged: true, platform: "other" }, localComputer: { available: false } }, ready: true }),
  useCaptionChrome: () => ({}),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/cloud-guest", () => ({ useCanWriteIn: () => true, useReactor: () => "user" }));
vi.mock("./ModelPicker", () => ({ ModelPicker: () => null }));

const { ChatView } = await import("./ChatView");
const { WorkingNow } = await import("./WorkingNow");
const { BotEditorStore, initialState } = await import("@/state/store");
const { setAdvancedMode } = await import("@/lib/interface-mode");
const { t } = await import("@/lib/i18n");

const at = new Date(2026, 9, 17, 9, 0).getTime();
const model = { instanceId: "test", model: "m" };
const fromDesignerGrafico = { botId: "designergrafico", name: "DESIGNERGRAFICO", threadId: "designergrafico-main", at } as Task["openedBy"];

const teamBot = (id: string, name: string, section: string | undefined, tasks: Partial<Task>[] = [], extra: Partial<Bot> = {}): Bot => ({
  id, threadId: `${id}-main`, name, title: "", description: "", color: "green", ...(section ? { section } : {}),
  notifications: true, unread: false, busy: false, messages: [], modelSelection: model,
  tasks: [{ threadId: `${id}-main`, title: "Principal", createdAt: 1, busy: false, activity: "idle", modelSelection: model, approvalMode: "ask" },
    ...tasks.map((task) => ({ threadId: "", title: "@DESIGNERGRAFICO · work", createdAt: 2, modelSelection: model, approvalMode: "ask" as const, ...task }))],
  ...extra,
});
const designer = (task: Partial<Task> = {}) => teamBot("designer", "Designer", "QG de DESIGN", [{ threadId: "designer-work", busy: true, activity: "working",
  turnStartedAt: at, doing: "Diagramando a lâmina 3 da Lumon", openedBy: fromDesignerGrafico, ...task }]);
const assistentefinanceiro = teamBot("assistentefinanceiro", "AssistenteFinanceiro", "FINANCEIRO", [{ threadId: "assistentefinanceiro-work", busy: true, activity: "working", turnStartedAt: at,
  doing: "Somando as notas do mês", openedBy: fromDesignerGrafico }]);
const pill = (id: string, parentId: string | undefined, name: string, botId: string, threadId: string): Message => ({
  id, parentId, at, role: "bot", kind: "activity", tool: { name, ok: true },
  from: { botId: "designergrafico", name: "DESIGNERGRAFICO", color: "green" }, threadRef: { botId, threadId, title: "@DESIGNERGRAFICO · work" },
});

function stateWith(designergrafico: Bot, others: Bot[]): AppState {
  return {
    ...initialState,
    connected: true,
    selectedId: designergrafico.id,
    bots: [designergrafico, ...others],
    instances: [{ instanceId: "test", driverKind: "codex", displayName: "Test", snapshot: { state: "available" } } as InstanceInfo],
    config: { features: { showToolCalls: false }, rooms: { turnTimeoutMinutes: 30 } } as unknown as AppState["config"],
  };
}

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
});

describe("Agora while teammates work on what the bot asked", () => {
  it("shows each teammate's line, never another team's bot", () => {
    vi.stubGlobal("fetch", () => new Promise(() => {}));
    const designergrafico = teamBot("designergrafico", "DESIGNERGRAFICO", "QG de DESIGN", [], { waitingForTeammates: true });
    const mounted = mount(stateWith(designergrafico, [designer(), assistentefinanceiro]), createElement(WorkingNow, { bot: designergrafico, messages: [], onStop: () => {} }));
    try {
      const card = mounted.container.querySelector("[data-working-now]");
      expect(card).not.toBeNull();
      expect(card!.textContent).toContain("Designer: diagramando a lâmina 3 da Lumon");
      expect(card!.textContent).not.toContain("AssistenteFinanceiro");
      expect(card!.textContent).not.toContain("Somando");
    } finally {
      mounted.unmount();
    }
  });

  it("says the teammate is working until its line arrives, and is gone when nobody works", () => {
    vi.stubGlobal("fetch", () => new Promise(() => {}));
    const designergrafico = teamBot("designergrafico", "DESIGNERGRAFICO", "QG de DESIGN");
    const waiting = mount(stateWith(designergrafico, [designer({ doing: undefined })]), createElement(WorkingNow, { bot: designergrafico, messages: [], onStop: () => {} }));
    try {
      expect(waiting.container.textContent).toContain(`Designer: ${t("chat.activity.working").toLocaleLowerCase()}`);
    } finally {
      waiting.unmount();
    }
    const idle = mount(stateWith(designergrafico, [designer({ busy: false, activity: "idle" }), assistentefinanceiro]), createElement(WorkingNow, { bot: designergrafico, messages: [], onStop: () => {} }));
    try {
      expect(idle.container.querySelector("[data-working-now]")).toBeNull();
    } finally {
      idle.unmount();
    }
  });
});

describe("bots without a team", () => {
  const fromLumon = { botId: "lumon", name: "LUMON", threadId: "lumon-main", at } as Task["openedBy"];
  const evergreen = teamBot("evergreen", "EVERGREEN", undefined, [{ threadId: "evergreen-work", busy: true, activity: "working", turnStartedAt: at,
    doing: "Montando a tabela de preços", openedBy: fromLumon }]);

  it("show no teammate in Agora and keep their handoff pills", () => {
    vi.stubGlobal("fetch", () => new Promise(() => {}));
    setAdvancedMode(false);
    const messages: Message[] = [
      { id: "ask", parentId: undefined, at, role: "user", kind: "text", text: "Pede a tabela ao EVERGREEN" },
      pill("sent", "ask", "Sent to EVERGREEN", "evergreen", "evergreen-work"),
    ];
    const lumon = teamBot("lumon", "LUMON", undefined, [], { messages, activeLeafId: "sent" });
    lumon.tasks![0]!.waitingForTeammates = true;
    const card = mount(stateWith(lumon, [evergreen]), createElement(WorkingNow, { bot: lumon, messages: [], onStop: () => {} }));
    try {
      expect(card.container.querySelector("[data-working-now]")).toBeNull();
    } finally {
      card.unmount();
    }
    const chat = mount(stateWith(lumon, [evergreen]), createElement(ChatView, { bot: lumon }));
    try {
      expect(chat.container.textContent).not.toContain("Montando a tabela");
      expect([...chat.container.querySelectorAll("[data-thread-chip]")].map((chip) => chip.textContent)).toContain(t("handoff.messageTo", { name: "EVERGREEN" }));
    } finally {
      chat.unmount();
    }
  });
});

describe("DESIGNERGRAFICO's conversation with her team at work", () => {
  const messages: Message[] = [
    { id: "ask", parentId: undefined, at, role: "user", kind: "text", text: "Faz o carrossel da Lumon" },
    pill("sent", "ask", "Sent to Designer", "designer", "designer-work"),
    pill("sent-other", "sent", "Sent to AssistenteFinanceiro", "assistentefinanceiro", "assistentefinanceiro-work"),
    pill("replied", "sent-other", "Designer replied", "designer", "designer-work"),
    pill("asks", "replied", "Designer needs your input: qual fonte uso na capa?", "designer", "designer-work"),
    { id: "answer", parentId: "asks", at, role: "bot", kind: "text", text: "Mandei o Designer diagramar." },
  ];
  const designergrafico = teamBot("designergrafico", "DESIGNERGRAFICO", "QG de DESIGN", [], { messages, activeLeafId: "answer" });
  designergrafico.tasks![0]!.waitingForTeammates = true;
  const chips = (container: HTMLElement) => [...container.querySelectorAll("[data-thread-chip]")].map((chip) => chip.textContent ?? "");
  const titles = (container: HTMLElement) => [...container.querySelectorAll("[data-thread-chip]")].map((chip) => chip.getAttribute("title") ?? "");

  it("in simple mode hides the teammates' handoff pills and keeps what needs the person", () => {
    vi.stubGlobal("fetch", () => new Promise(() => {}));
    setAdvancedMode(false);
    const mounted = mount(stateWith(designergrafico, [designer(), assistentefinanceiro]), createElement(ChatView, { bot: designergrafico }));
    try {
      const shown = chips(mounted.container);
      expect(shown.filter((chip) => chip.includes("Designer"))).toEqual([t("handoff.messageFrom", { name: "Designer" })]);
      expect(titles(mounted.container).some((title) => title.includes("qual fonte uso na capa?"))).toBe(true);
      expect(shown).toContain(t("handoff.messageTo", { name: "AssistenteFinanceiro" }));
      expect(mounted.container.textContent).toContain("Mandei o Designer diagramar.");
    } finally {
      mounted.unmount();
    }
  });

  it("in advanced mode keeps every pill", () => {
    vi.stubGlobal("fetch", () => new Promise(() => {}));
    setAdvancedMode(true);
    const mounted = mount(stateWith(designergrafico, [designer(), assistentefinanceiro]), createElement(ChatView, { bot: designergrafico }));
    try {
      const shown = chips(mounted.container);
      expect(shown).toContain(t("handoff.messages", { count: 3, name: "Designer" }));
      expect(shown).toContain(t("handoff.messageTo", { name: "AssistenteFinanceiro" }));
    } finally {
      mounted.unmount();
    }
  });

  it("says in the header what the teammate is doing, not just that teammates work", () => {
    vi.stubGlobal("fetch", () => new Promise(() => {}));
    const mounted = mount(stateWith(designergrafico, [designer(), assistentefinanceiro]), createElement(ChatView, { bot: designergrafico }));
    try {
      const status = [...mounted.container.querySelectorAll("[role=status]")].map((element) => element.textContent ?? "");
      expect(status).toContain("Designer: diagramando a lâmina 3 da Lumon");
      expect(status).not.toContain(t("chat.teammatesWorking"));
      const worker = mounted.container.querySelector("[data-chathead-worker]");
      expect(worker?.textContent).toBe("Designer: diagramando a lâmina 3 da Lumon");
      expect(worker?.closest("[data-chathead-identity]")).toBeNull();
    } finally {
      mounted.unmount();
    }
  });
});

describe("Agora with the steps the bot reports", () => {
  const steps = [
    { at: at + 1_000, tool: "mcp__second-brain__ler_documento" },
    { at: at + 60_000, text: "Montando a lâmina 1 de 5 do carrossel de lançamento" },
    { at: at + 120_000, text: "Montando a lâmina 2 de 5" },
    { at: at + 180_000, text: "Montando a lâmina 3 de 5" },
    { at: at + 240_000, text: "Montando a lâmina 4 de 5" },
    { at: at + 300_000, text: "Fazendo os ajustes pedidos pelo Revisor" },
  ];
  const working = (task: Partial<Task>) => teamBot("designer", "Designer", "QG de DESIGN", [], {
    busy: true, activity: "working", turnStartedAt: at,
    tasks: [{ threadId: "designer-main", title: "Principal", createdAt: 1, busy: true, activity: "working", turnStartedAt: at, modelSelection: model, approvalMode: "ask", ...task }],
  });

  it("puts the step now on top with its time, and the earlier ones with a check and the hour, folded when many", () => {
    vi.stubGlobal("fetch", () => new Promise(() => {}));
    const bot = working({ steps });
    const mounted = mount(stateWith(bot, []), createElement(WorkingNow, { bot, messages: [], onStop: () => {} }));
    try {
      const now = mounted.container.querySelector("[data-work-step-now]")!;
      expect(now.textContent).toContain("Fazendo os ajustes pedidos pelo Revisor");
      expect(now.textContent).toMatch(/há \d|\d+ (?:s|min|h)/);
      const done = [...mounted.container.querySelectorAll("[data-work-step-done]")].map((row) => row.textContent);
      expect(done).toEqual(["✓Montando a lâmina 4 de 59:04", "✓Montando a lâmina 3 de 59:03", "✓Montando a lâmina 2 de 59:02"]);
      expect(mounted.container.textContent).not.toContain(t("chat.activity.thinking"));
      const more = [...mounted.container.querySelectorAll("button")].find((button) => button.textContent === t("workingNow.seeSteps", { count: 2 }))!;
      flushSync(() => more.click());
      const all = [...mounted.container.querySelectorAll("[data-work-step-done]")].map((row) => row.textContent);
      expect(all).toHaveLength(5);
      expect(all.at(-1)).toBe(`✓${t("workStep.brief")}9:00`);
    } finally {
      mounted.unmount();
    }
  });

  it("shows only the steps of the conversation it titles, never another one's", () => {
    vi.stubGlobal("fetch", () => new Promise(() => {}));
    const bot = teamBot("designer", "Designer", "QG de DESIGN", [], {
      busy: true, activity: "working", turnStartedAt: at,
      tasks: [
        { threadId: "designer-main", title: "Principal", createdAt: 1, busy: true, activity: "working", turnStartedAt: at, doing: "Criando a capa do Reels", modelSelection: model, approvalMode: "ask" },
        { threadId: "designer-side", title: "Outra", createdAt: 2, busy: true, activity: "working", turnStartedAt: at, steps: [{ at, text: "Montando a lâmina 2 de 5" }], modelSelection: model, approvalMode: "ask" },
      ],
    });
    const mounted = mount(stateWith(bot, []), createElement(WorkingNow, { bot, messages: [], onStop: () => {} }));
    try {
      expect(mounted.container.textContent).toContain("Criando a capa do Reels");
      expect(mounted.container.textContent).not.toContain("Montando a lâmina 2 de 5");
    } finally {
      mounted.unmount();
    }
  });

  it("says Pensando only while the bot has done nothing yet", () => {
    vi.stubGlobal("fetch", () => new Promise(() => {}));
    const bot = working({});
    const mounted = mount(stateWith(bot, []), createElement(WorkingNow, { bot, messages: [], onStop: () => {} }));
    try {
      expect(mounted.container.querySelector("[data-work-steps]")).toBeNull();
      expect(mounted.container.textContent).toContain(t("chat.activity.thinking"));
    } finally {
      mounted.unmount();
    }
  });
});
