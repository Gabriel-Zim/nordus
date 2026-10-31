// A goal given to one bot in its own conversation: the bot keeps working turn after turn inside a turn and time budget,
// and the goal stops on its own when the criterion is met, the budget runs out, an approval waits, a turn ends with
// uncertain effects, or the person writes in the conversation.
import { GROUP_GOAL_CONTROL_CLOSE, GROUP_GOAL_CONTROL_OPEN, parseGroupGoalDecision } from "./group-goal-run.ts";
import type { GroupGoalRunStatus } from "../shared/group-goal-run.ts";

export const DIRECT_GOAL_DEFAULT_TURNS = 6;
export const DIRECT_GOAL_DEFAULT_MINUTES = 30;
const MAX_TURNS = 30;
const MAX_MINUTES = 240;
const EXTEND_TURNS = 3;
const EXTEND_MINUTES = 15;
const MINUTE = 60_000;
const MAX_STEPS = 50;

export type DirectGoalCommand =
  | { kind: "start"; goal: string; maxTurns: number; minutes: number }
  | { kind: "extend"; turns: number; minutes: number }
  | { kind: "resume" }
  | { kind: "stop" };

export type DirectGoalStopReason =
  | "completed" | "needs-input" | "blocked" | "turns" | "time" | "approval" | "uncertain" | "person" | "stopped";

export interface DirectGoalStep {
  turn: number;
  at: number;
  detail: string;
}

export interface DirectGoalRun {
  runId: string;
  botId: string;
  botName: string;
  threadId: string;
  goal: string;
  status: GroupGoalRunStatus;
  stopReason?: DirectGoalStopReason;
  detail?: string;
  turnCount: number;
  maxTurns: number;
  startedAt: number;
  deadlineAt: number;
  finishedAt?: number;
  steps: DirectGoalStep[];
}

export interface DirectGoalTarget {
  botId: string;
  botName: string;
  threadId: string;
}

export interface DirectGoalDeps {
  now(): number;
  newId(): string;
  /** Starts one goal turn with harness-authored text; never a message the person wrote. */
  startGoalTurn(run: DirectGoalRun, prompt: string): Promise<void>;
  /** Saves the run where the status line and the goal's record can read it. */
  publish(run: DirectGoalRun): void;
  /** A one-line notice in the conversation, for a command with nothing to act on or a goal that stopped. */
  note(run: DirectGoalRun | DirectGoalTarget, text: string): void;
  /** The goal stopped, for whatever reason: the one moment its outcome is worth telling the person. */
  ended(run: DirectGoalRun): void;
}

const NUMBER_WORDS: Record<string, number> = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, "três": 3, quatro: 4, cinco: 5, meia: 0.5 };
const AMOUNT = String.raw`(\d+|um|uma|dois|duas|tr[eê]s|quatro|cinco|meia)`;
const TURNS_RE = new RegExp(String.raw`(?:^|[\s+,])${AMOUNT}\s*(?:turnos?|rodadas?)\b`, "i");
const MINUTES_RE = new RegExp(String.raw`(?:^|[\s+,])${AMOUNT}\s*(?:min(?:utos?)?)(?![\p{L}])`, "iu");
const HOURS_RE = new RegExp(String.raw`(?:^|[\s+,])${AMOUNT}\s*(?:h|horas?)(?![\p{L}])`, "iu");
const BUDGET_ITEM = String.raw`${AMOUNT}\s*(?:turnos?|rodadas?|min(?:utos?)?|h|horas?)(?![\p{L}])`;
const BUDGET_LIST = String.raw`${BUDGET_ITEM}(?:\s*(?:e|,)\s*${BUDGET_ITEM})*`;
const BUDGET_PREFIX = String.raw`(?:no m[aá]ximo|em at[eé]|em|at[eé]|limite de|prazo de)`;
const BUDGET_TAIL = new RegExp(String.raw`(?:[,;]\s*(?:${BUDGET_PREFIX}\s+)?|\s${BUDGET_PREFIX}\s+)(${BUDGET_LIST})\s*[.!]?$`, "iu");

