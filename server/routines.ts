import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";

import { DATA_DIR } from "./config.ts";
import type { RuntimeEvent } from "./contracts.ts";
import { writeFileAtomic } from "./atomic.ts";
import { redactSecretsInText } from "./redact.ts";
import { activeRunsOf, nextDueOf, wakeHoldOf } from "./routine-due.ts";
import type { GroupGoalRunStatus } from "../shared/group-goal-run.ts";
import type { RoutineRequestOperation } from "../shared/routine-request.ts";
import { intervalAllowsOccurrence, intervalHasRestrictions, isSameLocalDay, latestIntervalOccurrence, MAX_DATE_MS } from "./routine-intervals.ts";
import { cleanSchedule, cloneSchedule, limitResetOccurrence, loadSchedule, mergeScheduleUpdate, nextOccurrence, RoutineScheduleError, type RoutineSchedule, type RoutineScheduleInput } from "./routine-schedules.ts";
import { runsOnce } from "../shared/limit-reset.ts";
import {
  cleanCatchUpMinutes, isRoutineProblemRun, ROUTINE_CATCH_UP_DEFAULT_MINUTES,
  type RoutineContextAttachment, type RoutineIntervalWindow, type RoutineRetryCause, type RoutineRunReport, type RoutineRunStatus, type RoutineRunTrigger,
} from "../shared/routines.ts";
import { ROUTINE_PARTS, type PartPair, type RoutinePart } from "./package-parts.ts";
import {
  composeExecutionPrompt, continuityCarry, isNothingNewReply, isSilentReply, ROUTINE_DEFERRAL_NOTICE_MS, ROUTINE_PAUSE_AFTER_FAILURES, ROUTINE_QUIET_OUTPUT,
  ROUTINE_RETRY_SCHEDULE_MS, ROUTINE_SKIPPED_WHILE_WAITING, ROUTINE_SUPERSEDED, routineFailure, routineHostWarning, routineRetriesSoFar, routineRetryDelayMs,
  skipNeedsNotice, supersededBy, withPreCheckContext,
} from "./routine-execution.ts";
import {
  classifyRoutineFailure, dispatchRefusal, engineFacts, loadOwnerNotices, recoverRun, requeueOnce, weekRuns, type RoutineAlert, type RoutineFailureFacts, type RoutineOwnerNotice,
} from "./routine-recovery.ts";
import { activeMs, askOf, settleAsk, waitingFor, type RoutineRunAsk } from "./routine-waits.ts";
import { failsLikeLastOutcome, outcomesNewestFirst } from "./routine-outcomes.ts";
import { EVENT_RETRY_WINDOW_MS, loadEventReceipts, MAX_EVENT_RECEIPTS, type EventRunReceipt } from "./routine-event-receipts.ts";
import { cleanAttachments, cleanTimeoutMinutes, cloneAttachments, loadAttachments, loadTimeoutMinutes } from "./routine-attachments.ts";

export type { RoutineContextAttachment, RoutineIntervalWindow, RoutineRunStatus, RoutineRunTrigger };
export { intervalHasRestrictions } from "./routine-intervals.ts";
export { nextOccurrence, RoutineScheduleError } from "./routine-schedules.ts";
export type { RoutineIntervalSchedule, RoutineIntervalScheduleInput, RoutineSchedule, RoutineScheduleInput } from "./routine-schedules.ts";

/** `cloud` runs the agent inside the bot's Boat VM; `nordus` runs the bot's own provider and borrows only its computer tools. */
export type RoutineRunOn = "nordus" | "cloud";
export type RoutineTarget = "bot" | "room-goal";
export type RoutineGoalStatus = Exclude<GroupGoalRunStatus, "working">;

const persistedSourceThreadId = z.string().trim().min(1).optional().catch(undefined);

