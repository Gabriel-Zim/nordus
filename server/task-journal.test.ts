import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseWorkFields } from "../shared/work-steps.ts";
import { journalRoot, TaskJournals, type ChainLookup } from "./task-journal.ts";
import { cleanStepText } from "./work-steps.ts";

const step = (text: string) => cleanStepText(text)!;
const editordevideo = { botId: "editordevideo", threadId: "editordevideo-task", name: "EDITORDEVIDEO" };
const logger = { botId: "logger", threadId: "logger-work", name: "Logger" };
const PLAN = ["Separando o material", "Cortando as pausas", "Montando o motion", "Entregando"];
const EDITORDEVIDEO_TASK = { botId: "editordevideo", threadId: "editordevideo-task" };
const DESIGNERGRAFICO_TASK = { botId: "designergrafico", threadId: "designergrafico-task" };
const T = { botId: "editordevideo", threadId: "t" };
const nobodyBusy = () => false;
const everyoneBusy = () => true;

const dirs: string[] = [];
const tempFile = () => {
  const dir = mkdtempSync(join(tmpdir(), "task-journal-"));
  dirs.push(dir);
  return join(dir, "task-journals.json");
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

type Opener = { botId: string; threadId?: string; roomLane?: true };
function chain(tasks: Record<string, { botId: string; openedBy?: Opener }>, sections: Record<string, string | undefined>): ChainLookup {
  return {
    task: (botId, threadId) => (tasks[threadId]?.botId === botId ? tasks[threadId] : undefined),
    section: (botId) => sections[botId],
  };
}

describe("the task's journal", () => {
  it("keeps who did each step and how long it took, across the leader and its teammates", () => {
    const journals = new TaskJournals();
    expect(journals.report(EDITORDEVIDEO_TASK, editordevideo, step("Separando o material do Kestrel"), { plan: PLAN, step: 1, where: "servidor" }, 1_000)).toBe(true);
    journals.stopped("editordevideo", "editordevideo-task", 4_000);
    journals.report(EDITORDEVIDEO_TASK, editordevideo, step("Passando o corte ao Logger"), { step: 2 }, 4_500);
    journals.stopped("editordevideo", "editordevideo-task", 4_600);
    journals.report(EDITORDEVIDEO_TASK, logger, step("Cortando as pausas pela onda do áudio"), {}, 5_000);
    journals.report(EDITORDEVIDEO_TASK, logger, step("Conferindo os cortes"), {}, 65_000);
    expect(journals.stopped("logger", "logger-work", 95_000)).toEqual(["editordevideo-task"]);

    const journal = journals.forThread("editordevideo-task")!;
    expect(journal.entries).toEqual([
      { at: 1_000, end: 4_000, botId: "editordevideo", name: "EDITORDEVIDEO", text: "Separando o material do Kestrel" },
      { at: 4_500, end: 4_600, botId: "editordevideo", name: "EDITORDEVIDEO", text: "Passando o corte ao Logger" },
      { at: 5_000, end: 65_000, botId: "logger", name: "Logger", text: "Cortando as pausas pela onda do áudio" },
      { at: 65_000, end: 95_000, botId: "logger", name: "Logger", text: "Conferindo os cortes" },
    ]);
    expect(journal.progress).toEqual({ plan: PLAN, step: 2, where: "servidor", at: 65_000 });
  });

  it("takes the plan and the step only from the leader; a teammate adds its steps, credits, place and progress, marked as its own", () => {
    const journals = new TaskJournals();
    expect(journals.report(EDITORDEVIDEO_TASK, logger, step("Cortando as pausas"), { credits: 10 }, 1)).toBe(false);
    journals.report(EDITORDEVIDEO_TASK, editordevideo, step("Separando o material"), { plan: PLAN, step: 1, where: "servidor" }, 2);
    journals.report(EDITORDEVIDEO_TASK, logger, step("Cortando as pausas"), { plan: ["Outro plano"], step: 1, credits: 300, where: "modal", percent: 20 }, 3);
    const journal = journals.forThread("editordevideo-task")!;
    expect(journal.entries.map((entry) => entry.name)).toEqual(["EDITORDEVIDEO", "Logger"]);
    expect(journal.progress).toEqual({ plan: PLAN, step: 1, credits: 300, where: "modal", percent: 20, at: 3,
      from: { credits: "logger", where: "logger", percent: "logger" } });

    journals.report(EDITORDEVIDEO_TASK, editordevideo, step("Conferindo o corte"), { where: "servidor" }, 4);
    expect(journals.forThread("editordevideo-task")!.progress).toEqual({ plan: PLAN, step: 1, credits: 300, where: "servidor", at: 4, from: { credits: "logger" } });
  });

  it("leaves the wire once nobody works on it, and only the leader's next step with a field brings it back", () => {
    const journals = new TaskJournals();
    journals.report(T, editordevideo, step("Separando o material"), { plan: PLAN, step: 1, percent: 30 }, 1);
    expect(journals.close("t", everyoneBusy, 2)).toBe(false);
    expect(journals.forThread("t")).toBeDefined();
    journals.stopped("editordevideo", "editordevideo-task", 3);
    expect(journals.close("t", nobodyBusy, 4)).toBe(true);
    expect(journals.forThread("t")).toBeUndefined();

    expect(journals.report(T, editordevideo, step("Respondendo outra pergunta"), {}, 5)).toBe(false);
    expect(journals.report(T, logger, step("Cortando as pausas"), { credits: 9 }, 6)).toBe(false);
    expect(journals.forThread("t")).toBeUndefined();
    expect(journals.report(T, editordevideo, step("Cortando as pausas aprovadas"), { step: 2 }, 7)).toBe(true);
    const reopened = journals.forThread("t")!;
    expect(reopened.entries.map((entry) => entry.text)).toEqual(["Separando o material", "Cortando as pausas aprovadas"]);
    expect(reopened.progress).toEqual({ plan: PLAN, step: 2, at: 7 });
  });

  it("ends a step whose conversation stopped without its turn end when the task closes, and waits on one still busy", () => {
    const journals = new TaskJournals();
    journals.report(T, editordevideo, step("Separando o material"), { plan: PLAN, step: 1 }, 1);
    journals.report(T, logger, step("Cortando as pausas"), {}, 2);
    journals.stopped("editordevideo", "editordevideo-task", 3);
    const loggerBusy = (botId: string, threadId: string) => botId === "logger" && threadId === "logger-work";
    expect(journals.close("t", loggerBusy, 4)).toBe(false);
    expect(journals.forThread("t")!.entries.map((entry) => entry.end)).toEqual([3, undefined]);

    expect(journals.close("t", nobodyBusy, 5)).toBe(true);
    journals.report(T, editordevideo, step("Entregando"), { step: 4 }, 6);
    expect(journals.forThread("t")!.entries.map((entry) => [entry.name, entry.end])).toEqual([["EDITORDEVIDEO", 3], ["Logger", 5], ["EDITORDEVIDEO", undefined]]);
  });

  it("stops a bot's step only in the conversation whose turn ended, in every journal it reported to", () => {
    const journals = new TaskJournals();
    journals.report(T, editordevideo, step("Separando o material"), { plan: PLAN, step: 1 }, 1);
    journals.report(EDITORDEVIDEO_TASK, editordevideo, step("Abrindo a outra tarefa"), { plan: PLAN, step: 1 }, 1);
    journals.report(T, logger, step("Cortando as pausas do bruto"), {}, 2);
    journals.report(T, { ...logger, threadId: "logger-other" }, step("Cortando as pausas do teaser"), {}, 2);
    journals.report(EDITORDEVIDEO_TASK, logger, step("Cortando as pausas do bruto"), {}, 2);

    expect(journals.stopped("logger", "logger-work", 9).sort()).toEqual(["editordevideo-task", "t"]);
    expect(journals.forThread("t")!.entries.map((entry) => [entry.text, entry.end])).toEqual([
      ["Separando o material", undefined], ["Cortando as pausas do bruto", 9], ["Cortando as pausas do teaser", undefined],
    ]);
    expect(journals.stopped("logger", "logger-work", 10)).toEqual([]);
    expect(journals.stopped("nobody", "t", 10)).toEqual([]);
  });

  it("forgets the journal of a task that was deleted", () => {
    const file = tempFile();
    const journals = new TaskJournals(file);
    journals.report(T, editordevideo, step("Separando o material"), { plan: PLAN, step: 1 }, 1);
    expect(journals.forget("t")).toBe(true);
    expect(journals.forThread("t")).toBeUndefined();
    expect(new TaskJournals(file).forThread("t")).toBeUndefined();
    expect(journals.forget("t")).toBe(false);
  });

  it("starts only once the leader sends a field with its step, so plain steps change nothing", () => {
    const journals = new TaskJournals();
    expect(journals.report(DESIGNERGRAFICO_TASK, { botId: "designergrafico", threadId: "designergrafico-task", name: "DESIGNERGRAFICO" }, step("Montando a lâmina 2 de 5"), {}, 1)).toBe(false);
    expect(journals.forThread("designergrafico-task")).toBeUndefined();
    expect(journals.report(DESIGNERGRAFICO_TASK, { botId: "designergrafico", threadId: "designergrafico-task", name: "DESIGNERGRAFICO" }, step("Montando a lâmina 3 de 5"), { credits: 40 }, 2)).toBe(true);
    expect(journals.forThread("designergrafico-task")?.entries).toHaveLength(1);
  });

  it("drops the measured progress when the next step comes without it, and keeps the other fields", () => {
    const journals = new TaskJournals();
    journals.report(T, editordevideo, step("Renderizando a versão final"), { plan: PLAN, step: 3, percent: 40, credits: 1_240, creditCap: 10_000, where: "modal" }, 1);
    journals.report(T, editordevideo, step("Conferindo o render"), { step: 4 }, 2);
    expect(journals.forThread("t")!.progress).toEqual({ plan: PLAN, step: 4, credits: 1_240, creditCap: 10_000, where: "modal", at: 2 });
    journals.report(T, logger, step("Medindo o render"), { percent: 50 }, 3);
    journals.report(T, editordevideo, step("Conferindo de novo"), {}, 4);
    expect(journals.forThread("t")!.progress).toEqual({ plan: PLAN, step: 4, credits: 1_240, creditCap: 10_000, where: "modal", at: 4 });
  });

  it("starts a new journal when a plan comes with step 1", () => {
    const journals = new TaskJournals();
    journals.report(T, editordevideo, step("Entregando o vídeo"), { plan: PLAN, step: 4, credits: 900 }, 1);
    journals.report(T, editordevideo, step("Separando o material do próximo"), { plan: ["Separando", "Entregando"], step: 1 }, 2);
    expect(journals.forThread("t")).toEqual({
      entries: [{ at: 2, botId: "editordevideo", name: "EDITORDEVIDEO", text: "Separando o material do próximo" }],
      progress: { plan: ["Separando", "Entregando"], step: 1, at: 2 },
    });
  });

  it("is not forgotten when the turn ends, and survives a restart closed when a step was running, its step ended", () => {
    const file = tempFile();
    const journals = new TaskJournals(file);
    journals.report(T, editordevideo, step("Separando o material"), { plan: PLAN, step: 1 }, 1_000);
    journals.stopped("editordevideo", "editordevideo-task", 2_000);
    journals.report(T, logger, step("Cortando as pausas"), { credits: 7 }, 3_000);
    expect(journals.forThread("t")?.entries).toHaveLength(2);

    const restarted = new TaskJournals(file);
    expect(restarted.forThread("t")).toBeUndefined();
    expect(restarted.report(T, editordevideo, step("Retomando o corte"), { step: 2 }, 5_000)).toBe(true);
    expect(restarted.forThread("t")!.entries.map((entry) => [entry.name, entry.at, entry.end])).toEqual([
      ["EDITORDEVIDEO", 1_000, 2_000], ["Logger", 3_000, 3_000], ["EDITORDEVIDEO", 5_000, undefined],
    ]);
  });

  it("survives a restart open when nothing was running and planned steps are left", () => {
    const file = tempFile();
    const journals = new TaskJournals(file);
    journals.report(T, editordevideo, step("Separando o material"), { plan: PLAN, step: 1 }, 1_000);
    journals.stopped("editordevideo", "editordevideo-task", 2_000);
    expect(new TaskJournals(file).forThread("t")).toEqual(journals.forThread("t"));
  });

  it("keeps the newest steps under its cap", () => {
    const journals = new TaskJournals();
    for (let index = 0; index < 230; index++) journals.report(T, editordevideo, step(`Montando a parte ${index}`), { credits: index }, index);
    const entries = journals.forThread("t")!.entries;
    expect(entries).toHaveLength(200);
    expect(entries[0]!.text).toBe("Montando a parte 30");
  });

  it("starts empty from a damaged file instead of failing", () => {
    const file = tempFile();
    writeFileSync(file, "{ not json");
    const journals = new TaskJournals(file);
    expect(journals.forThread("t")).toBeUndefined();
    journals.report(T, editordevideo, step("Separando o material"), { where: "servidor" }, 1);
    expect(JSON.parse(readFileSync(file, "utf8")).version).toBe(1);
  });
});

describe("whose journal a step goes to", () => {
  const sections = { editordevideo: "QG de VÍDEO", logger: "QG de VÍDEO", editor: "QG de VÍDEO", designergrafico: "QG de DESIGN", solo: undefined, other: undefined };

  it("puts a teammate's step in the leader's task, up the chain the leader opened", () => {
    const lookup = chain({
      "editordevideo-task": { botId: "editordevideo" },
      "logger-work": { botId: "logger", openedBy: { botId: "editordevideo", threadId: "editordevideo-task" } },
      "editor-work": { botId: "editor", openedBy: { botId: "logger", threadId: "logger-work" } },
    }, sections);
    expect(journalRoot(lookup, "logger", "logger-work")).toEqual({ botId: "editordevideo", threadId: "editordevideo-task" });
    expect(journalRoot(lookup, "editor", "editor-work")).toEqual({ botId: "editordevideo", threadId: "editordevideo-task" });
    expect(journalRoot(lookup, "editordevideo", "editordevideo-task")).toEqual({ botId: "editordevideo", threadId: "editordevideo-task" });
  });

  it("keeps another team's bot, a bot without a team and a room job in their own task", () => {
    const lookup = chain({
      "designergrafico-task": { botId: "designergrafico" },
      "editordevideo-task": { botId: "editordevideo" },
      "logger-for-designergrafico": { botId: "logger", openedBy: { botId: "designergrafico", threadId: "designergrafico-task" } },
      "other-task": { botId: "other" },
      "solo-work": { botId: "solo", openedBy: { botId: "other", threadId: "other-task" } },
      "logger-room": { botId: "logger", openedBy: { botId: "editordevideo", threadId: "room-thread", roomLane: true } },
    }, sections);
    expect(journalRoot(lookup, "logger", "logger-for-designergrafico")).toEqual({ botId: "logger", threadId: "logger-for-designergrafico" });
    expect(journalRoot(lookup, "solo", "solo-work")).toEqual({ botId: "solo", threadId: "solo-work" });
    expect(journalRoot(lookup, "logger", "logger-room")).toEqual({ botId: "logger", threadId: "logger-room" });
  });

  it("has no journal for a thread that is not one of the bot's tasks", () => {
    expect(journalRoot(chain({}, sections), "editordevideo", "room-thread")).toBeNull();
  });

  it("stops on a loop", () => {
    const lookup = chain({
      a: { botId: "editordevideo", openedBy: { botId: "logger", threadId: "b" } },
      b: { botId: "logger", openedBy: { botId: "editordevideo", threadId: "a" } },
    }, sections);
    expect(journalRoot(lookup, "editordevideo", "a")).toEqual({ botId: "logger", threadId: "b" });
  });
});

describe("the fields informar_etapa takes beyond the step", () => {
  it("accepts every field within its limits", () => {
    expect(parseWorkFields({ plan: [" Separando o material ", "Entregando"], step: 2, percent: 37.6, credits: 1_240, creditCap: 10_000, where: "modal" }))
      .toEqual({ ok: true, fields: { plan: ["Separando o material", "Entregando"], step: 2, percent: 38, credits: 1_240, creditCap: 10_000, where: "modal" } });
    expect(parseWorkFields({})).toEqual({ ok: true, fields: {} });
  });

  it.each([
    ["a plan of 13 items", { plan: Array.from({ length: 13 }, (_, index) => `Etapa ${index}`) }],
    ["an empty plan", { plan: [] }],
    ["a plan item past 80 characters", { plan: ["x".repeat(81)] }],
    ["a plan item under 3 characters", { plan: ["Separando", " ok "] }],
    ["a step past the plan", { plan: ["Separando", "Entregando"], step: 3 }],
    ["a step of 0", { step: 0 }],
    ["a fractional step", { step: 1.5 }],
    ["progress past 100", { percent: 101 }],
    ["negative progress", { percent: -1 }],
    ["fractional credits", { credits: 1.5 }],
    ["negative credits", { credits: -3 }],
    ["a cap of 0", { creditCap: 0 }],
    ["a place other than the server or Modal", { where: "aws" }],
    ["a number given as text", { credits: "1240" }],
  ])("refuses %s", (_label, fields) => {
    const parsed = parseWorkFields(fields as Record<string, unknown>);
    expect(parsed.ok).toBe(false);
  });
});
