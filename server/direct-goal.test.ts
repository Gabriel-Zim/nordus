import { describe, expect, it } from "vitest";
import {
  DIRECT_GOAL_DEFAULT_MINUTES,
  DIRECT_GOAL_DEFAULT_TURNS,
  DirectGoals,
  type DirectGoalRun,
  parseDirectGoalCommand,
} from "./direct-goal.ts";

const MINUTE = 60_000;

describe("parseDirectGoalCommand", () => {
  it("starts with a low default budget", () => {
    expect(parseDirectGoalCommand("/goal refina o carrossel até o revisor dar 9")).toEqual({
      kind: "start",
      goal: "refina o carrossel até o revisor dar 9",
      maxTurns: DIRECT_GOAL_DEFAULT_TURNS,
      minutes: DIRECT_GOAL_DEFAULT_MINUTES,
    });
    expect(DIRECT_GOAL_DEFAULT_TURNS).toBe(6);
    expect(DIRECT_GOAL_DEFAULT_MINUTES).toBe(30);
  });

  it("reads turns and a deadline written in plain words", () => {
    expect(parseDirectGoalCommand("/goal refina esse carrossel até o revisor dar 9, no máximo uma hora")).toMatchObject({
      kind: "start", maxTurns: 6, minutes: 60,
    });
    expect(parseDirectGoalCommand("/goal deixa o site passando no teste, 10 turnos e 45 min")).toMatchObject({
      kind: "start", goal: "deixa o site passando no teste, 10 turnos e 45 min", maxTurns: 10, minutes: 45,
    });
    expect(parseDirectGoalCommand("/goal revisa o roteiro em 2 horas")).toMatchObject({ minutes: 120 });
  });

  it("caps a budget so a typo cannot spend all night", () => {
    expect(parseDirectGoalCommand("/goal faz tudo, 500 turnos e 9000 min")).toMatchObject({ maxTurns: 30, minutes: 240 });
  });

  it("reads a budget only from a closing clause, never from the goal's own words", () => {
    expect(parseDirectGoalCommand("/goal faz um vídeo de 1 min para o reels")).toMatchObject({ kind: "start", maxTurns: 6, minutes: 30 });
    expect(parseDirectGoalCommand("/goal corta um vídeo de 1 min")).toMatchObject({ kind: "start", maxTurns: 6, minutes: 30 });
    expect(parseDirectGoalCommand("/goal 3 turnos de revisão no roteiro")).toMatchObject({ kind: "start", maxTurns: 6, minutes: 30 });
    expect(parseDirectGoalCommand("/goal corta um vídeo de 1 min, no máximo meia hora")).toMatchObject({ maxTurns: 6, minutes: 30 });
    expect(parseDirectGoalCommand("/goal mais seguidores no perfil da EVERGREEN")).toMatchObject({
      kind: "start", goal: "mais seguidores no perfil da EVERGREEN",
    });
  });

  it("extends, resumes and stops", () => {
    expect(parseDirectGoalCommand("/goal estender")).toEqual({ kind: "extend", turns: 3, minutes: 15 });
    expect(parseDirectGoalCommand("/goal estender 4 turnos 20 min")).toEqual({ kind: "extend", turns: 4, minutes: 20 });
    expect(parseDirectGoalCommand("/goal +30 min")).toEqual({ kind: "extend", turns: 0, minutes: 30 });
    expect(parseDirectGoalCommand("/goal continuar")).toEqual({ kind: "resume" });
    expect(parseDirectGoalCommand("/goal parar")).toEqual({ kind: "stop" });
  });

  it("ignores ordinary text and an empty goal", () => {
    expect(parseDirectGoalCommand("refina o carrossel")).toBeNull();
    expect(parseDirectGoalCommand("/goalkeeper")).toBeNull();
    expect(parseDirectGoalCommand("/goal   ")).toBeNull();
  });
});

