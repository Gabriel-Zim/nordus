import { errorTranscript } from "../shared/client-cancel.ts";
import { actionEffect, isLookOnlyTool, type DoneAction } from "../shared/outbound.ts";
import type { RuntimeEvent } from "./contracts.ts";
import { buildTurnDigest, digestTools } from "./digest.ts";
import { stopCause } from "./drivers/engine-errors.ts";
import { UNKNOWN_RESULT } from "./runtime/tree.ts";
import type { TurnEvidence } from "./runtime/types.ts";
import type { Message } from "./store.ts";

const REASON_CHARS = 600;

export interface TurnStop {
  turnId?: string;
  cause?: string;
  error?: string;
  handoffPath?: string;
}

export class TurnStops {
  readonly #byThread = new Map<string, TurnStop>();

  note(event: RuntimeEvent): void {
    if (event.type === "turn.started") {
      this.#byThread.delete(event.threadId);
      return;
    }
    const error = event.type === "runtime.error" ? event.message
      : event.type === "item.completed" && event.itemType === "assistant_text" && event.synthetic ? event.text : undefined;
    if (event.type !== "cap.exhausted" && (error === undefined || errorTranscript(error).kind !== "error")) return;
    const stop = this.#turn(event.threadId, event.turnId);
    if (event.type === "cap.exhausted") stop.handoffPath = event.handoffPath;
    else stop.error = error;
  }

  stopping(threadId: string, turnId: string | undefined, cause: string): void {
    this.#turn(threadId, turnId).cause = cause;
  }

  #turn(threadId: string, turnId: string | undefined): TurnStop {
    const held = this.#byThread.get(threadId);
    const stop: TurnStop = held && held.turnId === turnId ? held : { turnId };
    this.#byThread.set(threadId, stop);
    return stop;
  }

  read(threadId: string, turnId?: string): TurnStop | undefined {
    const stop = this.#byThread.get(threadId);
    return stop && (!turnId || !stop.turnId || stop.turnId === turnId) ? stop : undefined;
  }

  /** The turn's own last error, else the provider's stop reason in words; undefined for a turn that did not fail. */
  failureCause(event: { threadId: string; turnId?: string; ok: boolean; stopReason?: string | null }): string | undefined {
    if (event.ok) return undefined;
    return this.read(event.threadId, event.turnId)?.error ?? stopCause(event.stopReason);
  }

  forget(threadId: string): void {
    this.#byThread.delete(threadId);
  }
}

/** Cause first (a chip shows only the start), then the last message quoted as data, so a teammate's words never pass for the harness's. */
export function stoppedTurnOutcome(input: {
  reason: string;
  activities: readonly Message[];
  turnId?: string;
  said?: string;
}): string {
  const parts = [sentence(clip(input.reason, REASON_CHARS))];
  if (input.turnId) {
    const digest = buildTurnDigest({
      turnId: input.turnId, botId: "", threadId: "", at: 0, durationMs: 0,
      activities: input.activities, memory: [], reply: "", hookCoverage: "preview",
    });
    parts.push(digest.toolCalls
      ? `Before it stopped it made ${digest.toolCalls} tool call${digest.toolCalls === 1 ? "" : "s"}: ${digestTools(digest)}.`
      : "No tool calls were seen before it stopped.");
  }
  const said = input.said?.trim();
  return said ? `${parts.join(" ")}\nIts last message, quoted: ${JSON.stringify(said)}` : parts.join(" ");
}

const SHELL_TOOL = /^(?:mcp__[\w-]+?__)?(?:bash|shell|exec|run_command|execute_command|run_shell_command|run_terminal_cmd|terminal|COMPOSIO_REMOTE_BASH_TOOL)$/i;
const GIT_OUTWARD = /\bgit\s+(commit|push)\b/g;
const MONEY_OUTWARD = /\b(pay|payment|charge|refund|transfer)\b/gi;
const ERROR_CHARS = 200;
const ERRORS_KEPT = 3;

const toolRows = (rows: readonly Message[]) =>
  rows.filter((row) => row.role === "bot" && row.kind === "activity" && row.tool !== undefined);