const amount = (raw: string | undefined): number | undefined => {
  if (!raw) return undefined;
  const word = NUMBER_WORDS[raw.toLocaleLowerCase()];
  return word ?? Number.parseInt(raw, 10);
};

function budgetIn(text: string): { turns?: number; minutes?: number } {
  const turns = amount(TURNS_RE.exec(text)?.[1]);
  const minutes = amount(MINUTES_RE.exec(text)?.[1]);
  const hours = amount(HOURS_RE.exec(text)?.[1]);
  const total = (minutes ?? 0) + (hours ?? 0) * 60;
  return {
    ...(turns !== undefined ? { turns } : {}),
    ...(minutes !== undefined || hours !== undefined ? { minutes: Math.round(total) } : {}),
  };
}

const clamp = (value: number, max: number) => Math.max(1, Math.min(max, value));

export function parseDirectGoalCommand(text: string): DirectGoalCommand | null {
  const match = /^\/goal(?:\s+([\s\S]*))?$/i.exec(text.trim());
  if (!match) return null;
  const body = (match[1] ?? "").trim();
  if (!body) return null;
  const word = body.toLocaleLowerCase();
  if (/^(parar|pare|para|stop)$/.test(word)) return { kind: "stop" };
  if (/^(continuar|continua|retomar|retoma|resume)$/.test(word)) return { kind: "resume" };
  if (/^(estender|estende)(?![\p{L}])|^\+/u.test(word)) {
    const budget = budgetIn(body.replace(/\+/g, " "));
    if (budget.turns === undefined && budget.minutes === undefined) {
      return { kind: "extend", turns: EXTEND_TURNS, minutes: EXTEND_MINUTES };
    }
    return {
      kind: "extend",
      turns: Math.min(MAX_TURNS, budget.turns ?? 0),
      minutes: Math.min(MAX_MINUTES, budget.minutes ?? 0),
    };
  }
  const tail = BUDGET_TAIL.exec(body)?.[1];
  const budget = tail ? budgetIn(` ${tail}`) : {};
  return {
    kind: "start",
    goal: body,
    maxTurns: clamp(budget.turns ?? DIRECT_GOAL_DEFAULT_TURNS, MAX_TURNS),
    minutes: clamp(budget.minutes ?? DIRECT_GOAL_DEFAULT_MINUTES, MAX_MINUTES),
  };
}

type DirectGoalDecision = { status: "continue" | "completed" | "needs-input" | "blocked"; detail: string };

/** The bot's last private envelope, and the text the person may see. */
export function parseDirectGoalDecision(text: string): { visibleText: string; decision: DirectGoalDecision | null } {
  const visibleText = parseGroupGoalDecision(text).visibleText;
  const closeAt = text.lastIndexOf(GROUP_GOAL_CONTROL_CLOSE);
  const openAt = closeAt < 0 ? -1 : text.lastIndexOf(GROUP_GOAL_CONTROL_OPEN, closeAt);
  if (openAt < 0) return { visibleText, decision: null };
  try {
    const raw = JSON.parse(text.slice(openAt + GROUP_GOAL_CONTROL_OPEN.length, closeAt).trim()) as Record<string, unknown>;
    const detail = typeof raw.detail === "string" ? raw.detail.trim().slice(0, 500) : "";
    if (raw.status === "continue" || raw.status === "completed" || raw.status === "needs-input" || raw.status === "blocked") {
      return { visibleText, decision: { status: raw.status, detail } };
    }
  } catch {
    // A malformed envelope counts as no decision: the budget still bounds the run.
  }
  return { visibleText, decision: null };
}