export interface Routine {
  id: string;
  name: string;
  prompt: string;
  target: RoutineTarget;
  botId: string;
  groupId?: string;
  runOn: RoutineRunOn;
  enabled: boolean;
  schedule: RoutineSchedule;
  durationMinutes: number;
  timeoutMinutes?: number;
  catchUpMinutes?: number;
  attachments?: RoutineContextAttachment[];
  continuity?: boolean;
  overlap?: "skip" | "queue";
  runOnStartup?: boolean;
  /** Internal check run before each scheduled turn; when it says there is nothing to do, the bot is not started. */
  preCheck?: string;
  /** A run with nothing new stays in the routine's history and posts nothing. Bot routines only. */
  reportOnlyNews?: boolean;
  skippedRuns?: number;
  lastSkippedAt?: number;
  failureStreak?: number;
  weekRuns?: { ok: number; total: number };
  warning?: string;
  sourceThreadId?: string;
  resultsThreadId?: string;
  installedPackage?: RoutinePackageStamp;
  nextRunAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface RoutinePackageStamp {
  installId: string;
  key: string;
  parts: Record<RoutinePart, PartPair>;
}

const HASH = /^[a-f0-9]{64}$/;
function loadInstalledPackage(value: unknown): RoutinePackageStamp | undefined {
  if (!value || typeof value !== "object") return undefined;
  const stamp = value as Partial<RoutinePackageStamp>;
  if (typeof stamp.installId !== "string" || !/^[a-f0-9]{32}$/.test(stamp.installId) || typeof stamp.key !== "string" || !stamp.key || stamp.key.length > 80) return undefined;
  const parts = stamp.parts as Record<string, Partial<PartPair>> | undefined;
  if (!parts || typeof parts !== "object" || !ROUTINE_PARTS.every((part) => HASH.test(String(parts[part]?.r)) && HASH.test(String(parts[part]?.w)))) return undefined;
  return {
    installId: stamp.installId,
    key: stamp.key,
    parts: Object.fromEntries(ROUTINE_PARTS.map((part) => [part, { r: parts[part]!.r!, w: parts[part]!.w! }])) as Record<RoutinePart, PartPair>,
  };
}

export interface RoutineRun {
  id: string;
  routineId: string;
  routineName: string;
  prompt?: string;
  durationMinutes?: number;
  timeoutMinutes?: number;
  attachments?: RoutineContextAttachment[];
  target: RoutineTarget;
  goalStatus?: RoutineGoalStatus;
  groupId?: string;
  botId: string;
  runOn: RoutineRunOn;
  scheduledFor: number;
  status: RoutineRunStatus;
  manual: boolean;
  deferredAt?: number;
  deferredNoticeAt?: number;
  /** A queued run starts no earlier than this. */
  retryAt?: number;
  /** How many times a transient failure re-queued this run (at most three). */
  retryCount?: number;
  /** This failure was the one that paused the routine. */
  routinePaused?: boolean;
  retried?: RoutineRetryCause;
  /** When its current wait began; read only while the run is waiting. */
  waitingSince?: number;
  asked?: RoutineRunAsk;
  /** Time spent waiting on the person's answers, which the run limit does not count. */
  waitedMs?: number;
  triggerSource?: RoutineRunTrigger;
  /** "app": a connected-app event started it (its triggerSource stays "webhook", an outside event). */
  eventSource?: "app";
  webhookId?: string;
  deliveryId?: string;
  sourceThreadId?: string;
  resultsThreadId?: string;
  threadId?: string;
  startedAt?: number;
  finishedAt?: number;
  output?: string;
  attention?: string;
  error?: string;
  cost?: number | null;
  denials?: string[];
  /** Copied from the routine when the run was queued. */
  preCheck?: string;
  /** What the pre-check handed the bot, so the same finding is not raised twice. */
  preCheckKeys?: string[];
  /** Copied from the routine when the run was queued. */
  reportOnlyNews?: true;
  /** Nothing new: the pre-check kept the bot asleep, or the bot answered [SILENT] or the news-only token. Posts nothing, notifies no one. */
  quiet?: true;
  report?: RoutineRunReport;
  createdAt: number;
  seenAt?: number;
}

export interface RoutineRequestReceipt {
  requestId: string;
  messageId: string;
  botId: string;
  threadId: string;
  action: RoutineRequestOperation["action"];
  fingerprintVersion: 1;
  fingerprint: string;
  resultId: string;
  appliedAt: number;
}

export interface RoutineRequestCommit {
  requestId: string;
  messageId: string;
  botId: string;
  threadId: string;
  action: RoutineRequestOperation["action"];
  fingerprintVersion: 1;
  fingerprint: string;
}

type RoutineRequestCommitFor<Action extends RoutineRequestOperation["action"]> =
  Omit<RoutineRequestCommit, "action"> & { action: Action };

export interface RoutineInput {
  name: string;
  prompt: string;
  target?: RoutineTarget;
  botId: string;
  groupId?: string | null;
  runOn?: RoutineRunOn;
  enabled?: boolean;
  schedule: RoutineScheduleInput;
  durationMinutes?: number;
  timeoutMinutes?: number | null;
  catchUpMinutes?: number | null;
  attachments?: RoutineContextAttachment[];
  continuity?: boolean;
  overlap?: "skip" | "queue";
  runOnStartup?: boolean;
  /** `null` removes it on updates. */
  preCheck?: string | null;
  /** `false` removes it on updates. */
  reportOnlyNews?: boolean;
  resultsThreadId?: string | null;
}

export interface RoutinePreCheckDecision {
  wake: boolean;
  context?: string;
  keys?: string[];
}

interface RoutineFile {
  version: 1;
  frozenResultsCleared?: true;
  routines: Routine[];
  runs: RoutineRun[];
  routineRequestReceipts?: RoutineRequestReceipt[];
  webhookRunReceipts?: EventRunReceipt[];
  startupLaunchId?: string;
  ownerNotices?: RoutineOwnerNotice[];
}


export type RoutineRequestOwner = Pick<RoutineRequestReceipt, "requestId" | "messageId" | "botId" | "threadId">;

type ResultsThreadAllocation = { botId: string; threadId: string };

function routineRequestOwnerKey(owner: RoutineRequestOwner): string {
  return JSON.stringify([owner.requestId, owner.messageId, owner.botId, owner.threadId]);
}

export interface RoutineManagerOptions {
  file?: string;
  now?: () => number;
  /** Every payload must be `{ kind, … }`: the server numbers and replays frames by it. */
  emit?: (payload: Record<string, unknown>) => void;
  botState: (botId: string) => "ready" | "busy" | "missing";
  goalState?: (groupId: string, coordinatorBotId: string) => "ready" | "busy" | "missing";
  createTask: (botId: string, title: string, run?: RoutineRun) => { threadId: string } | null;
  joinConversation?: (run: RoutineRun) => string | null;
  createGoalTask?: (groupId: string, title: string) => { threadId: string } | null;
  isResultsThread?: (botId: string, threadId: string) => boolean;
  resolveResultsThread?: (routine: Routine, forceNew: boolean) => { threadId: string; main?: true } | undefined;
  eventResultsThread?: (event: { webhookId: string; webhookName: string; botId: string }) => string | undefined;
  frozenResultsThread?: (botId: string, threadId: string) => boolean;
  discardResultsThread?: (botId: string, threadId: string) => void;
  startTurn: (
    botId: string,
    threadId: string,
    prompt: string,
    runOn: RoutineRunOn,
    triggerSource: RoutineRunTrigger,
    onDispatchError: (message: string) => void,
  ) => Promise<void>;
  startGoal?: (
    groupId: string,
    threadId: string,
    prompt: string,
    coordinatorBotId: string,
    runId: string,
    onDispatchError: (message: string) => void,
  ) => Promise<void>;
  interruptTurn?: (botId: string, threadId: string) => Promise<void>;
  interruptGoal?: (
    groupId: string,
    threadId: string,
    outcome?: { status: "stopped" | "limit-reached"; detail: string },
  ) => Promise<void>;
  onRunChanged?: (run: RoutineRun) => void;
  onRunFailed?: (run: RoutineRun, alert?: RoutineAlert | null) => void;
  onRunDeferred?: (run: RoutineRun, alert?: RoutineAlert) => void;
  /** A run a restart cut off, before it starts again or fails: its old turn's work must not resume as well. */
  onRunCut?: (run: RoutineRun) => void;
  hasPendingDelegations?: (threadId: string) => boolean;
  /** Nordus: the decision model's reading of a news-only run's reply the rule did not take as NADA_NOVO: true only when
   * it says nothing changed. Any failure is false, and the run reports as today; undefined is not asked at all. */
  nothingNew?: (input: { reply: string; prompt: string }) => Promise<boolean> | undefined;
  /** Runs the routine's pre-check; a failure wakes the bot as if there were no check. */
  preCheck?: (run: RoutineRun) => Promise<RoutinePreCheckDecision>;
  /** The turn in this thread is a routine's own, not one a person started there while its run waits on teammates. */
  routineTurn?: (threadId: string) => boolean;
  /** When an engine's usage limit resets (epoch ms), or null while that is not known. */
  limitResetAt?: (engine: string) => number | null;
  /** The bot has a backup engine to continue on when its own engine's usage limit refuses a run. */
  limitBackup?: (botId: string) => boolean;
  /** Work this thread handed to another bot is still open, so its wait is not only on the person. */
  handedOffWorkLive?: (threadId: string) => boolean;
  launchId?: string;
  /** A Cloud home woken from a sleep it was stopped for (server/cloud-power.ts): not a startup, so no "run on startup". */
  skipStartupRuns?: boolean;
}

/** A tick runs every 10 s: a run this late is on time, whatever its window. */
const ON_TIME_MS = 60_000;
const catchUpMs = (routine: Pick<Routine, "catchUpMinutes">) =>
  Math.max(ON_TIME_MS, (routine.catchUpMinutes ?? ROUTINE_CATCH_UP_DEFAULT_MINUTES) * 60_000);

/** The person reads this on the run: plain Brazilian Portuguese. */
function missedDetail(routine: Pick<Routine, "catchUpMinutes">): string {
  const minutes = routine.catchUpMinutes ?? ROUTINE_CATCH_UP_DEFAULT_MINUTES;
  if (minutes === 0) return "Não executada: o Nordus estava desligado no horário e esta rotina só roda na hora certa.";
  const window = minutes % 60 === 0 ? `${minutes / 60} hora${minutes === 60 ? "" : "s"}` : `${minutes} minutos`;
  return `Não executada: o Nordus ficou desligado por mais de ${window} depois do horário, o atraso máximo desta rotina.`;
}
const WAKE_HORIZON_MS = 60 * 60_000;

export const ROUTINE_RESTARTED = "Nordus restarted while this routine was running";
const MAX_RUNS = 2_000;
const ROUTINE_REQUEST_ACTIONS = new Set<RoutineRequestOperation["action"]>([
  "create",
  "update",
  "pause",
  "resume",
  "run_now",
  "delete",
]);

function isRoutineRequestAction(value: unknown): value is RoutineRequestOperation["action"] {
  return typeof value === "string" && ROUTINE_REQUEST_ACTIONS.has(value as RoutineRequestOperation["action"]);
}

const PRE_CHECK_PATH = /^\/api\/internal\/[\w-]+(?:\?[\w=&-]*)?$/;

function cleanPreCheck(value: unknown): string | undefined {
  if (value == null || value === "") return undefined;
  if (typeof value !== "string" || value.length > 200 || !PRE_CHECK_PATH.test(value.trim())) {
    throw new Error("A pre-check must be an internal path such as /api/internal/ops-snapshot");
  }
  return value.trim();
}

function loadPreCheck(value: unknown): string | undefined {
  try {
    return cleanPreCheck(value);
  } catch {
    return undefined;
  }
}

function loadCatchUpMinutes(value: unknown): number | undefined {
  try {
    return cleanCatchUpMinutes(value);
  } catch {
    return undefined;
  }
}

function loadTarget(value: unknown): RoutineTarget {
  return value === "room-goal" ? "room-goal" : "bot";
}

const ROUTINE_GOAL_STATUSES = new Set<RoutineGoalStatus>([
  "completed",
  "needs-input",
  "blocked",
  "limit-reached",
  "paused",
  "stopped",
  "failed",
]);

function loadGoalStatus(value: unknown, target: RoutineTarget): RoutineGoalStatus | undefined {
  return target === "room-goal" && typeof value === "string" && ROUTINE_GOAL_STATUSES.has(value as RoutineGoalStatus)
    ? value as RoutineGoalStatus
    : undefined;
}

function loadGroupId(value: unknown, target: RoutineTarget): string | undefined {
  if (target !== "room-goal" || typeof value !== "string") return undefined;
  return value.trim() || undefined;
}

function cloneRoutine(routine: Routine): Routine {
  return {
    ...routine,
    schedule: cloneSchedule(routine.schedule),
    attachments: cloneAttachments(routine.attachments),
  };
}

function cloneRun(run: RoutineRun): RoutineRun {
  return {
    ...run,
    attachments: cloneAttachments(run.attachments),
    denials: run.denials ? [...run.denials] : undefined,
  };
}

/** Quiet stands only for a run that completed with nothing new. */
function clearQuiet(run: RoutineRun): void {
  if (!run.quiet) return;
  delete run.quiet;
  if (run.output === ROUTINE_QUIET_OUTPUT) delete run.output;
}

function sanitizeInput(input: RoutineInput, after: number): Omit<Routine, "id" | "createdAt" | "updatedAt" | "nextRunAt"> {
  const name = String(input.name ?? "").trim().slice(0, 80);
  const prompt = String(input.prompt ?? "").trim().slice(0, 20_000);
  const botId = String(input.botId ?? "").trim();
  if (!name) throw new Error("Give the routine a name");
  if (!prompt) throw new Error("Tell the bot what to do");
  if (!botId) throw new Error("Choose a bot");
  const target = input.target ?? "bot";
  if (target !== "bot" && target !== "room-goal") throw new Error("Choose a valid routine target");
  const groupId = typeof input.groupId === "string" ? input.groupId.trim() : "";
  if (target === "room-goal" && !groupId) throw new Error("Choose a room for this goal");
  const runOn = input.runOn ?? "nordus";
  if (runOn !== "nordus" && runOn !== "cloud") throw new Error("Choose where this routine runs");
  const attachments = cleanAttachments(input.attachments);
  const timeoutMinutes = cleanTimeoutMinutes(input.timeoutMinutes);
  const catchUpMinutes = cleanCatchUpMinutes(input.catchUpMinutes);
  if (target === "room-goal" && runOn === "cloud") {
    throw new Error("Room goals can only run on this computer");
  }
  if (target === "room-goal" && attachments.length > 0) {
    throw new Error("Room goals do not support attachments yet");
  }
  if (runOn === "cloud" && attachments.length > 0) {
    throw new Error("Attachments can only run on this computer until cloud file staging is available");
  }
  const continuity = input.continuity === true;
  if (input.overlap !== undefined && input.overlap !== "skip" && input.overlap !== "queue") {
    throw new Error("Choose skip or queue for overlapping runs");
  }
  if (continuity && target === "room-goal") {
    throw new Error("Room goals do not carry continuity yet");
  }
  const schedule = cleanSchedule(input.schedule, after);
  const preCheck = cleanPreCheck(input.preCheck);
  if (preCheck && target !== "bot") throw new Error("Only bot routines can have a pre-check");
  const reportOnlyNews = input.reportOnlyNews === true;
  if (reportOnlyNews && target !== "bot") throw new Error("Only bot routines can report only news");
  return {
    name,
    prompt,
    target,
    botId,
    groupId: target === "room-goal" ? groupId : undefined,
    runOn,
    enabled: input.enabled !== false,
    schedule,
    durationMinutes: Math.min(240, Math.max(5, Math.round(Number(input.durationMinutes) || 30))),
    ...(timeoutMinutes === undefined ? {} : { timeoutMinutes }),
    ...(catchUpMinutes === undefined ? {} : { catchUpMinutes }),
    attachments,
    ...(continuity ? { continuity: true } : {}),
    ...(input.overlap === "queue" ? { overlap: "queue" as const } : {}),
    ...(input.runOnStartup === true && !runsOnce(schedule) ? { runOnStartup: true } : {}),
    ...(preCheck ? { preCheck } : {}),
    ...(reportOnlyNews ? { reportOnlyNews: true } : {}),
  };
}

export class RoutineManager {
  private readonly file: string;
  private readonly now: () => number;
  private readonly options: RoutineManagerOptions;
  private routines: Routine[] = [];
  /** Written back unchanged on every save, so unrelated work never deletes a repairable row. */
  private unloadedRoutines: Routine[] = [];
  private runs: RoutineRun[] = [];
  /** A news-only run's reply the decision model is still reading, by the run's conversation. */
  private readonly newsChecks = new Map<string, { runId: string; output: string; done: boolean; promise: Promise<void> }>();
  private routineRequestReceipts: RoutineRequestReceipt[] = [];
  private webhookRunReceipts: EventRunReceipt[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private startupRunsQueued = false;
  private startupLaunchId: string | undefined;
  private ticking = false;
  private closing = false;
  private ownerNotices: RoutineOwnerNotice[] = [];
  private readonly failureFacts = new Map<string, RoutineFailureFacts>();
  /** Saves are refused while set, so an empty state never overwrites an unreadable file. */
  private unreadable = false;
  private frozenPending = false;

  constructor(options: RoutineManagerOptions) {
    this.options = options;
    this.file = options.file ?? join(DATA_DIR, "routines.json");
    this.now = options.now ?? Date.now;
    try {
      const disk = JSON.parse(readFileSync(this.file, "utf8")) as Partial<RoutineFile>;
      if (disk === null || typeof disk !== "object" || Array.isArray(disk)) throw new Error("Invalid routines file");
      for (const key of ["routines", "runs", "routineRequestReceipts", "webhookRunReceipts"] as const) {
        if (key in disk && !Array.isArray(disk[key])) throw new Error(`Invalid routines file: ${key} is not a list`);
      }
      this.routines = Array.isArray(disk.routines)
        ? disk.routines.flatMap((routine) => {
            const schedule = loadSchedule(routine.schedule, this.now());
            if (!schedule) {
              console.warn(`routines: keeping ${String(routine.id)} on disk unscheduled; its schedule could not load`);
              this.unloadedRoutines.push(routine);
              return [];
            }
            const target = loadTarget(routine.target);
            const loaded: Routine = {
              ...routine,
              schedule,
              target,
              groupId: loadGroupId(routine.groupId, target),
              runOn: routine.runOn ?? "nordus",
              timeoutMinutes: loadTimeoutMinutes(routine.timeoutMinutes),
              catchUpMinutes: loadCatchUpMinutes(routine.catchUpMinutes),
              attachments: loadAttachments(routine.attachments),
              sourceThreadId: persistedSourceThreadId.parse(routine.sourceThreadId),
              resultsThreadId: persistedSourceThreadId.parse(routine.resultsThreadId),
              overlap: routine.overlap === "queue" ? "queue" : undefined,
              runOnStartup: routine.runOnStartup === true ? true : undefined,
              preCheck: loadPreCheck(routine.preCheck),
              reportOnlyNews: routine.reportOnlyNews === true && target === "bot" ? true : undefined,
              skippedRuns: Number.isSafeInteger(routine.skippedRuns) && routine.skippedRuns! > 0 ? routine.skippedRuns : undefined,
              lastSkippedAt: Number.isSafeInteger(routine.lastSkippedAt) && routine.lastSkippedAt! >= 0 && routine.lastSkippedAt! <= MAX_DATE_MS ? routine.lastSkippedAt : undefined,
              installedPackage: loadInstalledPackage(routine.installedPackage),
            };
            if (loaded.timeoutMinutes === undefined) delete loaded.timeoutMinutes;
            if (loaded.catchUpMinutes === undefined) delete loaded.catchUpMinutes;
            if (loaded.runOnStartup === undefined) delete loaded.runOnStartup;
            if (loaded.preCheck === undefined) delete loaded.preCheck;
            if (loaded.reportOnlyNews === undefined) delete loaded.reportOnlyNews;
            if (loaded.installedPackage === undefined) delete loaded.installedPackage;
            delete loaded.failureStreak;
            return [loaded];
          })
        : [];
      this.runs = Array.isArray(disk.runs)
        ? disk.runs.map((run) => {
            const target = loadTarget(run.target);
            const loaded: RoutineRun = {
              ...run,
              target,
              goalStatus: loadGoalStatus(run.goalStatus, target),
              groupId: loadGroupId(run.groupId, target),
              runOn: run.runOn ?? "nordus",
              timeoutMinutes: loadTimeoutMinutes(run.timeoutMinutes),
              attachments: loadAttachments(run.attachments),
              sourceThreadId: persistedSourceThreadId.parse(run.sourceThreadId),
              resultsThreadId: persistedSourceThreadId.parse(run.resultsThreadId),
            };
            if (loaded.timeoutMinutes === undefined) delete loaded.timeoutMinutes;
            return loaded;
          })
        : [];
      this.routineRequestReceipts = Array.isArray(disk.routineRequestReceipts)
        ? disk.routineRequestReceipts.filter((receipt): receipt is RoutineRequestReceipt =>
            typeof receipt?.requestId === "string" &&
            typeof receipt?.messageId === "string" &&
            typeof receipt?.botId === "string" &&
            typeof receipt?.threadId === "string" &&
            isRoutineRequestAction(receipt?.action) &&
            receipt?.fingerprintVersion === 1 &&
            typeof receipt?.fingerprint === "string" && /^[a-f0-9]{64}$/.test(receipt.fingerprint) &&
            typeof receipt?.resultId === "string" &&
            Number.isFinite(receipt?.appliedAt)
          )
        : [];
      this.webhookRunReceipts = loadEventReceipts(disk.webhookRunReceipts, this.runs, this.now());
      this.frozenPending = disk.frozenResultsCleared !== true;
      this.ownerNotices = loadOwnerNotices(disk.ownerNotices);
      if (typeof disk.startupLaunchId === "string") this.startupLaunchId = disk.startupLaunchId;
    } catch (error) {
      this.routines = [];
      this.unloadedRoutines = [];
      this.runs = [];
      this.routineRequestReceipts = [];
      this.webhookRunReceipts = [];
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        this.unreadable = true;
        // JSON.parse errors can echo a fragment of the input, so they never reach the log.
        const reason = error instanceof SyntaxError ? "invalid JSON"
          : error instanceof Error ? error.message : "unable to read routines";
        console.error(`routines: ignoring unreadable ${this.file}: ${reason}`);
      }
    }
    const cut: RoutineRun[] = [];
    for (const run of this.runs.filter((candidate) => candidate.status === "running" || candidate.status === "waiting")) {
      clearQuiet(run);
      settleAsk(run, undefined, this.now());
      if (run.threadId && run.target === "bot" && this.options.hasPendingDelegations?.(run.threadId) === true) {
        this.wait(run, "Waiting for delegated work to finish");
        continue;
      }
      if (!requeueOnce(run, "restarted", ROUTINE_RESTARTED, this.now())) {
        Object.assign(run, { status: "failed", error: ROUTINE_RESTARTED, attention: undefined, finishedAt: this.now() } satisfies Partial<RoutineRun>);
        if (run.target === "room-goal") run.goalStatus = "failed";
      }
      cut.push(cloneRun(run));
    }
    if (cut.length > 0) this.save();
    for (const run of cut) {
      if (run.threadId) this.options.onRunCut?.(run);
      this.notifyRunChanged(run);
      if (run.status === "failed") this.options.onRunFailed?.(run);
    }
  }

