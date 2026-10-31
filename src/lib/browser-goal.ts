import { TOOL_NAMESPACE } from "../../shared/tool-surface";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";

export type GoalStepKind = "read" | "click" | "fill" | "select" | "scroll" | "wait" | "cookies" | "dismiss";
export type GoalStatus = "running" | "done" | "blocked" | "approval" | "stopped" | "limit" | "unavailable";

export interface GoalLiveStep {
  kind: GoalStepKind;
  label: string;
  text?: string;
  url: string;
  title: string;
  at: number;
}

export interface GoalLiveRun {
  id: string;
  threadId: string;
  botId: string;
  botName: string;
  goal: string;
  startedAt: number;
  endedAt: number | null;
  status: GoalStatus;
  url: string;
  title: string;
  steps: GoalLiveStep[];
  frame?: string | null;
  frameAt: number | null;
}

function parsedObject(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

const bareName = (name: string) => name.toLowerCase().replace(TOOL_NAMESPACE, "");

/** Engines with deferred tools (Grok) call it through use_tool, with the real name and input inside. */
function goalCall(name: string, input: unknown): Record<string, unknown> | null {
  if (bareName(name) === "agent_browser_goal") return parsedObject(input) ?? {};
  if (bareName(name) !== "use_tool") return null;
  const wrapped = parsedObject(input);
  const inner = wrapped?.tool_name;
  if (typeof inner !== "string" || bareName(inner) !== "agent_browser_goal") return null;
  return parsedObject(wrapped?.tool_input ?? wrapped?.input) ?? {};
}

export function isBrowserGoalTool(name: string, input?: unknown): boolean {
  return goalCall(name, input) !== null;
}

export function goalOfInput(input: unknown, name = "agent_browser_goal"): string | null {
  const goal = goalCall(name, input)?.goal;
  return typeof goal === "string" ? goal : null;
}

/** The newest run stays open, live, until the bot's turn ends: the person watches the page while the bot reads it. */
/** A stop note waits for the turn to end: the bot may still be finishing the job another way. */
export function goalCardNote(status: GoalStatus | null, input: { running: boolean; live: boolean }): string | null {
  return status === null || input.running || input.live ? null : statusNote(status);
}

export function goalCardLive(input: { running: boolean; turnBusy: boolean; newest: boolean }): boolean {
  return input.running || (input.turnBusy && input.newest);
}

export function pickRun(runs: readonly GoalLiveRun[], goal: string | null, messageAt: number): GoalLiveRun | null {
  if (goal !== null) {
    const matching = runs.findLast((run) => run.goal === goal);
    if (matching) return matching;
  }
  return runs.findLast((run) => run.startedAt >= messageAt - 2_000) ?? null;
}

const STEP_KEYS: Record<GoalStepKind, LocaleKey> = {
  read: "browserGoal.step.read",
  click: "browserGoal.step.click",
  fill: "browserGoal.step.fill",
  select: "browserGoal.step.select",
  scroll: "browserGoal.step.scroll",
  wait: "browserGoal.step.wait",
  cookies: "browserGoal.step.cookies",
  dismiss: "browserGoal.step.dismiss",
};

const ACTION_KEYS: Record<GoalStepKind, LocaleKey> = {
  read: "browserGoal.action.read",
  click: "browserGoal.action.click",
  fill: "browserGoal.action.fill",
  select: "browserGoal.action.select",
  scroll: "browserGoal.action.scroll",
  wait: "browserGoal.action.wait",
  cookies: "browserGoal.action.cookies",
  dismiss: "browserGoal.action.dismiss",
};

export function stepPhrase(kind: GoalStepKind): string {
  return t(STEP_KEYS[kind]);
}

export function lastActionPhrase(run: Pick<GoalLiveRun, "steps" | "url"> | null): string {
  const last = run?.steps.at(-1);
  if (last) return t(ACTION_KEYS[last.kind]);
  return run?.url ? t("browserGoal.action.open") : t("browserGoal.action.starting");
}

export function addressLabel(url: string): string {
  if (!url) return "";
  try {
    const { host, pathname, search } = new URL(url);
    return `${host}${pathname === "/" ? "" : pathname}${search}`;
  } catch {
    return url.replace(/^[a-z]+:\/\//i, "");
  }
}

export function clockLabel(at: number): string {
  const date = new Date(at);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function elapsedSeconds(run: Pick<GoalLiveRun, "startedAt" | "endedAt">): string {
  const ms = Math.max(0, (run.endedAt ?? Date.now()) - run.startedAt);
  return (ms / 1000).toFixed(1).replace(".", t("browserGoal.decimal"));
}

export function endedSummary(run: GoalLiveRun): string {
  const count = run.steps.length;
  return t(count === 1 ? "browserGoal.summaryOne" : "browserGoal.summary", { seconds: elapsedSeconds(run), count });
}

const STATUS_KEYS: Partial<Record<GoalStatus, LocaleKey>> = {
  blocked: "browserGoal.status.blocked",
  approval: "browserGoal.status.approval",
  stopped: "browserGoal.status.stopped",
  limit: "browserGoal.status.limit",
  unavailable: "browserGoal.status.unavailable",
};

export function statusNote(status: GoalStatus): string | null {
  const key = STATUS_KEYS[status];
  return key ? t(key) : null;
}
