import { describe, expect, it } from "vitest";
import { gettingStartedSteps, gettingStartedVisible, type GettingStartedFacts } from "./getting-started";

const fresh: GettingStartedFacts = { engineReady: false, bots: [], appConnected: null, routines: 0 };
const done = (facts: GettingStartedFacts) => gettingStartedSteps(facts).filter((step) => step.done).map((step) => step.id);

describe("getting started", () => {
  it("starts with every step open, in the order a person meets them", () => {
    expect(gettingStartedSteps(fresh).map((step) => [step.id, step.done])).toEqual([
      ["engine", false], ["bot", false], ["ask", false], ["app", false], ["routine", false],
    ]);
  });

  it("ticks each step from what the workspace already has", () => {
    expect(done({
      engineReady: true,
      bots: [{ tasks: [{ threadId: "t", titleFromFirstMessage: true as const }] }],
      appConnected: true,
      routines: 1,
    })).toEqual(["engine", "bot", "ask", "app", "routine"]);
  });

  it("does not count a hidden bot or an untouched conversation", () => {
    expect(done({ ...fresh, bots: [{ hidden: true, tasks: [{ threadId: "t", titleFromFirstMessage: true as const }] }] })).toEqual([]);
    expect(done({ ...fresh, bots: [{ tasks: [{ threadId: "t" }] }] })).toEqual(["bot"]);
  });

  it("does not take the bot's own greeting for the person's first job", () => {
    const greeted = { threadId: "t", createdAt: 1, updatedAt: 9 };
    expect(done({ ...fresh, bots: [{ tasks: [greeted] }] })).toEqual(["bot"]);
  });

  it("counts the first job from the recorded first turn or a titled conversation", () => {
    expect(done({ ...fresh, firstTurnAt: "2026-11-01T10:00:00.000Z" })).toEqual(["ask"]);
    expect(done({ ...fresh, bots: [{ tasks: [{ threadId: "t", titleFromFirstMessage: true as const }] }] })).toEqual(["bot", "ask"]);
  });

  it("leaves when it is hidden, finished, or the viewer cannot change the workspace", () => {
    const open = gettingStartedSteps(fresh);
    expect(gettingStartedVisible(open, { dismissed: false, canSave: true })).toBe(true);
    expect(gettingStartedVisible(open, { dismissed: true, canSave: true })).toBe(false);
    expect(gettingStartedVisible(open, { dismissed: false, canSave: false })).toBe(false);
    const finished = open.map((step) => ({ ...step, done: true }));
    expect(gettingStartedVisible(finished, { dismissed: false, canSave: true })).toBe(false);
  });
});