  listRoutines(): Routine[] {
    return this.routines.map(routine => this.routineWithHealth(routine));
  }

  clearFrozenResultsThreads(): void {
    if (!this.frozenPending) return;
    for (const routine of this.routines) {
      if (routine.target === "bot" && routine.resultsThreadId !== undefined &&
        this.options.frozenResultsThread?.(routine.botId, routine.resultsThreadId)) delete routine.resultsThreadId;
    }
    this.frozenPending = false;
    this.save();
  }

  private routineWithHealth(routine: Routine): Routine {
    const outcomes = outcomesNewestFirst(this.runs, routine.id);
    const success = outcomes.findIndex(run => run.status === "completed");
    const failures = success < 0 ? outcomes.length : success;
    const { installedPackage: _installedPackage, ...visible } = cloneRoutine(routine);
    const warning = routineHostWarning(routine), week = weekRuns(this.runs, routine.id, this.now());
    return { ...visible, ...(failures ? { failureStreak: failures } : {}), ...(week ? { weekRuns: week } : {}), ...(warning ? { warning } : {}) };
  }

  packageStamps(): Array<{ routineId: string; botId: string; enabled: boolean; stamp: RoutinePackageStamp }> {
    return this.routines.flatMap((routine) => routine.installedPackage
      ? [{ routineId: routine.id, botId: routine.botId, enabled: routine.enabled, stamp: structuredClone(routine.installedPackage) }]
      : []);
  }

  stampInstalledPackage(id: string, stamp: RoutinePackageStamp): boolean {
    const clean = loadInstalledPackage(stamp);
    if (!clean) throw new Error("Invalid routine package stamp");
    if (!this.routines.some((routine) => routine.id === id)) return false;
    this.commitMutation(() => {
      const routine = this.routines.find((candidate) => candidate.id === id)!;
      routine.installedPackage = clean;
    });
    return true;
  }

  wakeHold(horizonMs = WAKE_HORIZON_MS) { return wakeHoldOf(this.routines, this.runs, this.now(), horizonMs); }
  /** A Cloud home's sleep check (server/routine-due.ts). */
  hasActiveRuns(): boolean { return activeRunsOf(this.runs, this.now()); }
  nextDueAt(): number | null { return nextDueOf(this.routines, this.runs, this.now()); }

  listRuns(from?: number, to?: number): RoutineRun[] {
    return this.runs
      .filter((r) => (from == null || r.scheduledFor >= from) && (to == null || r.scheduledFor <= to))
      .sort((a, b) => b.scheduledFor - a.scheduledFor)
      .map(cloneRun);
  }

  activeRunForBot(botId: string): RoutineRun | null {
    const run = this.runs.find(
      (candidate) => candidate.botId === botId && ["running", "waiting"].includes(candidate.status),
    );
    return run ? cloneRun(run) : null;
  }

  activeBotRunForBot(botId: string): RoutineRun | null {
    const run = this.runs.find(
      (candidate) => candidate.target === "bot" &&
        candidate.botId === botId &&
        ["running", "waiting"].includes(candidate.status),
    );
    return run ? cloneRun(run) : null;
  }

