// "Parou no meio": turns a restart cut and routines that failed or did not run, in one list
// the person reads in the morning, with what each already did and a way to resume or dismiss it.
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { doneActionPhrase, type DoneAction } from "../../shared/outbound.ts";
import type { InterruptedItem } from "../../shared/interrupted-work.ts";
import { CUT_TWICE, INTERRUPTED_OUTWARD } from "../runtime/tree.ts";
import { PASS, type RouteHandler, type RouteContext } from "./table.ts";

export interface CutTurn {
  id: string;
  botId: string;
  threadId: string;
  detail: string;
  at: number;
  /** A room's conversation: resumed from the room, not from here. */
  room: boolean;
}

export interface FailedRoutineRun {
  id: string;
  botId: string;
  threadId?: string;
  routineName: string;
  status: "failed" | "missed";
  error?: string;
  at: number;
}

export interface InterruptedWorkDeps {
  cutTurns(): CutTurn[];
  doneFor(turnId: string): DoneAction[];
  succeededAfter(threadId: string, at: number): boolean;
  routineRuns(): FailedRoutineRun[];
  markRoutineSeen(runId: string): void;
  botName(botId: string): string | undefined;
  threadTitle(botId: string, threadId: string): string | undefined;
  /** The viewer may read this bot's conversation. */
  canSee(ctx: RouteContext, botId: string, threadId: string): boolean;
  /** A person is at the controls: a signed-in session, or the desktop app's own window. */
  personAtControls(ctx: RouteContext): boolean;
  /** Starts the thread again; an error string when it cannot start now. */
  resume(botId: string, threadId: string, done: readonly DoneAction[]): Promise<string | null>;
  dismissedFile: string;
  now(): number;
}

const SHOWN_DAYS = 7;
const SHOWN_MAX = 50;

/** Only what a restart cut: a room the watchdog stopped or a turn someone cancelled is not "Parou no meio". */
function cutCause(detail: string): string | null {
  if (detail.startsWith(INTERRUPTED_OUTWARD) && detail.includes("queued follow-up")) {
    return "O Nordus reiniciou com uma mensagem sua ainda na fila desta conversa, então o robô não continuou sozinho.";
  }
  if (detail.startsWith(INTERRUPTED_OUTWARD)) return "O Nordus reiniciou depois que o robô já tinha feito algo, então ele não continuou sozinho.";
  if (detail === CUT_TWICE) return "O Nordus reiniciou duas vezes durante esta tarefa, então ela não foi retomada de novo.";
  return null;
}

/** The run's own error is engine text in English: the person gets the plain cause, and the details stay in the conversation. */
function routineCause(run: FailedRoutineRun): string {
  if (run.status === "missed") return run.error?.startsWith("Não executada") ? run.error : "A rotina não foi executada no horário.";
  return "A rotina falhou. Abra a conversa para ver o que aconteceu.";
}

function readDismissed(file: string): Record<string, number> {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, number> : {};
  } catch {
    return {};
  }
}

/** The list as the server sees it (not yet filtered for a viewer): the route and the notifier read the same thing. */
export function collectInterrupted(
  deps: Pick<InterruptedWorkDeps, "cutTurns" | "doneFor" | "succeededAfter" | "routineRuns" | "botName" | "threadTitle" | "dismissedFile" | "now">,
  canSee: (botId: string, threadId: string) => boolean = () => true,
): Array<InterruptedItem & { doneActions: DoneAction[] }> {
  const since = deps.now() - SHOWN_DAYS * 24 * 60 * 60_000;
  const dismissed = readDismissed(deps.dismissedFile);
  const out: Array<InterruptedItem & { doneActions: DoneAction[] }> = [];
  for (const turn of deps.cutTurns()) {
    const id = `turn:${turn.id}`;
    const cause = cutCause(turn.detail);
    if (!cause || turn.at < since || dismissed[id] || !canSee(turn.botId, turn.threadId)) continue;
    if (deps.succeededAfter(turn.threadId, turn.at)) continue;
    const done = deps.doneFor(turn.id);
    out.push({
      id, kind: "turn", botId: turn.botId, botName: deps.botName(turn.botId) ?? "Robô", threadId: turn.threadId,
      threadTitle: deps.threadTitle(turn.botId, turn.threadId) ?? "Conversa", cause,
      done: done.map(doneActionPhrase), mustConfirm: done.length > 0, canResume: !turn.room, at: turn.at, doneActions: done,
    });
  }
  for (const run of deps.routineRuns()) {
    const threadId = run.threadId ?? "";
    if (run.at < since || !canSee(run.botId, threadId)) continue;
    out.push({
      id: `routine:${run.id}`, kind: "routine", botId: run.botId, botName: deps.botName(run.botId) ?? "Robô", threadId,
      threadTitle: run.routineName, cause: routineCause(run), done: [], mustConfirm: false, canResume: false, at: run.at, doneActions: [],
    });
  }
  return out.sort((a, b) => b.at - a.at).slice(0, SHOWN_MAX);
}

export function createInterruptedWorkRoutes(deps: InterruptedWorkDeps): RouteHandler {
  const since = () => deps.now() - SHOWN_DAYS * 24 * 60 * 60_000;

  /** Atomic, and only as old as the list shows: a dismissal of something no longer listed is dropped. */
  function dismiss(id: string): void {
    const kept = Object.fromEntries(Object.entries(readDismissed(deps.dismissedFile)).filter(([, at]) => at >= since()));
    const temp = `${deps.dismissedFile}.tmp`;
    writeFileSync(temp, JSON.stringify({ ...kept, [id]: deps.now() }), { mode: 0o600 });
    renameSync(temp, deps.dismissedFile);
  }

  function items(ctx: RouteContext): Array<InterruptedItem & { doneActions: DoneAction[] }> {
    return collectInterrupted(deps, (botId, threadId) => deps.canSee(ctx, botId, threadId));
  }

  return async (ctx) => {
    const { req, res, path, method, json, readBody } = ctx;
    if (method === "GET" && path === "/api/interrupted-work") {
      return json(res, 200, { items: items(ctx).map(({ doneActions: _done, ...item }) => item) });
    }
    const match = /^\/api\/interrupted-work\/((?:turn|routine)(?::|%3A)[\w-]+)\/(dismiss|resume)$/i.exec(path);
    if (!match || method !== "POST") return PASS;
    const id = decodeURIComponent(match[1]!);
    const item = items(ctx).find((candidate) => candidate.id === id);
    if (!item) return json(res, 404, { error: "Este item não está mais na lista." });
    const body = await readBody(req, 1_024).catch(() => null) as { acknowledged?: unknown } | null;
    // A bot's shell reaches the server as loopback too: only a person may wave through work that already acted.
    if (item.mustConfirm && !deps.personAtControls(ctx)) {
      return json(res, 403, { error: "Só uma pessoa conectada pelo app pode confirmar isto." });
    }
    if (item.mustConfirm && body?.acknowledged !== true) {
      return json(res, 409, { error: "Confirme que conferiu o que já foi feito antes de continuar." });
    }
    if (match[2] === "resume") {
      if (!item.canResume) return json(res, 400, { error: "Este item não pode ser retomado daqui." });
      const error = await deps.resume(item.botId, item.threadId, item.doneActions);
      if (error) return json(res, 409, { error });
    }
    if (item.kind === "routine") deps.markRoutineSeen(item.id.slice("routine:".length));
    else dismiss(item.id);
    return json(res, 200, { ok: true });
  };
}
