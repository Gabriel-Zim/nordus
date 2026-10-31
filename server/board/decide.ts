import type { BoardTask } from "../../shared/board.ts";
import type { StoredMission } from "./schema.ts";
import * as text from "./texts.ts";

export interface RunnerLimits {
  stepAttempts: number;
  dailyTurns: number;
  graceMs: number;
  tickMs: number;
}

export const DEFAULT_LIMITS: RunnerLimits = { stepAttempts: 3, dailyTurns: 60, graceMs: 4_000, tickMs: 15_000 };

export const MAX_PLAN_STEPS = 20;

export type SendKind = "plan" | "step" | "answer" | "close";

export type Action =
  | { kind: "wait" }
  | { kind: "send"; as: SendKind; botId: string; text: string; taskId?: number; attempts: number }
  | { kind: "pause"; cause: "steps" | "daily"; reason: string }
  | { kind: "finish" };

export interface DecideInput {
  mission: StoredMission;
  steps: readonly BoardTask[];
  now: number;
  busy: boolean;
  day: string;
  limits: RunnerLimits;
  nameOf(botId: string): string;
  teamOf(botIds: readonly string[]): Array<{ id: string; name: string }>;
}

export function dayKey(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}

export function decide(input: DecideInput): Action {
  const { mission, steps, limits } = input;
  const state = mission.runner;
  if (mission.status !== "planning" && mission.status !== "running") return { kind: "wait" };
  const inflight = state.inflight;
  const settling = input.busy || (inflight !== undefined && input.now - inflight.at < limits.graceMs);
  if (settling) return { kind: "wait" };
  const used = state.daily?.day === input.day ? state.daily.turns : 0;
  const capped = used >= limits.dailyTurns;
  const dailyPause: Action = { kind: "pause", cause: "daily", reason: text.reasonDailyCap(limits.dailyTurns) };
  const lead = input.nameOf(mission.leadBotId);
  const opener = text.whoIs(mission.createdBy, input.nameOf);

  if (state.answer) {
    if (capped) return dailyPause;
    return { kind: "send", as: "answer", botId: state.answer.botId, text: state.answer.text, attempts: 0 };
  }

  if (mission.status === "planning") {
    const attempts = inflight?.kind === "plan" ? inflight.attempts : 0;
    if (attempts >= limits.stepAttempts) return { kind: "pause", cause: "steps", reason: text.reasonNoPlan(attempts) };
    if (capped) return dailyPause;
    return {
      kind: "send", as: "plan", botId: mission.leadBotId, attempts: attempts + 1,
      text: text.planRequest({ lead, opener, title: mission.title, goal: mission.goal, team: input.teamOf(mission.teamBotIds), maxSteps: MAX_PLAN_STEPS }),
    };
  }

  const index = steps.findIndex((task) => task.status !== "done");
  if (index < 0) {
    if (state.closing && inflight?.kind === "close") return { kind: "finish" };
    if (capped) return dailyPause;
    return { kind: "send", as: "close", botId: mission.leadBotId, attempts: 1, text: text.closeRequest({ lead, opener, title: mission.title }) };
  }
  const current = steps[index]!;
  const assignee = current.assignee && !current.assignee.includes("@") ? current.assignee : mission.leadBotId;
  const who = input.nameOf(assignee);
  const sameStep = inflight?.kind === "step" && inflight.taskId === current.id;
  if (sameStep) {
    if (current.status === "review") return { kind: "wait" };
    if (inflight.attempts >= limits.stepAttempts) return { kind: "pause", cause: "steps", reason: text.reasonStalled(current.title, inflight.attempts) };
    if (capped) return dailyPause;
    return {
      kind: "send", as: "step", botId: assignee, taskId: current.id, attempts: inflight.attempts + 1,
      text: text.nudgeRequest({ assignee: who, opener, index: index + 1, total: steps.length, status: current.status, taskId: current.id }),
    };
  }
  if (capped) return dailyPause;
  return {
    kind: "send", as: "step", botId: assignee, taskId: current.id, attempts: 1,
    text: text.stepRequest({ assignee: who, lead, opener, index: index + 1, total: steps.length, mission: mission.title, task: current }),
  };
}