  routineRequestReceipt(requestId: string): RoutineRequestReceipt | null {
    const receipt = this.routineRequestReceipts.find((candidate) => candidate.requestId === requestId);
    return receipt ? { ...receipt } : null;
  }

  routineRequestReceiptOwners(): RoutineRequestOwner[] {
    return this.routineRequestReceipts.map(({ requestId, messageId, botId, threadId }) => ({
      requestId,
      messageId,
      botId,
      threadId,
    }));
  }

  /** Unsettled receipts are never count-evicted: an open card keeps its exactly-once recovery for its whole life. */
  forgetRoutineRequestReceipt(request: RoutineRequestCommit): boolean {
    const receipt = this.matchingRoutineRequestReceipt(request);
    if (!receipt) return false;
    const index = this.routineRequestReceipts.indexOf(receipt);
    this.commitMutation(() => {
      this.routineRequestReceipts.splice(index, 1);
    });
    return true;
  }

  forgetRoutineRequestReceiptsForThread(threadId: string): number {
    const kept = this.routineRequestReceipts.filter((receipt) => receipt.threadId !== threadId);
    const removed = this.routineRequestReceipts.length - kept.length;
    if (removed === 0) return 0;
    this.commitMutation(() => {
      this.routineRequestReceipts = kept;
    });
    return removed;
  }

  reconcileRoutineRequestReceipts(reachable: readonly RoutineRequestOwner[]): number {
    const keys = new Set(reachable.map(routineRequestOwnerKey));
    const kept = this.routineRequestReceipts.filter((receipt) => keys.has(routineRequestOwnerKey(receipt)));
    const removed = this.routineRequestReceipts.length - kept.length;
    if (removed === 0) return 0;
    this.commitMutation(() => {
      this.routineRequestReceipts = kept;
    });
    return removed;
  }

  isActiveThread(threadId: string): boolean {
    return this.runs.some(
      (run) => run.threadId === threadId && ["running", "waiting"].includes(run.status),
    );
  }

  runForThread(threadId: string): RoutineRun | null {
    const run = this.runs.findLast((candidate) => candidate.threadId === threadId && ["running", "waiting"].includes(candidate.status)) ??
      this.runs.findLast((candidate) => candidate.threadId === threadId);
    return run ? cloneRun(run) : null;
  }

  noteReport(id: string, report: RoutineRunReport | undefined): RoutineRun | null {
    const run = this.runs.find((candidate) => candidate.id === id);
    if (!run) return null;
    if (report) run.report = report;
    else delete run.report;
    this.save();
    this.emitRun(run);
    return cloneRun(run);
  }

  create(input: RoutineInput, request?: RoutineRequestCommitFor<"create">): Routine {
    this.assertWritable();
    if (request) {
      const receipt = this.matchingRoutineRequestReceipt(request);
      if (receipt) {
        const committed = this.routines.find((routine) => routine.id === receipt.resultId);
        if (committed) return this.routineWithHealth(committed);
        throw new Error("This routine request was already applied");
      }
    }
    const at = this.now();
    const clean = sanitizeInput(input, at);
    clean.schedule = this.timedSchedule(clean.schedule);
    if (this.targetState(clean) === "missing") throw new Error(this.missingTargetMessage(clean.target));
    const nextRunAt = clean.enabled ? this.initialOccurrence(clean.schedule, at) : null;
    if (clean.schedule.type === "interval" && clean.enabled && nextRunAt === null) {
      throw new Error("This interval has no future runs. Choose a later end date or turn it off.");
    }
    const routine: Routine = {
      id: randomUUID(),
      ...clean,
      // Only a confirmed chat card supplies `request`: the calendar API cannot pick an arbitrary transcript.
      sourceThreadId: request?.threadId,
      nextRunAt,
      createdAt: at,
      updatedAt: at,
    };
    const discardResults = this.applyResultsInput(routine, input.resultsThreadId);
    this.commitMutation(() => {
      this.routines.unshift(routine);
      if (request) this.rememberRoutineRequest(request, routine.id, at);
    }, discardResults);
    this.emitRoutine(routine);
    return this.routineWithHealth(routine);
  }

  update(
    id: string,
    patch: Partial<RoutineInput>,
    request?: RoutineRequestCommitFor<"update" | "pause" | "resume">,
  ): Routine | null {
    this.assertWritable();
    if (request) {
      const receipt = this.matchingRoutineRequestReceipt(request);
      if (receipt) {
        const committed = this.routines.find((routine) => routine.id === receipt.resultId);
        return committed ? this.routineWithHealth(committed) : null;
      }
    }
    const routine = this.routines.find((r) => r.id === id);
    if (!routine) return null;
    const now = this.now();
    const clean = sanitizeInput({
      name: patch.name ?? routine.name,
      prompt: patch.prompt ?? routine.prompt,
      target: patch.target ?? routine.target,
      botId: patch.botId ?? routine.botId,
      groupId: Object.hasOwn(patch, "groupId") ? patch.groupId : routine.groupId,
      runOn: patch.runOn ?? routine.runOn,
      enabled: patch.enabled ?? routine.enabled,
      schedule: patch.schedule ? mergeScheduleUpdate(routine.schedule, patch.schedule) : routine.schedule,
      durationMinutes: patch.durationMinutes ?? routine.durationMinutes,
      timeoutMinutes: Object.hasOwn(patch, "timeoutMinutes") ? patch.timeoutMinutes : routine.timeoutMinutes,
      catchUpMinutes: Object.hasOwn(patch, "catchUpMinutes") ? patch.catchUpMinutes : routine.catchUpMinutes,
      attachments: patch.attachments ?? routine.attachments,
      continuity: patch.continuity ?? routine.continuity,
      overlap: Object.hasOwn(patch, "overlap") ? patch.overlap : routine.overlap,
      runOnStartup: patch.runOnStartup ?? routine.runOnStartup,
      preCheck: Object.hasOwn(patch, "preCheck") ? patch.preCheck : routine.preCheck,
      reportOnlyNews: patch.reportOnlyNews ?? routine.reportOnlyNews,
    }, now);
    clean.schedule = this.timedSchedule(clean.schedule, routine.id);
    if (this.targetState(clean) === "missing") throw new Error(this.missingTargetMessage(clean.target));
    const scheduleChanged = JSON.stringify(clean.schedule) !== JSON.stringify(routine.schedule);
    const enabledChanged = clean.enabled !== routine.enabled;
    if (enabledChanged && clean.enabled && clean.schedule.type === "once" && clean.schedule.at <= now) throw new RoutineScheduleError("Its time has passed. Edit it to pick a new time.");
    const nextRunAt = !clean.enabled ? null : scheduleChanged || enabledChanged
      ? this.initialOccurrence(clean.schedule, now)
      : routine.nextRunAt;
    if (clean.schedule.type === "interval" && clean.enabled && nextRunAt === null) {
      throw new Error("This interval has no future runs. Choose a later end date or turn it off.");
    }
    const destination = { ...routine, ...clean };
    if (destination.botId !== routine.botId) delete destination.resultsThreadId;
    const discardResults = this.applyResultsInput(destination, patch.resultsThreadId);
    const cancelledRuns: RoutineRun[] = [];
    this.commitMutation(() => {
      Object.assign(routine, clean, {
        resultsThreadId: destination.resultsThreadId,
        nextRunAt,
        // updatedAt doubles as the confirmation cards' optimistic revision: keep it monotonic within one ms.
        updatedAt: Math.max(now, routine.updatedAt + 1),
      });
      if (!clean.continuity) delete routine.continuity;
      if (clean.overlap !== "queue") delete routine.overlap;
      if (!clean.runOnStartup) delete routine.runOnStartup;
      if (!clean.preCheck) delete routine.preCheck;
      if (!clean.reportOnlyNews) delete routine.reportOnlyNews;
      if (Object.hasOwn(patch, "timeoutMinutes") && patch.timeoutMinutes == null) {
        delete routine.timeoutMinutes;
      }
      if (clean.catchUpMinutes === undefined) delete routine.catchUpMinutes;
      if (patch.enabled === false) {
        for (const run of this.runs) {
          if (run.routineId !== routine.id || run.status !== "queued") continue;
          run.status = "cancelled";
          run.attention = undefined;
          run.finishedAt = this.now();
          run.error = "The routine was paused before this run started";
          cancelledRuns.push(run);
        }
      }
      if (request) this.rememberRoutineRequest(request, routine.id, now);
    }, discardResults);
    for (const run of cancelledRuns) this.emitRun(run);
    this.emitRoutine(routine);
    return this.routineWithHealth(routine);
  }

  remove(id: string, request?: RoutineRequestCommitFor<"delete">): boolean {
    this.assertWritable();
    if (request && this.matchingRoutineRequestReceipt(request)) return true;
    const at = this.routines.findIndex((r) => r.id === id);
    if (at === -1) return false;
    const changedRuns: RoutineRun[] = [];
    this.commitMutation(() => {
      this.routines.splice(at, 1);
      for (const run of this.runs) {
        if (run.routineId !== id) continue;
        if (run.status === "queued") {
          run.status = "cancelled";
          run.attention = undefined;
          run.finishedAt = this.now();
          changedRuns.push(run);
        } else if (!run.seenAt && isRoutineProblemRun(run)) {
          run.seenAt = this.now();
          changedRuns.push(run);
        }
      }
      if (request) this.rememberRoutineRequest(request, id, this.now());
    });
    for (const run of changedRuns) this.emitRun(run);
    this.options.emit?.({ kind: "routine.deleted", routineId: id });
    return true;
  }

  /** A deleted bot's schedules go with it: each is removed, its unfinished runs stop, and its run history is dropped. */
  removeForBot(botId: string) {
    for (const routine of this.routines.filter((candidate) => candidate.botId === botId)) this.remove(routine.id);
    for (const run of this.runs) {
      if (run.botId !== botId || !["queued", "running", "waiting"].includes(run.status)) continue;
      run.status = "cancelled";
      if (run.target === "room-goal") run.goalStatus = "stopped";
      run.attention = undefined;
      run.finishedAt = this.now();
      run.error = "The assigned bot was deleted";
      this.emitRun(run);
      if (run.threadId && run.target === "room-goal" && run.groupId) void this.options.interruptGoal?.(run.groupId, run.threadId).catch(() => {});
      else if (run.threadId) void this.options.interruptTurn?.(run.botId, run.threadId).catch(() => {});
    }
    const kept = this.runs.filter((run) => run.botId !== botId);
    if (kept.length !== this.runs.length) this.commitMutation(() => { this.runs = kept; });
  }