function harness(startAt = 1_000_000) {
  let now = startAt;
  const prompts: string[] = [];
  const published: DirectGoalRun[] = [];
  const notes: string[] = [];
  const ended: string[] = [];
  const goals = new DirectGoals({
    now: () => now,
    newId: () => "run-1",
    startGoalTurn: async (_run, prompt) => { prompts.push(prompt); },
    publish: (run) => { published.push(structuredClone(run)); },
    note: (_run, text) => { notes.push(text); },
    ended: (run) => { ended.push(run.status); },
  });
  return {
    goals,
    prompts,
    published,
    notes,
    ended,
    advance: (ms: number) => { now += ms; },
    last: () => published.at(-1)!,
  };
}

const envelope = (status: string, detail: string) => `Resultado.\n<nordus-goal>{"status":"${status}","detail":"${detail}"}</nordus-goal>`;

describe("DirectGoals", () => {
  it("keeps working until the bot verifies the criterion, then stops", async () => {
    const h = harness();
    await h.goals.command({ botId: "designergrafico", botName: "DESIGNERGRAFICO", threadId: "t1" }, parseDirectGoalCommand("/goal revisor dar 9")!);
    expect(h.prompts).toHaveLength(1);
    expect(h.last()).toMatchObject({ status: "working", turnCount: 1, maxTurns: 6 });

    await h.goals.turnEnded("t1", { ok: true, text: envelope("continue", "nota 7, ajustei o título") });
    expect(h.prompts).toHaveLength(2);
    expect(h.last()).toMatchObject({ status: "working", turnCount: 2 });

    await h.goals.turnEnded("t1", { ok: true, text: envelope("completed", "revisor deu 9") });
    expect(h.prompts).toHaveLength(2);
    expect(h.last()).toMatchObject({ status: "completed", detail: "revisor deu 9" });
    expect(h.last().steps.map((step) => step.detail)).toEqual(["nota 7, ajustei o título", "revisor deu 9"]);
    expect(h.goals.active("t1")).toBeNull();
  });

  it("stops when the turns run out", async () => {
    const h = harness();
    await h.goals.command({ botId: "designergrafico", botName: "DESIGNERGRAFICO", threadId: "t1" }, parseDirectGoalCommand("/goal faz, 2 turnos")!);
    await h.goals.turnEnded("t1", { ok: true, text: envelope("continue", "um") });
    await h.goals.turnEnded("t1", { ok: true, text: envelope("continue", "dois") });
    expect(h.prompts).toHaveLength(2);
    expect(h.last()).toMatchObject({ status: "limit-reached", stopReason: "turns" });
  });

  it("stops when the deadline passes, and an extension continues the same goal", async () => {
    const h = harness();
    await h.goals.command({ botId: "designergrafico", botName: "DESIGNERGRAFICO", threadId: "t1" }, parseDirectGoalCommand("/goal faz")!);
    h.advance(31 * MINUTE);
    await h.goals.turnEnded("t1", { ok: true, text: envelope("continue", "metade") });
    expect(h.prompts).toHaveLength(1);
    expect(h.last()).toMatchObject({ status: "limit-reached", stopReason: "time" });

    await h.goals.command({ botId: "designergrafico", botName: "DESIGNERGRAFICO", threadId: "t1" }, parseDirectGoalCommand("/goal +30 min")!);
    expect(h.prompts).toHaveLength(2);
    expect(h.last()).toMatchObject({ status: "working", turnCount: 2 });
    expect(h.last().deadlineAt).toBe(1_000_000 + 31 * MINUTE + 30 * MINUTE);
  });

  it("pauses as soon as the person writes, and resumes on request", async () => {
    const h = harness();
    await h.goals.command({ botId: "designergrafico", botName: "DESIGNERGRAFICO", threadId: "t1" }, parseDirectGoalCommand("/goal faz")!);
    expect(h.goals.pauseForPerson("t1")).toBe(true);
    expect(h.last()).toMatchObject({ status: "paused", stopReason: "person" });
    await h.goals.turnEnded("t1", { ok: true, text: envelope("continue", "segui") });
    expect(h.prompts).toHaveLength(1);
    expect(h.goals.pauseForPerson("t1")).toBe(false);

    await h.goals.command({ botId: "designergrafico", botName: "DESIGNERGRAFICO", threadId: "t1" }, { kind: "resume" });
    expect(h.prompts).toHaveLength(2);
    expect(h.last()).toMatchObject({ status: "working", turnCount: 2 });
  });

  it("waits for a pending approval instead of starting another turn", async () => {
    const h = harness();
    await h.goals.command({ botId: "designergrafico", botName: "DESIGNERGRAFICO", threadId: "t1" }, parseDirectGoalCommand("/goal publica")!);
    h.goals.approvalOpened("t1", "req-1");
    await h.goals.turnEnded("t1", { ok: true, text: envelope("continue", "pedi aprovação") });
    expect(h.prompts).toHaveLength(1);
    expect(h.last()).toMatchObject({ status: "needs-input", stopReason: "approval" });
  });

  it("keeps going after an approval that was already answered, by the person or by auto mode", async () => {
    const h = harness();
    await h.goals.command({ botId: "designergrafico", botName: "DESIGNERGRAFICO", threadId: "t1" }, parseDirectGoalCommand("/goal publica")!);
    h.goals.approvalOpened("t1", "req-1");
    h.goals.approvalResolved("t1", "req-1");
    await h.goals.turnEnded("t1", { ok: true, text: envelope("continue", "publiquei o rascunho") });
    expect(h.prompts).toHaveLength(2);
    expect(h.last()).toMatchObject({ status: "working", turnCount: 2 });
  });

  it("refuses a second goal while one is working, and leaves the first one alone", async () => {
    const h = harness();
    const target = { botId: "designergrafico", botName: "DESIGNERGRAFICO", threadId: "t1" };
    await h.goals.command(target, parseDirectGoalCommand("/goal primeiro")!);
    expect(h.goals.refusal("t1", parseDirectGoalCommand("/goal segundo")!)).toMatch(/Já tem um objetivo/);
    await h.goals.command(target, parseDirectGoalCommand("/goal segundo")!);
    expect(h.prompts).toHaveLength(1);
    expect(h.goals.active("t1")).toMatchObject({ goal: "primeiro", turnCount: 1 });
  });

  it("tells the person once, when the goal ends", async () => {
    const h = harness();
    await h.goals.command({ botId: "designergrafico", botName: "DESIGNERGRAFICO", threadId: "t1" }, parseDirectGoalCommand("/goal faz, 3 turnos")!);
    await h.goals.turnEnded("t1", { ok: true, text: envelope("continue", "um") });
    await h.goals.turnEnded("t1", { ok: true, text: envelope("continue", "dois") });
    expect(h.ended).toEqual([]);
    await h.goals.turnEnded("t1", { ok: true, text: envelope("completed", "três") });
    expect(h.ended).toEqual(["completed"]);
  });

  it("stops on a turn that ended without a clean result, since its effects are uncertain", async () => {
    const h = harness();
    await h.goals.command({ botId: "designergrafico", botName: "DESIGNERGRAFICO", threadId: "t1" }, parseDirectGoalCommand("/goal gera")!);
    await h.goals.turnEnded("t1", { ok: false, text: "" });
    expect(h.prompts).toHaveLength(1);
    expect(h.last()).toMatchObject({ status: "stopped", stopReason: "uncertain" });
  });

  it("says plainly when there is nothing to extend or resume", async () => {
    const h = harness();
    await h.goals.command({ botId: "designergrafico", botName: "DESIGNERGRAFICO", threadId: "t1" }, { kind: "resume" });
    await h.goals.command({ botId: "designergrafico", botName: "DESIGNERGRAFICO", threadId: "t1" }, { kind: "stop" });
    expect(h.prompts).toHaveLength(0);
    expect(h.notes).toHaveLength(2);
  });
});
