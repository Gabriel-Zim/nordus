// What kind of failure stopped a turn, so the app can offer the way out
// (sign in, wait until the limit resets, open the engines, free space) instead
// of guessing from the engine's English words.

export type TurnErrorClass =
  /** the engine could not be reached at all */
  | "engine-unreachable"
  /** the engine's account is signed out or its sign-in expired */
  | "signed-out"
  /** the engine's account hit its usage limit */
  | "usage-limit"
  /** the engine answered but is overloaded or crashed */
  | "engine-down"
  /** the machine running Nordus has no disk space left */
  | "disk-full"
  /** the turn was cut off (restart, stall, settings change) */
  | "interrupted";

export interface TurnError {
  /** absent when the cause fits no class but the turn had done work */
  class?: TurnErrorClass;
  /** usage-limit: epoch ms when the limit resets, when the engine said */
  retryAt?: number;
  /** tool calls the turn completed before it failed; a positive count means
   * part of the work may already be done, so repeating it could act twice */
  done?: number;
}

/** A subscription's usage running out: terminal even when phrased as a rate limit. Claude Code 2.1.295
 * says "You've hit your weekly limit · resets …", "…your session limit", "…your Opus limit", "…your
 * team's shared budget", "You're out of usage credits", "You're out of extra usage". */
export const USAGE_LIMIT = /\busage limit\b|\bhit your (?:(?!rate\b)[\w'’-]+ ){0,3}(?:limit|budget)\b|\b(?:weekly|daily|monthly|subscription|usage|session|5-hour) limit reached\b|\bout of (?:usage(?: credits)?|extra usage|credits)\b/i;

const STATUS = String.raw`(?:API Error|HTTP|status(?: code)?)[:\s(]+`;
const DISK_FULL = new RegExp(String.raw`\bENOSPC\b|no space left|disk (?:is )?full|insufficient storage|${STATUS}507\b`, "i");
// The engines' own sign-in words; a tool's "token expired" is not the engine's account.
const SIGNED_OUT = /not (?:logged|signed) in|please run \/login|\/login\b|sign in again|log in again|logged out|invalid api key|authentication required|sign-in (?:has )?expired|could not be refreshed|isn't signed in/i;
const INTERRUPTED = /^turn interrupted\b|no activity for \d+ minutes?|the turn was stopped|the turn did not complete/i;
const UNREACHABLE = /\b(?:ECONNREFUSED|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH)\b|connection refused|fetch failed|could not (?:reach|connect to)|unable to connect|is not running|isn't running|socket hang up/i;
const DOWN = new RegExp(String.raw`overloaded|${STATUS}5(?:00|02|03|29)\b|service unavailable|internal server error|bad gateway|\bexited (?:with code )?(?:-?\d+|null)\b|crashed`, "i");
// A passing 429 is not a usage limit: it stays unclassified and reads "wait a moment".
const ACCOUNT_LIMIT = /quota exceeded|account has reached its [\w -]*limit\b/i;
const OWN_BUDGET = /^this bot reached its monthly limit/i;

/** The class of a failed turn's cause; undefined when it fits none, and the
 * app falls back to its plain sentence. `retryAt` comes from the engine's own
 * structured reset time when the caller has it, else from the words. */
export function classifyTurnError(
  cause: string,
  hints: { setup?: boolean; retryAt?: number } = {},
  now = Date.now(),
): { class: TurnErrorClass; retryAt?: number } | undefined {
  const text = cause.trim();
  if (DISK_FULL.test(text)) return { class: "disk-full" };
  if (SIGNED_OUT.test(text) || (hints.setup && /\b401\b|unauthori[sz]ed|sign.?in|log.?in/i.test(text))) return { class: "signed-out" };
  if (!OWN_BUDGET.test(text) && (USAGE_LIMIT.test(text) || ACCOUNT_LIMIT.test(text))) {
    const retryAt = hints.retryAt ?? retryAtFromWords(text, now);
    return retryAt && retryAt > now ? { class: "usage-limit", retryAt } : { class: "usage-limit" };
  }
  if (INTERRUPTED.test(text)) return { class: "interrupted" };
  if (UNREACHABLE.test(text)) return { class: "engine-unreachable" };
  if (DOWN.test(text)) return { class: "engine-down" };
  return undefined;
}

const UNIT_MS: Record<string, number> = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };

/** The reset time the engine wrote: an ISO instant, Claude's "|<epoch seconds>",
 * "try again in 2 hours 5 minutes", "retry after 30", or a clock time ("try
 * again at 5:23 PM", "resets 3pm") read in this machine's time zone. */
export function retryAtFromWords(text: string, now = Date.now()): number | undefined {
  const iso = /\b\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d+)?)?(?:Z|[+-]\d\d:?\d\d)\b/.exec(text)?.[0];
  if (iso) return Date.parse(iso);
  const epoch = /\|(\d{10})\b/.exec(text)?.[1];
  if (epoch) return Number(epoch) * 1000;
  const after = /retry[- _]after[:=\s]+(\d{1,6})\b/i.exec(text)?.[1];
  if (after) return now + Number(after) * 1000;
  const within = /(?:try again|resets?|available) in ((?:\d+\s*(?:seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d)\b[\s,and]*)+)/i.exec(text)?.[1];
  if (within) {
    let ms = 0;
    for (const [, amount, unit] of within.matchAll(/(\d+)\s*([a-z]+)/gi)) ms += Number(amount) * (UNIT_MS[unit!.toLowerCase()[0]!] ?? 0);
    return ms > 0 ? now + ms : undefined;
  }
  const clock = /(?:try again at|resets?(?: at)?)\s+(\d{1,2})(?::(\d\d))?\s*(am|pm)\b/i.exec(text);
  if (clock) {
    const hour = (Number(clock[1]) % 12) + (clock[3]!.toLowerCase() === "pm" ? 12 : 0);
    const at = new Date(now);
    at.setHours(hour, Number(clock[2] ?? 0), 0, 0);
    if (at.getTime() <= now) at.setDate(at.getDate() + 1);
    return at.getTime();
  }
  return undefined;
}