  disableForGroup(groupId: string) {
    let changed = false;
    for (const routine of this.routines) {
      if (routine.target !== "room-goal" || routine.groupId !== groupId || !routine.enabled) continue;
      routine.enabled = false;
      routine.nextRunAt = null;
      routine.updatedAt = Math.max(this.now(), routine.updatedAt + 1);
      this.emitRoutine(routine);
      changed = true;
    }
    for (const run of this.runs) {
      if (
        run.target !== "room-goal" ||
        run.groupId !== groupId ||
        !["queued", "running", "waiting"].includes(run.status)
      ) continue;
      run.status = "cancelled";
      run.goalStatus = "stopped";
      run.attention = undefined;
      run.finishedAt = this.now();
      run.error = "The assigned room was deleted";
      this.emitRun(run);
      if (run.threadId) {
        void this.options.interruptGoal?.(groupId, run.threadId).catch(() => {});
      }
      changed = true;
    }
    if (changed) this.save();
  }

  runNow(id: string, request?: RoutineRequestCommitFor<"run_now">): RoutineRun | null {
    if (request) {
      const receipt = this.matchingRoutineRequestReceipt(request);
      if (receipt) {
        const committed = this.runs.find((run) => run.id === receipt.resultId);
        return committed ? cloneRun(committed) : null;
      }
    }
    const routine = this.routines.find((r) => r.id === id);
    if (!routine) return null;
    let run!: RoutineRun;
    const allocations: ResultsThreadAllocation[] = [];
    const previousDestination = routine.resultsThreadId;
    this.commitMutation(() => {
      run = this.newRun(routine, this.now(), true, allocations, request?.threadId ?? routine.sourceThreadId);
      if (request) run.sourceThreadId = request.threadId;
      if (request) this.rememberRoutineRequest(request, run.id, this.now());
    }, () => this.discardResultsThreads(allocations));
    if (routine.resultsThreadId !== previousDestination) this.emitRoutine(routine);
    this.emitRun(run);
    queueMicrotask(() => void this.tick());
    return cloneRun(run);
  }

  webhookRunReceipt(webhookId: string, deliveryId: string): { id: string } | null {
    const receipt = this.webhookRunReceipts.find((candidate) =>
      candidate.webhookId === webhookId && candidate.deliveryId === deliveryId &&
      candidate.acceptedAt >= this.now() - EVENT_RETRY_WINDOW_MS);
    if (receipt) return { id: receipt.runId };
    const active = this.runs.find((run) => run.webhookId === webhookId && run.deliveryId === deliveryId &&
      ["queued", "running", "waiting"].includes(run.status));
    return active ? { id: active.id } : null;
  }

  enqueueWebhook(input: {
    webhookId: string;
    webhookName: string;
    prompt: string;
    botId: string;
    runOn: RoutineRunOn;
    deliveryId: string;
    receivedAt: number;
    eventSource?: "app";
  }): { id: string } {
    this.assertWritable();
    const existing = this.webhookRunReceipt(input.webhookId, input.deliveryId);
    if (existing) return existing;
    if (this.options.botState(input.botId) === "missing") {
      throw Object.assign(new Error("The assigned CRITTER no longer exists"), { status: 410 });
    }
    const run: RoutineRun = {
      id: randomUUID(), routineId: input.webhookId, routineName: input.webhookName, prompt: input.prompt, target: "bot",
      botId: input.botId, runOn: input.runOn, scheduledFor: input.receivedAt, status: "queued", manual: false,
      triggerSource: "webhook", webhookId: input.webhookId, deliveryId: input.deliveryId, attachments: [], createdAt: this.now(),
      resultsThreadId: this.options.eventResultsThread?.(input), ...(input.eventSource ? { eventSource: input.eventSource } : {}),
    };
    this.commitEvent(run, input.deliveryId, () => { this.runs.push(run); });
    return cloneRun(run);
  }

  /** Adds an outside event to its trigger's run that has not started yet, so a burst becomes one run. Null when there
   *  is no such run or `merge` declines (the run is full). */
  mergeIntoQueuedRun(webhookId: string, deliveryId: string, merge: (prompt: string) => string | null): { id: string } | null {
    this.assertWritable();
    const existing = this.webhookRunReceipt(webhookId, deliveryId);
    if (existing) return existing;
    const run = this.runs.findLast((candidate) => candidate.webhookId === webhookId && candidate.status === "queued" && !candidate.threadId);
    const merged = run?.prompt === undefined ? null : merge(run.prompt);
    if (!run || merged === null) return null;
    const before = run.prompt;
    this.commitEvent(run, deliveryId, () => { run.prompt = merged; }, () => { run.prompt = before; });
    return { id: run.id };
  }

  private commitEvent(run: RoutineRun, deliveryId: string, apply: () => void, revert?: () => void): void {
    const previousReceipts = this.webhookRunReceipts;
    const receipts = previousReceipts.filter((receipt) => receipt.acceptedAt >= this.now() - EVENT_RETRY_WINDOW_MS);
    // Never evict a promised retry identity to admit fresh work.
    if (receipts.length >= MAX_EVENT_RECEIPTS) throw Object.assign(new Error("Webhook retry history is full; try again later"), { status: 429 });
    receipts.push({ webhookId: run.webhookId!, deliveryId, runId: run.id, acceptedAt: this.now() });
    const previousRuns = this.runs.slice();
    apply();
    this.webhookRunReceipts = receipts;
    try { this.save(); }
    catch (error) {
      // Keep the live run objects tick() may be awaiting, not cloned snapshots.
      this.runs = previousRuns;
      this.webhookRunReceipts = previousReceipts;
      revert?.();
      throw error;
    }
    this.emitRun(run);
    queueMicrotask(() => void this.tick());
  }

  activeWebhookRunCount(webhookId: string): number {
    return this.runs.filter(
      (run) => run.webhookId === webhookId && ["queued", "running", "waiting"].includes(run.status),
    ).length;
  }

  cancelQueuedWebhook(webhookId: string, message: string): void {
    let changed = false;
    for (const run of this.runs) {
      if (run.webhookId !== webhookId || run.status !== "queued") continue;
      run.status = "cancelled";
      run.attention = undefined;
      run.finishedAt = this.now();
      run.error = message.slice(0, 500);
      this.emitRun(run);
      changed = true;
    }
    if (changed) this.save();
  }

  async cancelRun(id: string, reason?: string): Promise<RoutineRun | null> {
    const run = this.runs.find((r) => r.id === id);
    if (!run || !["queued", "running", "waiting"].includes(run.status)) return null;
    run.status = "cancelled";
    if (run.target === "room-goal") run.goalStatus = "stopped";
    run.attention = undefined;
    run.finishedAt = this.now();
    if (reason) run.error = reason;
    this.save();
    this.emitRun(run);
    if (run.threadId) {
      if (run.target === "room-goal" && run.groupId) {
        await this.options.interruptGoal?.(run.groupId, run.threadId).catch(() => {});
      } else {
        await this.options.interruptTurn?.(run.botId, run.threadId).catch(() => {});
      }
    }
    queueMicrotask(() => void this.tick());
    return cloneRun(run);
  }

  markSeen(id: string): RoutineRun | null {
    const run = this.runs.find((r) => r.id === id);
    if (!run) return null;
    if (!run.seenAt) {
      run.seenAt = this.now();
      this.save();
      this.emitRun(run);
    }
    return cloneRun(run);
  }

  markAllSeen(visible: (run: RoutineRun) => boolean = () => true): RoutineRun[] {
    const due = (run: RoutineRun) => !run.seenAt && isRoutineProblemRun(run) && visible(run);
    if (!this.runs.some(due)) return [];
    const stampAt = this.now();
    const updated: RoutineRun[] = [];
    this.commitMutation(() => {
      for (const run of this.runs.filter(due)) {
        run.seenAt = stampAt;
        updated.push(run);
      }
    });
    for (const run of updated) this.emitRun(run);
    return updated.map(cloneRun);
  }

  /** The computer's clock moved to another time zone (a Cloud took its owner's): a daily or weekly time, or an interval
   * kept to some days or hours, now falls at another instant. A cron rule names its own zone, a one-time run is an
   * instant and a plain interval counts elapsed time, so those keep theirs. Returns how many moved. */
  rescheduleLocalTimes(): number {
    const now = this.now();
    const moved = this.routines.filter((routine) => {
      const local = routine.schedule.type === "daily" || (routine.schedule.type === "interval" && intervalHasRestrictions(routine.schedule));
      if (!routine.enabled || routine.nextRunAt == null || !local) return false;
      const next = nextOccurrence(routine.schedule, now);
      if (next === routine.nextRunAt) return false;
      routine.nextRunAt = next;
      return true;
    });
    if (moved.length) this.save();
    for (const routine of moved) this.emitRoutine(routine);
    return moved.length;
  }

  /** The engines' reset times changed: each limit-reset routine that is on takes its engine's new time. */
  retimeLimitResets(): number {
    const moved = this.routines.filter((routine) => {
      if (!routine.enabled || routine.schedule.type !== "limit_reset") return false;
      const schedule = this.timedSchedule(routine.schedule, routine.id);
      if (schedule.type !== "limit_reset" || (schedule.at === routine.schedule.at && schedule.at === routine.nextRunAt)) return false;
      routine.schedule = schedule;
      routine.nextRunAt = schedule.at;
      return true;
    });
    if (moved.length) this.save();
    for (const routine of moved) this.emitRoutine(routine);
    return moved.length;
  }

  /** Moves only the next run to `until`; the runs after it keep their schedule. A limit-reset routine has no time to move. */
  deferNextRun(id: string, until: number): Routine | null {
    const routine = this.routines.find((candidate) => candidate.id === id);
    if (!routine) return null;
    if (!routine.enabled || routine.nextRunAt === null || routine.nextRunAt >= until || routine.schedule.type === "limit_reset") return this.routineWithHealth(routine);
    this.commitMutation(() => {
      if (routine.schedule.type === "once") routine.schedule = { type: "once", at: until };
      routine.nextRunAt = until;
    });
    this.emitRoutine(routine);
    return this.routineWithHealth(routine);
  }