/** A call that stopped this way may have done its work anyway. */
const MAY_HAVE_RUN = /\b(?:time[ds]?[ -]?out|timeout|ETIMEDOUT|tempo esgotado|abort(?:ed)?|interrupt(?:ed)?|cancel(?:l?ed)?|ECONNRESET|socket hang up|EPIPE|killed|SIGTERM|SIGKILL|connection closed|fetch failed|deadline exceeded)\b/i;
const QUOTE_ONLY = /"apenas_cotar"\s*:\s*true/;

/** Started with no result, or stopped by a timeout, a cut connection or an interruption: the call may have taken effect anyway. */
function uncertainCall(tool: NonNullable<Message["tool"]>): boolean {
  if (tool.itemId === undefined) return false;
  if (tool.ok === undefined) return true;
  return tool.ok === false && typeof tool.output === "string" && MAY_HAVE_RUN.test(tool.output);
}

/** What these rows already did that running them again would do twice, once each, in order. Every consumer that must not repeat work reads this. */
export function doneActions(rows: readonly Message[]): DoneAction[] {
  const actions: DoneAction[] = [];
  const add = (tool: string, effect: DoneAction["effect"], uncertain: boolean) => {
    if (!actions.some(action => action.tool === tool && action.uncertain === uncertain)) actions.push({ tool, effect, uncertain });
  };
  for (const row of toolRows(rows)) {
    const tool = row.tool!;
    // Only real calls: a chip ("Retried …", an approval note) names a tool without being one.
    if (tool.itemId === undefined) continue;
    const uncertain = uncertainCall(tool);
    if (tool.ok === false && !uncertain) continue;
    if (!SHELL_TOOL.test(tool.name)) {
      const effect = actionEffect(tool.name);
      if (effect && !(typeof tool.input === "string" && QUOTE_ONLY.test(tool.input))) add(tool.name, effect, uncertain);
      continue;
    }
    const command = [tool.input, tool.summary].filter((text): text is string => typeof text === "string").join("\n");
    for (const git of command.matchAll(GIT_OUTWARD)) add(`git ${git[1]}`, "deploy", uncertain);
    for (const money of command.matchAll(MONEY_OUTWARD)) add(money[1]!.toLowerCase(), "spend", uncertain);
  }
  return actions;
}

/** The restart policy's labels: a cut turn with any of these never reruns. */
export function outwardActions(rows: readonly Message[]): string[] {
  return doneActions(rows).map(action => action.uncertain ? `${action.tool}${UNKNOWN_RESULT}` : action.tool);
}

/** What a restart must not run again by itself: every action in doneActions, then every other call that did more than look. */
export function restartActions(rows: readonly Message[]): DoneAction[] {
  const actions = doneActions(rows);
  for (const row of toolRows(rows)) {
    const tool = row.tool!;
    if (tool.itemId === undefined || isLookOnlyTool(tool.name) || actions.some(action => action.tool === tool.name)) continue;
    actions.push({ tool: tool.name, effect: "other", uncertain: tool.ok !== true });
  }
  return actions;
}

/** The restart policy's labels: a cut turn with any of these never reruns. */
export function restartBlockers(rows: readonly Message[]): string[] {
  return restartActions(rows).map(action => action.uncertain ? `${action.tool}${UNKNOWN_RESULT}` : action.tool);
}

/** The rows of the thread's last request: from the last message a person or peer sent (not one folded into a running turn) to the end. */
export function lastTurnRows(rows: readonly Message[]): Message[] {
  const start = rows.findLastIndex(row => row.role === "user" && !row.steered && !row.aside);
  return rows.slice(start + 1);
}

export function turnEvidence(rows: readonly Message[]): TurnEvidence {
  const tools = toolRows(rows);
  const errors = tools.filter((row) => row.tool!.ok === false).map((row) => {
    const tool = row.tool!;
    const output = tool.itemId && typeof tool.output === "string" ? tool.output.split("\n").find((line) => line.trim()) : undefined;
    return clip(output ? `${tool.name}: ${output}` : tool.name, ERROR_CHARS);
  }).slice(-ERRORS_KEPT);
  const okToolCalls = tools.filter((row) => row.tool!.ok !== false && row.tool!.itemId !== undefined).length;
  const outward = outwardActions(rows);
  return { toolCalls: tools.filter((row) => row.tool!.itemId !== undefined).length, okToolCalls, errors, ...(outward.length ? { outward } : {}) };
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function sentence(text: string): string {
  const capital = `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
  return /[.!?…"]$/.test(capital) ? capital : `${capital}.`;
}
