// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppState, Bot, InstanceInfo, Task } from "@/state/store";
import type { WorkJournal } from "../../shared/work-steps";

const { WorkingNow } = await import("./WorkingNow");
const { BotEditorStore, initialState } = await import("@/state/store");
const { setLocale } = await import("@/lib/i18n");

const START = new Date(2026, 9, 18, 9, 0).getTime();
const min = 60_000;
const model = { instanceId: "test", model: "m" };
const PLAN = ["Separando o material", "Cortando as pausas", "Montando o motion", "Renderizando", "Entregando"];

const editorDeVideoWith = (journal: WorkJournal | undefined, task: Partial<Task> = {}): Bot => ({
  id: "editordevideo", threadId: "editordevideo-task", name: "EDITORDEVIDEO", title: "", description: "", color: "green", section: "QG de VÍDEO",
  notifications: true, unread: false, busy: false, messages: [], modelSelection: model,
  tasks: [{ threadId: "editordevideo-task", title: "Vídeo do Kestrel", createdAt: 1, busy: false, activity: "idle", modelSelection: model,
    approvalMode: "ask", ...(journal ? { journal } : {}), ...task }],
});

const journal = (progress: Partial<WorkJournal["progress"]> = {}): WorkJournal => ({
  entries: [
    { at: START, end: START + 2 * min, botId: "editordevideo", name: "EDITORDEVIDEO", text: "Separando o material do Kestrel" },
    { at: START + 3 * min, end: START + 15 * min, botId: "logger", name: "Logger", text: "Cortando as pausas pela onda do áudio" },
    { at: START + 16 * min, botId: "motion", name: "Motion", text: "Montando o motion da abertura" },
  ],
  progress: { plan: PLAN, step: 3, at: START + 16 * min, ...progress },
});

function mount(bot: Bot, teammates: Bot[] = []) {
  const state: AppState = {
    ...initialState, connected: true, selectedId: bot.id, bots: [bot, ...teammates],
    instances: [{ instanceId: "test", driverKind: "codex", displayName: "Test", snapshot: { state: "available" } } as InstanceInfo],
    config: { features: { showToolCalls: false }, rooms: { turnTimeoutMinutes: 30 } } as unknown as AppState["config"],
  };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const value = { state, dispatch: vi.fn(), flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} };
  flushSync(() => root.render(createElement(BotEditorStore, { value, children: createElement(WorkingNow, { bot, messages: [], onStop: () => {} }) })));
  const card = container.querySelector("[data-working-now]");
  return { card, unmount: () => { root.unmount(); container.remove(); } };
}