  private timedSchedule(schedule: RoutineSchedule, routineId?: string, ranFor?: number): RoutineSchedule {
    if (schedule.type !== "limit_reset") return schedule;
    const last = ranFor ?? (routineId ? this.runs.findLast((run) => run.routineId === routineId && run.triggerSource === "schedule")?.scheduledFor : undefined);
    return { ...schedule, at: limitResetOccurrence(this.options.limitResetAt?.(schedule.engine) ?? null, last) };
  }

  get isTicking(): boolean { return this.ticking; }

  start() {
    if (this.timer) return;
    if (!this.startupRunsQueued) this.startupRunsQueued = this.queueStartupRuns();
    void this.tick();
    this.timer = setInterval(() => void this.tick(), 10_000);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** At shutdown: a run whose turn the shutdown cuts stays running on disk, for the next start to pick up once. */
  close() {
    this.closing = true;
    this.stop();
  }

  private queueStartupRuns(): boolean {
    if (this.options.skipStartupRuns) return true;
    const launchId = this.options.launchId;
    if (launchId !== undefined && launchId === this.startupLaunchId) return true;
    const now = this.now();
    const flagged = this.routines.filter((routine) =>
      routine.enabled && routine.runOnStartup && routine.schedule.type !== "once" &&
      (routine.schedule.type !== "interval" || routine.schedule.endsAt === undefined || now <= routine.schedule.endsAt));
    const marked = flagged.filter((routine) =>
      !(routine.nextRunAt != null && routine.nextRunAt <= now && now - routine.nextRunAt <= catchUpMs(routine)) &&
      !this.runs.some((run) => run.routineId === routine.id && ["queued", "running", "waiting"].includes(run.status)));
    if (marked.length === 0 && launchId === undefined) return true;
    const previousLaunchId = this.startupLaunchId;
    const runs: RoutineRun[] = [];
    const allocations: ResultsThreadAllocation[] = [];
    try {
      this.commitMutation(() => {
        if (launchId !== undefined) this.startupLaunchId = launchId;
        for (const routine of marked) {
          const run = this.newRun(routine, now, false, allocations);
          run.triggerSource = "startup";
          runs.push(run);
          if (routine.nextRunAt != null && routine.nextRunAt <= now) this.advancePastOccurrence(routine, now, routine.nextRunAt);
        }
      }, () => {
        this.startupLaunchId = previousLaunchId;
        this.discardResultsThreads(allocations);
      });
    } catch (error) {
      console.error("routines: could not queue startup runs", error);
      return false;
    }
    for (const routine of marked) this.emitRoutine(routine);
    for (const run of runs) this.emitRun(run);
    return true;
  }

  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const now = this.now();
      for (const run of this.runs) {
        if (!["running", "waiting"].includes(run.status) || run.startedAt == null || run.timeoutMinutes == null ||
          activeMs(run, now) < run.timeoutMinutes * 60_000) continue;
        await this.stopRun(run, `Stopped after reaching the ${run.timeoutMinutes}-minute run limit`, "limit-reached");
      }
      const dueRoutines = this.routines.filter(
        (routine) => routine.enabled && routine.nextRunAt != null && routine.nextRunAt <= now && this.targetState(routine) !== "missing",
      );
      // An unanswered wait gives way to its routine's next occurrence, which would otherwise be skipped behind it.
      for (const routine of dueRoutines) {
        if (runsOnce(routine.schedule) || now - routine.nextRunAt! > catchUpMs(routine)) continue;
        const stale = this.runs.filter((run) => run.routineId === routine.id && supersededBy(routine.nextRunAt!, run, this.options.handedOffWorkLive));
        for (const run of stale) await this.cancelRun(run.id, ROUTINE_SUPERSEDED);
      }
      const scheduledRuns: RoutineRun[] = [];
      const allocations: ResultsThreadAllocation[] = [];
      if (dueRoutines.length > 0) {
        this.commitMutation(() => {
          for (const routine of dueRoutines) {
            const pendingAt = routine.nextRunAt!;
            const late = now - pendingAt;
            const scheduledFor = routine.schedule.type === "interval" && late <= catchUpMs(routine)
              ? latestIntervalOccurrence(routine.schedule, now) ?? pendingAt
              : pendingAt;
            const overlapping = !runsOnce(routine.schedule) && this.runs.some(
              (run) => run.routineId === routine.id && ["queued", "running", "waiting"].includes(run.status),
            );
            const scheduledQueued = this.runs.some(run => run.routineId === routine.id && run.status === "queued" &&
              (run.triggerSource ?? (run.manual ? "manual" : "schedule")) === "schedule");
            if (!overlapping || (routine.overlap === "queue" && !scheduledQueued)) {
              const run = this.newRun(routine, scheduledFor, false, allocations);
              // A reset is a state, not a moment: it still holds however late the computer wakes.
              if (late > catchUpMs(routine) && routine.schedule.type !== "limit_reset") {
                run.status = "missed";
                run.finishedAt = now;
                run.error = missedDetail(routine);
              }
              scheduledRuns.push(run);
            } else {
              const waiting = this.runs.find((run) => run.routineId === routine.id && run.status === "waiting" && run.waitingSince !== undefined);
              // Once per wait, an occurrence skipped behind it leaves a missed receipt, so the owner is told.
              if (waiting && skipNeedsNotice(scheduledFor, waiting.waitingSince!, routine.lastSkippedAt)) {
                const missed = this.newRun(routine, scheduledFor, false, allocations);
                missed.status = "missed";
                missed.finishedAt = now;
                missed.error = ROUTINE_SKIPPED_WHILE_WAITING;
                scheduledRuns.push(missed);
              }
              routine.skippedRuns = Math.min(Number.MAX_SAFE_INTEGER, (routine.skippedRuns ?? 0) + 1);
              routine.lastSkippedAt = scheduledFor;
            }
            this.advancePastOccurrence(routine, now, scheduledFor);
          }
        }, () => this.discardResultsThreads(allocations));
      }
      // Publish only after the scheduler batch is durable: reporting may persist transcript cards.
      for (const routine of dueRoutines) this.emitRoutine(routine);
      for (const run of scheduledRuns) this.emitRun(run);
      for (const run of scheduledRuns) {
        if (run.status === "missed") this.options.onRunFailed?.(cloneRun(run));
      }

      // Oldest first, by id: a rollback across awaits can replace the run objects.
      for (const id of this.runs.map((run) => run.id)) {
        const run = this.runs.find((candidate) => candidate.id === id);
        if (!run || run.status !== "queued" || (run.retryAt ?? 0) > now) continue;
        const triggerSource = run.triggerSource ?? (run.manual ? "manual" : "schedule");
        const definition = triggerSource === "schedule"
          ? this.routines.find((routine) => routine.id === run.routineId)
          : undefined;
        if (definition?.schedule.type === "interval") {
          const latest = latestIntervalOccurrence(definition.schedule, now);
          if (latest !== null && latest > run.scheduledFor) {
            run.scheduledFor = latest;
            this.save();
            this.emitRun(run);
          }
          const requiresCurrentDayOccurrence =
            definition.schedule.weekdays !== undefined || definition.schedule.window !== undefined;
          const mayDispatch = intervalAllowsOccurrence(definition.schedule, now) &&
            (!requiresCurrentDayOccurrence || (latest !== null && isSameLocalDay(latest, now)));
          if (!mayDispatch) {
            if (nextOccurrence(definition.schedule, now) === null) {
              this.failRun(run, "The routine ended before this scheduled run could start", "missed");
            }
            continue;
          }
        }
        const sameRoutineWorking = triggerSource === "schedule" && this.runs.some(other =>
          other.id !== run.id && other.routineId === run.routineId && ["running", "waiting"].includes(other.status));
        const state = sameRoutineWorking ? "busy" : this.targetState(run);
        if (state === "busy") {
          if (run.deferredAt == null) {
            run.deferredAt = now;
            this.save();
            this.emitRun(run);
          }
          if (run.deferredNoticeAt == null && now - run.deferredAt >= ROUTINE_DEFERRAL_NOTICE_MS) {
            run.deferredNoticeAt = now;
            this.save();
            this.emitRun(run);
            this.options.onRunDeferred?.(cloneRun(run));
          }
          continue;
        }
        if (state === "missing") {
          this.failRun(run, this.missingTargetMessage(run.target));
          continue;
        }
        let preCheckContext: string | undefined;
        if (run.preCheck && run.target === "bot" && this.options.preCheck) {
          const decision = await this.options.preCheck(cloneRun(run)).catch((error: unknown): RoutinePreCheckDecision => {
            console.warn(`routines: pre-check for ${run.routineName} failed, starting the run anyway`, error);
            return { wake: true };
          });
          // The run may have been cancelled, or replaced by a rollback, while the check ran; the next tick looks again.
          const current = this.runs.find((candidate) => candidate.id === id);
          if (current !== run || run.status !== "queued") continue;
          if (!decision.wake) {
            this.finishQuiet(run);
            continue;
          }
          preCheckContext = decision.context;
          const keys = decision.keys?.filter((key) => typeof key === "string" && key).slice(0, 50);
          if (keys?.length) run.preCheckKeys = keys;
        }
        const startedAt = this.now();
        const suffix = ` · ${new Date(startedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`;
        const title = `${run.routineName.slice(0, 80 - suffix.length).trimEnd()}${suffix}`;
        const joined = run.target === "room-goal" ? null : run.threadId || this.options.joinConversation?.(run) || null;
        const task = joined
          ? { threadId: joined }
          : run.target === "room-goal"
          ? run.groupId
            ? this.options.createGoalTask?.(run.groupId, title) ?? null
            : null
          : this.options.createTask(run.botId, title, run);
        if (!task) {
          this.failRun(run, run.target === "room-goal"
            ? "Could not create a room task for this goal"
            : "Could not create a task for this run");
          continue;
        }
        run.threadId = task.threadId;
        run.startedAt = startedAt;
        run.status = "running";
        this.save();
        this.emitRun(run);
        try {
          const prompt = run.prompt ?? this.routines.find((r) => r.id === run.routineId)?.prompt;
          if (!prompt) {
            this.failThread(task.threadId, "The routine was deleted before it could start");
            continue;
          }
          const triggerSource = run.triggerSource ?? (run.manual ? "manual" : "schedule");
          if (run.target === "room-goal") {
            if (!run.groupId || !this.options.startGoal) {
              this.failThread(task.threadId, "Room goal routines are unavailable");
              continue;
            }
            await this.options.startGoal(
              run.groupId,
              task.threadId,
              prompt,
              run.botId,
              run.id,
              (message) => this.failThread(task.threadId, message),
            );
          } else {
            await this.options.startTurn(
              run.botId,
              task.threadId,
              withPreCheckContext(
                composeExecutionPrompt({ name: run.routineName, trigger: triggerSource, runOn: run.runOn ?? "nordus", reportOnlyNews: run.reportOnlyNews }, prompt, run.attachments, continuityCarry(run, this.routines, this.runs), run.retried),
                preCheckContext,
              ),
              run.runOn ?? "nordus",
              triggerSource,
              (message) => this.failThread(task.threadId, message),
            );
          }
        } catch (error) {
          this.failThread(task.threadId, error instanceof Error ? error.message : String(error), dispatchRefusal(error));
        }
      }
    } finally {
      this.ticking = false;
    }
  }