export function directGoalInstructions(run: DirectGoalRun, now: number): string {
  const turnsLeft = run.maxTurns - run.turnCount;
  const minutesLeft = Math.max(0, Math.round((run.deadlineAt - now) / MINUTE));
  const steps = run.steps.slice(-10).map((step) => `- turn ${step.turn}: ${step.detail}`);
  return [
    "[Nordus: the person gave you a bounded goal in this conversation. Keep working on it on your own.",
    `Goal, with its completion criterion: ${run.goal}`,
    `This is goal turn ${run.turnCount} of ${run.maxTurns}; ${turnsLeft} more turn(s) and about ${minutesLeft} minute(s) remain.`,
    ...(steps.length ? ["Steps observed so far:", ...steps] : []),
    "Check the current state before repeating anything with an outside effect (a publish, a send, a paid generation).",
    "Every approval and permission still applies. Never widen access to finish faster.",
    "Ending a turn does not finish the goal. Claim completion only when the criterion is verified in this conversation.",
    "Write a short update or the finished result for the person, in the language of the goal, then end with exactly one private line:",
    `${GROUP_GOAL_CONTROL_OPEN}{"status":"continue","detail":"what you did and what is next"}${GROUP_GOAL_CONTROL_CLOSE}`,
    `Use status "completed" (with the evidence), "needs-input" (with your question) or "blocked" (with the reason) instead when that is true.`,
    "Never mention the private line, turns or the budget to the person.]",
  ].join("\n");
}

const STOP_STATUS: Record<DirectGoalStopReason, GroupGoalRunStatus> = {
  completed: "completed",
  "needs-input": "needs-input",
  blocked: "blocked",
  turns: "limit-reached",
  time: "limit-reached",
  approval: "needs-input",
  uncertain: "stopped",
  person: "paused",
  stopped: "stopped",
};

const STOP_NOTE: Partial<Record<DirectGoalStopReason, string>> = {
  turns: "Objetivo pausado: os turnos acabaram. Escreva /goal estender para dar mais tempo.",
  time: "Objetivo pausado: o prazo acabou. Escreva /goal estender para dar mais tempo.",
  approval: "Objetivo pausado esperando sua aprovação. Depois escreva /goal continuar.",
  uncertain: "Objetivo parado: o último turno não terminou direito e algo pode ter sido feito pela metade. Confira e escreva /goal continuar.",
  person: "Objetivo pausado porque você entrou na conversa. Escreva /goal continuar para retomar.",
};

export class DirectGoals {
  private readonly runs = new Map<string, DirectGoalRun>();
  private readonly openApprovals = new Map<string, Set<string>>();
  private readonly deps: DirectGoalDeps;

  constructor(deps: DirectGoalDeps) {
    this.deps = deps;
  }

  /** The goal working in this conversation right now. */
  active(threadId: string): DirectGoalRun | null {
    const run = this.runs.get(threadId);
    return run?.status === "working" ? run : null;
  }

  /** Why this command cannot run now, in words for the person; null when it can. */
  refusal(threadId: string, command: DirectGoalCommand): string | null {
    if (command.kind === "start" && this.active(threadId)) {
      return "Já tem um objetivo em andamento nesta conversa. Escreva /goal parar antes de começar outro.";
    }
    return null;
  }

