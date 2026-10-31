// A failed turn is stored as an activity row named "error: <what went wrong>",
// in a 1:1 chat and a room alike. A place that could not be used also stores
// its state, so the app words it again in the reader's language; the words
// stay English and whole for the phones, which read only them.
import type { PlaceRow } from "./place-view.ts";
import { classifyTurnError, type TurnError } from "./turn-error.ts";

const MARKER = "error:";

/** The longest cause a row keeps. Clients wrap the row and show it whole, so
 * this only bounds a pathological message (a provider's HTML body, a stack
 * trace); a sentence a person acts on fits, its next action included. */
export const FAILED_TURN_MAX_CHARS = 600;

export interface FailedTurnTool {
  name: string;
  ok: false;
  /** fixed by installing or signing in, not by retrying */
  setup?: boolean;
  terminal?: boolean;
  /** the installed Claude Code is too old for the model */
  claudeUpdate?: boolean;
  /** the place this turn could not use, and where that place came from */
  place?: PlaceRow;
  /** what kind of failure this was, so the app offers the right way out */
  error?: TurnError;
  /** epoch ms when the usage limit that stopped this turn resets, when the engine said */
  limitResetsAt?: number;
}

/** The activity row a failed turn is stored as. */
export function failedTurnTool(
  cause: string,
  flags: { setup?: boolean; terminal?: boolean; claudeUpdate?: boolean; place?: PlaceRow; retryAt?: number; done?: number; limitResetsAt?: number } = {},
): FailedTurnTool {
  // limitResetsAt is the engine's own reset time: the same fact as retryAt, kept on the row for the chip that offers to continue.
  const kind = classifyTurnError(cause, { ...flags, retryAt: flags.retryAt ?? flags.limitResetsAt });
  const error: TurnError | undefined = kind || flags.done ? { ...kind, ...(flags.done ? { done: flags.done } : {}) } : undefined;
  const words = cause.length > FAILED_TURN_MAX_CHARS ? `${cause.slice(0, FAILED_TURN_MAX_CHARS - 1)}…` : cause;
  return {
    name: `${MARKER} ${words}`,
    ok: false,
    ...(flags.setup ? { setup: true } : {}),
    ...(flags.terminal ? { terminal: true } : {}),
    ...(flags.claudeUpdate ? { claudeUpdate: true } : {}),
    ...(flags.place ? { place: flags.place } : {}),
    ...(error ? { error } : {}),
    ...(flags.limitResetsAt ? { limitResetsAt: flags.limitResetsAt } : {}),
  };
}

/** The cause a failed-turn row carries, without its marker; null for any
 * other activity row. */
export function failedTurnCause(name: string): string | null {
  return name.startsWith(MARKER) ? name.slice(MARKER.length).trim() : null;
}