  handleRuntimeEvent(event: RuntimeEvent): RoutineRun | null {
    const run = this.runs.find((r) => r.threadId === event.threadId && ["running", "waiting"].includes(r.status));
    if (!run || (run.target === "bot" && run.status === "waiting" && !run.asked && this.options.routineTurn?.(event.threadId) === false)) return null;
    if (event.type === "turn.started" || event.type === "turn.completed") settleAsk(run, undefined, this.now());
    // A room goal's orchestrator owns its result (finishGoalRun); a member's completion is intermediate.
    if (
      run.target === "room-goal" &&
      (
        run.goalStatus === "needs-input" || run.goalStatus === "paused" ||
        event.type === "turn.completed" || (event.type === "item.completed" && event.itemType === "assistant_text")
      )
    ) return null;
    if (event.type === "turn.started") {
      run.status = "running";
      run.attention = undefined;
    } else if (event.type === "request.opened") {
      clearQuiet(run);
      run.asked ??= askOf(event, this.now());
      this.wait(run, waitingFor(run.asked));
    } else if (event.type === "request.resolved") {
      const unanswered = settleAsk(run, event, this.now());
      if (unanswered) {
        void this.stopRun(run, unanswered, "stopped");
        return cloneRun(run);
      }
      run.status = "running";
      run.attention = undefined;
    } else if (event.type === "item.completed" && event.itemType === "assistant_text") {
      if (isSilentReply(event.text) || (run.reportOnlyNews && isNothingNewReply(event.text))) {
        this.newsChecks.delete(event.threadId);
        run.quiet = true;
        run.output = ROUTINE_QUIET_OUTPUT;
      } else {
        delete run.quiet;
        run.output = redactSecretsInText(event.text).trim().slice(0, 2_000);
        this.readNews(run, event.threadId, event.text);
      }
    } else if (event.type === "runtime.error") {
      run.error = redactSecretsInText(event.message).slice(0, 500);
      this.failureFacts.set(run.id, engineFacts(event));
    } else if (event.type === "turn.completed") {
      if (this.closing && (!event.ok || event.stopReason === "cancelled" || event.stopReason === "interrupted")) return null;
      if (event.cost != null) run.cost = (run.cost ?? 0) + event.cost;
      if (event.denials?.length) run.denials = [...new Set([...(run.denials ?? []), ...event.denials])];
      if (!event.ok) {
        this.settleFailure(run, routineFailure(run.error, event.stopReason), { ...this.failureFacts.get(run.id), stopReason: event.stopReason });
        return cloneRun(run);
      }
      this.failureFacts.delete(run.id);
      if (this.options.hasPendingDelegations?.(event.threadId) === true) {
        clearQuiet(run);
        this.wait(run, "Waiting for delegated work to finish");
      } else {
        Object.assign(run, { status: "completed", attention: undefined, finishedAt: this.now() } satisfies Partial<RoutineRun>);
        this.ownerNotices = this.ownerNotices.filter((notice) => notice.botId !== run.botId);
      }
      run.error = undefined;
    } else {
      return null;
    }
    this.save();
    this.emitRun(run);
    if (event.type === "turn.completed") queueMicrotask(() => void this.tick());
    return cloneRun(run);
  }

  /** A news-only run whose reply says, in other words than NADA_NOVO, that nothing changed: the decision model reads it,
   * and the run turns quiet only while it is still running with that same reply. The server holds the turn's end for
   * this thread until the reading settles (pendingNewsCheck), so everything after it sees the run as quiet or not. */
  private readNews(run: RoutineRun, threadId: string, reply: string) {
    this.newsChecks.delete(threadId);
    const read = this.options.nothingNew;
    if (!read || !run.reportOnlyNews) return;
    const prompt = run.prompt ?? this.routines.find((routine) => routine.id === run.routineId)?.prompt ?? "";
    const output = run.output ?? "";
    let reading: Promise<boolean> | undefined;
    try {
      reading = read({ reply, prompt });
    } catch {
      return;
    }
    if (!reading) return;
    const entry = { runId: run.id, output, done: false, promise: Promise.resolve() };
    entry.promise = Promise.resolve(reading)
      .catch(() => false)
      .then((quiet) => {
        entry.done = true;
        if (this.newsChecks.get(threadId) !== entry) return;
        this.newsChecks.delete(threadId);
        const current = this.runs.find((candidate) => candidate.id === entry.runId);
        if (quiet !== true || !current || current.output !== output || !["running", "waiting"].includes(current.status)) return;
        current.quiet = true;
        current.output = ROUTINE_QUIET_OUTPUT;
        try {
          this.save();
          this.emitRun(current);
        } catch (error) {
          console.error("[routines] a quiet reading could not be saved:", error instanceof Error ? error.message : String(error));
        }
      });
    this.newsChecks.set(threadId, entry);
  }

  /** The reading of this conversation's routine reply still under way, if any. */
  pendingNewsCheck(threadId: string): Promise<void> | undefined {
    const entry = this.newsChecks.get(threadId);
    return entry && !entry.done ? entry.promise : undefined;
  }

  /** The pre-check found nothing to do: the run ends here, without a turn, a card or a notification. */
  private finishQuiet(run: RoutineRun) {
    run.status = "completed";
    run.quiet = true;
    run.output = ROUTINE_QUIET_OUTPUT;
    run.attention = undefined;
    run.finishedAt = this.now();
    this.noteReport(run.id, { state: "quiet" });
    this.save();
    this.emitRun(run);
  }

  failThread(threadId: string, message: string, facts: RoutineFailureFacts = {}) {
    const run = this.runs.find((r) => r.threadId === threadId && ["running", "waiting"].includes(r.status));
    if (run) this.settleFailure(run, message, facts);
  }

  private settleFailure(run: RoutineRun, failure: string, facts: RoutineFailureFacts) {
    this.failureFacts.delete(run.id);
    if (this.closing) return;
    const backupReady = facts.limitResetsAt !== undefined && this.options.limitBackup?.(run.botId) === true;
    clearQuiet(run);
    const allFacts = { ...facts, ...(backupReady ? { backupReady } : {}) };
    let recovery = recoverRun(run, failure, allFacts, this.now(), this.ownerNotices);
    if (!recovery.queued && this.retryAgain(run, failure, allFacts)) recovery = { queued: true };
    // The recovery's one automatic start counts as the first of the up to three tries.
    else if (recovery.queued && run.retried !== undefined && run.retried !== "usage_limit" && run.retryCount === undefined) run.retryCount = 1;
    if (!recovery.queued && (run.retryCount ?? 0) > 1) recovery = { ...recovery, error: `Failed after ${run.retryCount} automatic retries: ${failure}` };
    if (!recovery.queued) this.failRun(run, recovery.error, "failed", recovery.alert);
    else {
      this.save();
      this.emitRun(run);
      if (recovery.alert) this.options.onRunDeferred?.(cloneRun(run), recovery.alert);
    }
    queueMicrotask(() => void this.tick());
  }

  /** Nordus: a passing failure gets up to three new tries (15 s, 1 min, 5 min); the upstream recovery already spent the first. */
  private retryAgain(run: RoutineRun, failure: string, facts: RoutineFailureFacts): boolean {
    // Only a passing provider error or rate limit: a stalled engine or a restart gets the recovery's single new start.
    if (run.target !== "bot" || (run.retried !== "provider" && run.retried !== "rate_limited")) return false;
    if (routineRetriesSoFar(run) >= ROUTINE_RETRY_SCHEDULE_MS.length) return false;
    if (classifyRoutineFailure(failure, facts).kind !== "retry") return false;
    run.status = "queued";
    run.retryCount = routineRetriesSoFar(run) + 1;
    run.retryAt = this.now() + routineRetryDelayMs(run.retryCount);
    run.attention = `Starting again shortly after a temporary error: ${failure}`.slice(0, 500);
    delete run.error;
    return true;
  }

  finishGoalRun(runId: string, status: GroupGoalRunStatus, detail: string): RoutineRun | null {
    const run = this.runs.find(
      (candidate) => candidate.id === runId &&
        candidate.target === "room-goal" &&
        ["running", "waiting"].includes(candidate.status),
    );
    if (!run || status === "working") return null;
    const safeDetail = redactSecretsInText(detail).trim();
    run.goalStatus = status;
    if (status === "failed" || status === "blocked" || status === "limit-reached") {
      this.failRun(
        run,
        safeDetail ||
          (status === "limit-reached" ? "The room goal reached its turn limit" : "The room goal is blocked"),
      );
    } else if (status === "needs-input" || status === "paused") {
      this.wait(run, safeDetail.slice(0, 500) || (status === "paused" ? "The room goal is paused" : "The team needs your input"));
      run.error = undefined;
      this.save();
      this.emitRun(run);
    } else {
      run.status = status === "stopped" ? "cancelled" : "completed";
      run.attention = undefined;
      run.finishedAt = this.now();
      run.error = undefined;
      if (status !== "stopped") run.output = safeDetail.slice(0, 2_000) || undefined;
      this.save();
      this.emitRun(run);
    }
    queueMicrotask(() => void this.tick());
    return cloneRun(run);
  }

