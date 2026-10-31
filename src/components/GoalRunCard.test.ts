import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { GoalRunCard, placeGoalRuns, runningGoal } from "./GoalRunCard";

const run = (status: string) => ({
  runId: "r", goal: "montar texto e arte de um carrossel de teste", status, coordinatorBotId: "d", coordinatorName: "Diretor",
  turnCount: 4, maxTurns: 13, startedAt: 1_000,
}) as any;
const msg = (id: string, at: number, extra: Record<string, unknown> = {}) => ({ id, at, role: "bot", kind: "text", text: id, ...extra }) as any;

describe("team goal in the conversation", () => {
  it("leaves no card, running or ended", () => {
    for (const status of ["working", "completed", "needs-input", "failed"]) {
      expect(renderToStaticMarkup(createElement(GoalRunCard, { message: msg("g", 1_000, { kind: "goal.run", goalRun: run(status) }) }))).toBe("");
    }
    expect(placeGoalRuns([msg("ask", 900), msg("g", 1_000, { kind: "goal.run", goalRun: run("completed") }), msg("a", 2_000)]).map((m) => m.id)).toEqual(["ask", "a"]);
  });

  it("the running round goes to the status line, and nothing once it ended", () => {
    expect(runningGoal([msg("g", 1_000, { kind: "goal.run", goalRun: run("working") })])).toEqual({ turn: 5, max: 13 });
    expect(runningGoal([msg("g", 1_000, { kind: "goal.run", goalRun: run("completed") })])).toBeNull();
  });

  it("a direct goal shows the turn it is on and the minutes left", () => {
    const direct = { ...run("working"), turnCount: 2, maxTurns: 6, deadlineAt: 1_000 + 30 * 60_000 };
    expect(runningGoal([msg("g", 1_000, { kind: "goal.run", goalRun: direct })], 1_000 + 12 * 60_000 + 1))
      .toEqual({ turn: 2, max: 6, minutesLeft: 18 });
    expect(runningGoal([msg("g", 1_000, { kind: "goal.run", goalRun: direct })], 1_000 + 31 * 60_000))
      .toEqual({ turn: 2, max: 6, minutesLeft: 0 });
  });
});