  async command(target: DirectGoalTarget, command: DirectGoalCommand): Promise<void> {
    const refused = this.refusal(target.threadId, command);
    if (refused) {
      this.deps.note(target, refused);
      return;
    }
    const current = this.runs.get(target.threadId);
    const now = this.deps.now();
    if (command.kind === "start") {
      const run: DirectGoalRun = {
        runId: this.deps.newId(),
        botId: target.botId,
        botName: target.botName,
        threadId: target.threadId,
        goal: command.goal,
        status: "working",
        turnCount: 0,
        maxTurns: command.maxTurns,
        startedAt: now,
        deadlineAt: now + command.minutes * MINUTE,
        steps: [],
      };
      this.runs.set(target.threadId, run);
      await this.startTurn(run);
      return;
    }
    if (!current) {
      this.deps.note(target, "Nenhum objetivo nesta conversa. Comece com /goal e o que precisa ficar pronto.");
      return;
    }
    if (command.kind === "stop") {
      if (current.status !== "working") {
        this.deps.note(target, "Nenhum objetivo em andamento nesta conversa.");
        return;
      }
      this.finish(current, "stopped", "Parado por você.");
      return;
    }
    if (command.kind === "extend") {
      current.maxTurns = Math.min(MAX_TURNS + current.turnCount, current.maxTurns + command.turns);
      if (command.minutes > 0) current.deadlineAt = Math.max(current.deadlineAt, now) + command.minutes * MINUTE;
    }
    if (current.status === "working") {
      this.deps.publish(current);
      return;
    }
    if (!this.budgetLeft(current, now)) {
      this.deps.note(current, "O orçamento deste objetivo acabou. Escreva /goal estender para dar mais tempo.");
      return;
    }
    current.status = "working";
    delete current.stopReason;
    delete current.finishedAt;
    await this.startTurn(current);
  }

  /** The person wrote in the conversation: a working goal pauses at once. */
  pauseForPerson(threadId: string): boolean {
    const run = this.active(threadId);
    if (!run) return false;
    this.finish(run, "person", "Pausado porque você entrou na conversa.");
    return true;
  }

  approvalOpened(threadId: string, requestId: string): void {
    if (!this.active(threadId)) return;
    const open = this.openApprovals.get(threadId) ?? new Set<string>();
    open.add(requestId);
    this.openApprovals.set(threadId, open);
  }

  /** Answered by the person, by auto mode or a saved rule, or closed by the harness: it no longer waits on anyone. */
  approvalResolved(threadId: string, requestId: string): void {
    const open = this.openApprovals.get(threadId);
    open?.delete(requestId);
    if (open?.size === 0) this.openApprovals.delete(threadId);
  }

  /** One goal turn settled. `ok: false` means it ended without a clean result. */
  async turnEnded(threadId: string, outcome: { ok: boolean; text: string }): Promise<void> {
    const run = this.runs.get(threadId);
    if (!run) return;
    const { visibleText, decision } = parseDirectGoalDecision(outcome.text);
    const detail = (decision?.detail || visibleText.slice(-300)).trim();
    if (detail) run.steps = [...run.steps, { turn: run.turnCount, at: this.deps.now(), detail }].slice(-MAX_STEPS);
    if (run.status !== "working") {
      this.deps.publish(run);
      return;
    }
    if (!outcome.ok) return this.finish(run, "uncertain", detail || "O turno terminou sem resultado claro.");
    if (this.openApprovals.has(threadId)) return this.finish(run, "approval", detail || "Esperando aprovação.");
    if (decision && decision.status !== "continue") return this.finish(run, decision.status, detail);
    const now = this.deps.now();
    if (run.turnCount >= run.maxTurns) return this.finish(run, "turns", detail);
    if (now >= run.deadlineAt) return this.finish(run, "time", detail);
    await this.startTurn(run);
  }

  private budgetLeft(run: DirectGoalRun, now: number): boolean {
    return run.turnCount < run.maxTurns && now < run.deadlineAt;
  }

  private async startTurn(run: DirectGoalRun): Promise<void> {
    run.turnCount += 1;
    this.deps.publish(run);
    try {
      await this.deps.startGoalTurn(run, directGoalInstructions(run, this.deps.now()));
    } catch (error) {
      if (run.status === "working") this.finish(run, "uncertain", error instanceof Error ? error.message : String(error));
    }
  }

  private finish(run: DirectGoalRun, reason: DirectGoalStopReason, detail: string): void {
    run.status = STOP_STATUS[reason];
    run.stopReason = reason;
    run.detail = detail.slice(0, 500);
    run.finishedAt = this.deps.now();
    this.deps.publish(run);
    const note = STOP_NOTE[reason];
    if (note) this.deps.note(run, note);
    this.deps.ended(run);
  }
}