  /** Timed from when it began, so a later occurrence can tell a wait that went unanswered. */
  private wait(run: RoutineRun, attention: string | undefined) {
    if (run.status !== "waiting" || run.waitingSince === undefined) run.waitingSince = this.now();
    run.status = "waiting";
    run.attention = attention;
  }

  private async stopRun(run: RoutineRun, detail: string, status: "stopped" | "limit-reached") {
    if (run.target === "room-goal") run.goalStatus = status;
    this.failRun(run, detail);
    if (!run.threadId) return;
    if (run.target === "room-goal" && run.groupId) await this.options.interruptGoal?.(run.groupId, run.threadId, { status, detail }).catch(() => {});
    else await this.options.interruptTurn?.(run.botId, run.threadId).catch(() => {});
  }

  private failRun(run: RoutineRun, message: string, status: "failed" | "missed" = "failed", alert?: RoutineAlert | null) {
    clearQuiet(run);
    run.status = status;
    run.attention = undefined;
    run.error = redactSecretsInText(message).slice(0, 500);
    run.finishedAt = this.now();
    if (status === "failed" && this.pauseAfterFailures(run)) run.routinePaused = true;
    this.save();
    this.emitRun(run);
    this.options.onRunFailed?.(cloneRun(run), alert === undefined && failsLikeLastOutcome(this.runs, run) ? null : alert);
  }

  /** Five failed runs in a row (counted the same way as the routine's failure streak) pause the routine. */
  private pauseAfterFailures(run: RoutineRun): boolean {
    const routine = this.routines.find((candidate) => candidate.id === run.routineId);
    if (!routine?.enabled) return false;
    if ((this.routineWithHealth(routine).failureStreak ?? 0) < ROUTINE_PAUSE_AFTER_FAILURES) return false;
    routine.enabled = false;
    routine.nextRunAt = null;
    routine.updatedAt = Math.max(this.now(), routine.updatedAt + 1);
    return true;
  }

  private advancePastOccurrence(routine: Routine, now: number, occurrence: number) {
    if (routine.schedule.type === "limit_reset" && routine.schedule.repeat === "every_reset") routine.schedule = this.timedSchedule(routine.schedule, routine.id, occurrence);
    routine.nextRunAt =
      runsOnce(routine.schedule) ? null : nextOccurrence(routine.schedule, Math.max(now, occurrence));
    // Not a definition edit: bumping updatedAt here would stale a pending confirmation card.
    if (runsOnce(routine.schedule)) {
      routine.enabled = false;
      routine.updatedAt = Math.max(now, routine.updatedAt + 1);
    } else if (routine.schedule.type === "interval" && routine.nextRunAt === null) {
      routine.enabled = false;
      routine.updatedAt = Math.max(now, routine.updatedAt + 1);
    }
  }

  private targetState(target: Pick<RoutineRun, "target" | "groupId" | "botId">): "ready" | "busy" | "missing" {
    if (target.target === "room-goal") {
      if (!target.groupId || !this.options.goalState) return "missing";
      return this.options.goalState(target.groupId, target.botId);
    }
    return this.options.botState(target.botId);
  }

  private missingTargetMessage(target: RoutineTarget): string {
    return target === "room-goal"
      ? "The assigned room or coordinator no longer exists"
      : "The assigned bot no longer exists";
  }

  private initialOccurrence(schedule: RoutineSchedule, now: number): number | null {
    // The original time, not max(at, now): tick() decides fire vs missed from it.
    if (schedule.type === "once" || schedule.type === "limit_reset") return schedule.at;
    return nextOccurrence(schedule, now);
  }

  private newRun(
    routine: Routine,
    scheduledFor: number,
    manual: boolean,
    allocations: ResultsThreadAllocation[],
    sourceThreadId = routine.sourceThreadId,
  ): RoutineRun {
    let resultsThreadId = routine.resultsThreadId;
    if (routine.target === "bot" && this.options.resolveResultsThread) {
      const destination = this.options.resolveResultsThread({ ...routine, sourceThreadId }, false);
      const own = destination?.main ? undefined : destination?.threadId;
      if (own !== routine.resultsThreadId) {
        if (own) allocations.push({ botId: routine.botId, threadId: own });
        if (own) routine.resultsThreadId = own;
        else delete routine.resultsThreadId;
        routine.updatedAt = Math.max(this.now(), routine.updatedAt + 1);
      }
      resultsThreadId = destination?.threadId;
    }
    const run: RoutineRun = {
      id: randomUUID(),
      routineId: routine.id,
      routineName: routine.name,
      prompt: routine.prompt,
      durationMinutes: routine.durationMinutes,
      ...(routine.timeoutMinutes === undefined ? {} : { timeoutMinutes: routine.timeoutMinutes }),
      attachments: cloneAttachments(routine.attachments),
      target: routine.target,
      groupId: routine.groupId,
      botId: routine.botId,
      runOn: routine.runOn ?? "nordus",
      scheduledFor,
      status: "queued",
      manual,
      triggerSource: manual ? "manual" : "schedule",
      sourceThreadId,
      resultsThreadId,
      ...(routine.preCheck && routine.target === "bot" ? { preCheck: routine.preCheck } : {}),
      ...(routine.reportOnlyNews && routine.target === "bot" ? { reportOnlyNews: true as const } : {}),
      createdAt: this.now(),
    };
    this.runs.push(run);
    return run;
  }

  private discardResultsThreads(allocations: ResultsThreadAllocation[]) {
    for (const { botId, threadId } of allocations) {
      try {
        this.options.discardResultsThread?.(botId, threadId);
      } catch (error) {
        console.error("routine: could not discard uncommitted results thread", error);
      }
    }
  }

  private applyResultsInput(routine: Routine, value: RoutineInput["resultsThreadId"]) {
    if (routine.target !== "bot") {
      if (value != null) throw Object.assign(new Error("Results threads are only available for bot routines"), { status: 400 });
      delete routine.resultsThreadId;
      return;
    }
    if (value === undefined) return;
    if (value === null) {
      const destination = this.options.resolveResultsThread?.(routine, true);
      if (!destination || destination.main) {
        delete routine.resultsThreadId;
        return;
      }
      routine.resultsThreadId = destination.threadId;
      return () => this.options.discardResultsThread?.(routine.botId, destination.threadId);
    }
    if (typeof value !== "string" || !value.trim() || !this.options.isResultsThread?.(routine.botId, value.trim())) {
      throw Object.assign(new Error("Choose a visible results thread belonging to this bot"), { status: 400 });
    }
    routine.resultsThreadId = value.trim();
  }

  private emitRoutine(routine: Routine) {
    this.options.emit?.({ kind: "routine", routine: this.routineWithHealth(routine) });
  }

  private emitRun(run: RoutineRun) {
    this.options.emit?.({ kind: "routine.run", run: cloneRun(run) });
    this.notifyRunChanged(run);
    if (run.status === "completed" || run.status === "failed") {
      const routine = this.routines.find(candidate => candidate.id === run.routineId);
      if (routine) this.emitRoutine(routine);
    }
  }

  private notifyRunChanged(run: RoutineRun) {
    try {
      this.options.onRunChanged?.(cloneRun(run));
    } catch (error) {
      console.error("routine: source-thread lifecycle update failed", error);
    }
  }

  private matchingRoutineRequestReceipt(request: RoutineRequestCommit): RoutineRequestReceipt | null {
    const receipt = this.routineRequestReceipts.find((candidate) => candidate.requestId === request.requestId);
    if (!receipt) return null;
    if (
      receipt.action !== request.action ||
      receipt.messageId !== request.messageId ||
      receipt.botId !== request.botId ||
      receipt.threadId !== request.threadId ||
      receipt.fingerprintVersion !== request.fingerprintVersion ||
      receipt.fingerprint !== request.fingerprint
    ) {
      throw new Error("Routine request receipt does not match this confirmation card");
    }
    return receipt;
  }

  private rememberRoutineRequest(
    request: RoutineRequestCommit,
    resultId: string,
    appliedAt: number,
  ) {
    const existing = this.matchingRoutineRequestReceipt(request);
    if (existing) {
      if (existing.resultId !== resultId) throw new Error("Routine request receipt has another result");
      return;
    }
    this.routineRequestReceipts.unshift({ ...request, resultId, appliedAt });
  }

  private assertWritable(): void {
    if (this.unreadable) throw Object.assign(new Error("Saved routines could not be read. Repair routines.json before changing them."), { status: 503 });
  }

  /** Rolls memory back when the write fails, so a retry never mistakes an uncommitted action for a durable one. */
  private commitMutation(mutate: () => void, rollback?: () => void): void {
    const before = {
      routines: this.routines.map(cloneRoutine),
      runs: this.runs.map(cloneRun),
      receipts: this.routineRequestReceipts.map((receipt) => ({ ...receipt })),
    };
    try {
      mutate();
      this.save();
    } catch (error) {
      this.routines = before.routines;
      this.runs = before.runs;
      this.routineRequestReceipts = before.receipts;
      try {
        rollback?.();
      } catch (cleanupError) {
        console.error("routine: could not discard uncommitted results thread", cleanupError);
      }
      throw error;
    }
  }

  private save() {
    if (this.unreadable) return;
    // Evict only terminal receipts: an active one owns cancellation, timeout and event routing.
    let excess = this.runs.length - MAX_RUNS;
    for (let index = 0; index < this.runs.length && excess > 0;) {
      if (["queued", "running", "waiting"].includes(this.runs[index]!.status)) {
        index += 1;
        continue;
      }
      this.runs.splice(index, 1);
      excess -= 1;
    }
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileAtomic(this.file, JSON.stringify({
      version: 1,
      ...(this.frozenPending ? {} : { frozenResultsCleared: true }),
      routines: [...this.routines, ...this.unloadedRoutines],
      runs: this.runs,
      routineRequestReceipts: this.routineRequestReceipts,
      webhookRunReceipts: this.webhookRunReceipts,
      ...(this.startupLaunchId === undefined ? {} : { startupLaunchId: this.startupLaunchId }),
      ...(this.ownerNotices.length ? { ownerNotices: this.ownerNotices } : {}),
    } satisfies RoutineFile, null, 2), { mode: 0o600 });
  }
}
