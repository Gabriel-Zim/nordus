import { describe, expect, it } from "vitest";
import type { BoardTask } from "../../shared/board.ts";
import { DEFAULT_LIMITS, decide, dayKey, type DecideInput } from "./decide.ts";
import type { StoredMission } from "./schema.ts";

const NOW = Date.parse("2026-10-27T12:00:00Z");

const mission = (extra: Partial<StoredMission> = {}): StoredMission => ({
  id: "m1", title: "Virar produção", goal: "Virar sem erro", createdBy: { kind: "person", id: "rafael@zorg.com" }, createdAt: 1, status: "running",
  leadBotId: "dev", teamBotIds: ["dev", "atlas"], groupId: "sala", threadId: "th-sala", stepIds: [1, 2], feed: [], runner: {}, ...extra,
});

const step = (id: number, status: BoardTask["status"], assignee = "dev"): BoardTask => ({
  id, title: `Passo ${id}`, status, assignee, createdBy: { kind: "bot", id: "dev" }, createdAt: 1, updatedAt: 1, history: [], missionId: "m1",
});

const input = (extra: Partial<DecideInput> = {}): DecideInput => ({
  mission: mission(), steps: [step(1, "todo", "atlas"), step(2, "todo")], now: NOW, busy: false, day: dayKey(NOW), limits: DEFAULT_LIMITS,
  nameOf: (id) => id[0]!.toUpperCase() + id.slice(1),
  teamOf: (ids) => ids.map((id) => ({ id, name: id[0]!.toUpperCase() + id.slice(1) })),
  ...extra,
});

const inflight = (extra: Partial<NonNullable<StoredMission["runner"]["inflight"]>>) => ({ kind: "step" as const, taskId: 1, sendId: "mission-1", at: NOW - 60_000, attempts: 1, ...extra });

describe("what a mission does next", () => {
  it("asks the lead for the plan first", () => {
    const action = decide(input({ mission: mission({ status: "planning", stepIds: [] }), steps: [] }));
    expect(action).toMatchObject({ kind: "send", as: "plan", botId: "dev", attempts: 1 });
    expect((action as { text: string }).text.startsWith("@Dev [Mission from the Nordus board")).toBe(true);
    expect((action as { text: string }).text).toContain("Missão «Virar produção»");
    expect((action as { text: string }).text).toContain("Atlas (id atlas)");
  });

  it("gives up on the plan after the allowed tries and asks a person", () => {
    const action = decide(input({ mission: mission({ status: "planning", stepIds: [], runner: { inflight: inflight({ kind: "plan", attempts: 3, taskId: undefined }) } }), steps: [] }));
    expect(action).toMatchObject({ kind: "pause", cause: "steps" });
  });

  it("hands the first open step to its owner, naming the owner", () => {
    const action = decide(input());
    expect(action).toMatchObject({ kind: "send", as: "step", botId: "atlas", taskId: 1, attempts: 1 });
    expect((action as { text: string }).text.startsWith("@Atlas [Mission from the Nordus board")).toBe(true);
    expect((action as { text: string }).text).toContain("Passo 1 de 2 da missão «Virar produção»: Passo 1");
  });

  it("moves on to the next step as soon as the current one is done", () => {
    const action = decide(input({ steps: [step(1, "done", "atlas"), step(2, "todo")], mission: mission({ runner: { inflight: inflight({}) } }) }));
    expect(action).toMatchObject({ kind: "send", as: "step", botId: "dev", taskId: 2, attempts: 1 });
  });

  it("waits while the room is working, right after sending, and while a person reviews", () => {
    expect(decide(input({ busy: true }))).toEqual({ kind: "wait" });
    expect(decide(input({ mission: mission({ runner: { inflight: inflight({ at: NOW - 1_000 }) } }) }))).toEqual({ kind: "wait" });
    expect(decide(input({ steps: [step(1, "review", "atlas"), step(2, "todo")], mission: mission({ runner: { inflight: inflight({}) } }) }))).toEqual({ kind: "wait" });
  });

  it("nudges the owner when its turn ended and the step is not done, until the allowed tries run out", () => {
    const nudge = decide(input({ steps: [step(1, "doing", "atlas"), step(2, "todo")], mission: mission({ runner: { inflight: inflight({ attempts: 1 }) } }) }));
    expect(nudge).toMatchObject({ kind: "send", as: "step", botId: "atlas", taskId: 1, attempts: 2 });
    expect((nudge as { text: string }).text).toContain("ainda está em doing");
    const stalled = decide(input({ steps: [step(1, "doing", "atlas"), step(2, "todo")], mission: mission({ runner: { inflight: inflight({ attempts: 3 }) } }) }));
    expect(stalled).toMatchObject({ kind: "pause", cause: "steps" });
    expect((stalled as { reason: string }).reason).toContain("Passo 1");
  });

  it("delivers a person's answer before anything else", () => {
    const action = decide(input({ mission: mission({ runner: { answer: { botId: "atlas", text: "@Atlas Rafael respondeu" } } }) }));
    expect(action).toMatchObject({ kind: "send", as: "answer", botId: "atlas", text: "@Atlas Rafael respondeu", attempts: 0 });
  });

  it("asks the lead for the closing summary once every step is done, and finishes if the lead ends without one", () => {
    const done = [step(1, "done", "atlas"), step(2, "done")];
    expect(decide(input({ steps: done }))).toMatchObject({ kind: "send", as: "close", botId: "dev" });
    expect(decide(input({ steps: done, mission: mission({ runner: { closing: true, inflight: inflight({ kind: "close", taskId: undefined }) } }) }))).toEqual({ kind: "finish" });
  });

  it("stays quiet while the mission is paused, waiting for a decision, done or failed", () => {
    for (const status of ["paused", "waiting", "done", "failed"] as const) {
      expect(decide(input({ mission: mission({ status }) }))).toEqual({ kind: "wait" });
    }
  });

  it("stops for the day when the daily budget of turns is spent, and starts again the next day", () => {
    const spent = mission({ runner: { daily: { day: dayKey(NOW), turns: DEFAULT_LIMITS.dailyTurns } } });
    expect(decide(input({ mission: spent }))).toMatchObject({ kind: "pause", cause: "daily" });
    const tomorrow = NOW + 86_400_000;
    expect(decide(input({ mission: spent, now: tomorrow, day: dayKey(tomorrow) }))).toMatchObject({ kind: "send", as: "step" });
  });
});