beforeEach(() => {
  setLocale("pt-br");
  vi.stubGlobal("fetch", () => new Promise(() => {}));
  vi.useFakeTimers({ now: START + 20 * min, toFake: ["Date"] });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the task card in Agora", () => {
  it("says who is on the step now and since when, even with EDITORDEVIDEO idle and a teammate working", () => {
    const { card, unmount } = mount(editorDeVideoWith(journal()));
    try {
      expect(card).not.toBeNull();
      const now = card!.querySelector("[data-journal-now]")!.textContent!;
      expect(now).toContain("Motion: montando o motion da abertura");
      expect(now).toContain("há 4 min");
    } finally {
      unmount();
    }
  });

  it("lists each step done with who did it and how long it took, then the steps left", () => {
    const { card, unmount } = mount(editorDeVideoWith(journal()));
    try {
      const done = [...card!.querySelectorAll("[data-journal-done]")].map((item) => item.textContent);
      expect(done).toEqual([
        expect.stringMatching(/Separando o material do Kestrel.*EDITORDEVIDEO · 2 min/),
        expect.stringMatching(/Cortando as pausas pela onda do áudio.*Logger · 12 min/),
      ]);
      expect([...card!.querySelectorAll("[data-journal-left]")].map((item) => item.textContent)).toEqual(["Renderizando", "Entregando"]);
    } finally {
      unmount();
    }
  });

  it("shows a bar only for measured progress, and the footer only with credits or a place", () => {
    const bare = mount(editorDeVideoWith(journal()));
    try {
      expect(bare.card!.querySelector("[role=progressbar]")).toBeNull();
      expect(bare.card!.querySelector("[data-journal-footer]")).toBeNull();
    } finally {
      bare.unmount();
    }
    const measured = mount(editorDeVideoWith(journal({ percent: 40, credits: 1_240, creditCap: 10_000, where: "modal" })));
    try {
      expect(measured.card!.querySelector("[role=progressbar]")!.getAttribute("aria-valuenow")).toBe("40");
      expect(measured.card!.querySelector("[data-journal-footer]")!.textContent).toBe("1.240 de 10.000 créditos · no Modal");
    } finally {
      measured.unmount();
    }
    const placeOnly = mount(editorDeVideoWith(journal({ where: "servidor" })));
    try {
      expect(placeOnly.card!.querySelector("[data-journal-footer]")!.textContent).toBe("no servidor");
    } finally {
      placeOnly.unmount();
    }
  });

  it("shows two teammates working at once as both running, neither as done", () => {
    const both = journal();
    both.entries.push({ at: START + 18 * min, botId: "editor", name: "Editor", text: "Montando a trilha" });
    const { card, unmount } = mount(editorDeVideoWith(both));
    try {
      expect([...card!.querySelectorAll("[data-journal-now]")].map((line) => line.textContent)).toEqual([
        expect.stringContaining("Editor: montando a trilha"),
        expect.stringContaining("Motion: montando o motion da abertura"),
      ]);
      expect(card!.querySelectorAll("[data-journal-done]")).toHaveLength(2);
    } finally {
      unmount();
    }
  });

  it("says 1 crédito for a single credit", () => {
    const { card, unmount } = mount(editorDeVideoWith(journal({ credits: 1 })));
    try {
      expect(card!.querySelector("[data-journal-footer]")!.textContent).toBe("1 crédito");
    } finally {
      unmount();
    }
  });

  it("keeps a teammate working without a step of its own and EDITORDEVIDEO's long command, and repeats no step already running", () => {
    const working = journal();
    working.entries.push({ at: START + 17 * min, botId: "editordevideo", name: "EDITORDEVIDEO", text: "Conferindo o material" });
    const teammate = (id: string, name: string, doing: string): Bot => ({
      ...editorDeVideoWith(undefined), id, name, threadId: `${id}-own`, busy: true, activity: "working",
      tasks: [{ threadId: `${id}-own`, title: "", createdAt: 1, busy: false, activity: "idle", modelSelection: model, approvalMode: "ask" },
        { threadId: `${id}-work`, title: "", createdAt: 2, busy: true, activity: "working", modelSelection: model, approvalMode: "ask", doing,
          openedBy: { kind: "work", botId: "editordevideo", name: "EDITORDEVIDEO", threadId: "editordevideo-task" } } as Task],
    });
    const team = [teammate("logger", "Logger", "Exportando o corte"), teammate("motion", "Motion", "Montando o motion da abertura")];
    const ownSteps = (last: Task["steps"]) => ({ ...editorDeVideoWith(working, {
      busy: true, activity: "working", steps: [{ at: START + 17 * min, text: "Conferindo o material" }, ...(last ?? [])],
    }), busy: true, activity: "working" as const });

    const running = mount(ownSteps([{ at: START + 18 * min, tool: "Bash", command: "video", since: START + 18 * min }]), team);
    try {
      expect(running.card!.querySelector("[data-working-team]")!.textContent).toContain("Logger: exportando o corte");
      expect(running.card!.querySelector("[data-working-team]")!.textContent).not.toContain("Motion");
      expect(running.card!.querySelector("[data-work-step-now]")!.textContent).toContain("EDITORDEVIDEO: processando o vídeo");
      expect(running.card!.querySelector("[data-work-step-now]")!.textContent).toContain("há 2 min");
    } finally {
      running.unmount();
    }
    const ownStep = mount(ownSteps([]), team);
    try {
      expect(ownStep.card!.querySelector("[data-work-step-now]")).toBeNull();
      expect([...ownStep.card!.querySelectorAll("[data-journal-now]")].map((line) => line.textContent)).toEqual([
        expect.stringContaining("EDITORDEVIDEO: conferindo o material"),
        expect.stringContaining("Motion: montando o motion da abertura"),
      ]);
    } finally {
      ownStep.unmount();
    }
  });

  it("is gone with EDITORDEVIDEO idle once the plan is done, and without a journal", () => {
    const finished = journal({ step: 5 });
    finished.entries = finished.entries.map((entry) => ({ ...entry, end: entry.end ?? START + 18 * min }));
    for (const bot of [editorDeVideoWith(finished), editorDeVideoWith(undefined)]) {
      const { card, unmount } = mount(bot);
      try {
        expect(card).toBeNull();
      } finally {
        unmount();
      }
    }
  });
});
