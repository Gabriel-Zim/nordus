import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";

const UNREACHABLE = /^(?:TypeError:\s*)?(?:Failed to fetch|NetworkError when attempting to fetch resource\.?|Load failed|fetch failed)$/i;
const TIMED_OUT = /^(?:TimeoutError:\s*)?(?:The operation was aborted due to timeout|signal timed out|The operation timed out\.?)$/i;

// The provider's "selected model" refusal, optionally behind an HTTP/API prefix. Anchored on both ends so a normal
// sentence that merely quotes the error is left alone.
const MODEL_UNAVAILABLE_PREFIX = /^(?:[\w-]+ ){0,2}(?:API Error|Error|HTTP|status(?: code)?)[:\s]+(?:\d{3}\b[\s:.-]*)?/i;
const MODEL_UNAVAILABLE = /^(?:there['’]s|there is) an issue with the selected model\b[\s\S]{0,240}?(?:it may not exist|may not have access|--model\b)[\s\S]{0,160}$/i;

export function isModelUnavailableError(raw: string): boolean {
  const text = raw.trim().replace(MODEL_UNAVAILABLE_PREFIX, "").trim();
  return Boolean(text) && MODEL_UNAVAILABLE.test(text);
}

const TECHNICAL: RegExp[] = [
  UNREACHABLE,
  TIMED_OUT,
  /^\d{3}(?: [A-Za-z][\w '-]*)?$/,
  /[{[]\s*"[\w$-]+"\s*:/,
  /\n\s+at \S/,
  /^[A-Z][a-z]+Error: /,
  /\b(?:E(?:CONNRESET|CONNREFUSED|CONNABORTED|NOTFOUND|AI_AGAIN|TIMEDOUT|PIPE|ACCES|PERM|NOENT|ADDRINUSE|HOSTUNREACH|NETUNREACH)|ERR_[A-Z_]{3,})\b/,
  /^(?:[\w-]+ ){0,2}(?:API Error|HTTP|status(?: code)?)[:\s]+\d{3}\b/i,
  /Unexpected token .* in JSON|is not valid JSON|Unexpected end of JSON input/,
  /^\S+ exited (?:with code )?-?\d+\b/,
  /^[a-z]+(?:_[a-z0-9]+)+$/,
  /^CUA Driver is not ready/,
  /^this bot reached its monthly limit/,
  /^turn interrupted — /,
];

const KINDS: Array<[RegExp, LocaleKey]> = [
  [/^CUA Driver is not ready/, "error.plain.computerNotReady"],
  [/^this bot reached its monthly limit/, "error.plain.botBudget"],
  [/^turn interrupted — Nordus AI restarted/, "error.plain.restarted"],
  [/^turn interrupted — /, "error.plain.interrupted"],
  [UNREACHABLE, "error.plain.unreachable"],
  [/\b429\b|rate.?limit|too many requests/i, "error.plain.rateLimited"],
  [/overloaded|\b529\b|\b503\b|capacity|service unavailable/i, "error.plain.busy"],
  [/ECONNRESET|ECONNREFUSED|ECONNABORTED|EPIPE|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|socket hang up|connection (?:reset|refused)/i, "error.plain.connection"],
  [/timeout|timed out|ETIMEDOUT/i, "error.plain.timeout"],
  [/\b(?:EACCES|EPERM)\b/, "error.plain.permission"],
  [/\b40[13]\b|unauthori[sz]ed|forbidden/i, "error.plain.access"],
  [/\b404\b|not found|ENOENT/i, "error.plain.notFound"],
  [/\b413\b|too large/i, "error.plain.tooLarge"],
  [/\b5\d\d\b|internal server error|bad gateway/i, "error.plain.server"],
];

/** The request never reached Nordus: no network, or something in front of it turned it away. */
export function isUnreachableError(raw: string): boolean {
  return UNREACHABLE.test(raw.trim());
}

export function isTechnicalError(raw: string): boolean {
  const text = raw.trim();
  return Boolean(text) && (isModelUnavailableError(text) || TECHNICAL.some((pattern) => pattern.test(text)));
}

const STATUS_PREFIX = /^(?:[\w-]+ ){0,2}(?:API Error|HTTP|status(?: code)?)[:\s]+\d{3}\b[\s:.-]*/i;

const REASON_PHRASE = /^(?:[A-Z][a-z]+ ?){1,4}\.?$/;

export function plainErrorLine(raw: string): string | undefined {
  if (!isTechnicalError(raw)) return undefined;
  const text = raw.trim();
  if (isModelUnavailableError(text)) return t("error.plain.modelUnavailable");
  const rest = text.replace(STATUS_PREFIX, "").trim();
  if (rest !== text && /[A-Za-z]+\s+[A-Za-z]+/.test(rest) && !REASON_PHRASE.test(rest) && !isTechnicalError(rest)) return rest;
  const key = KINDS.find(([pattern]) => pattern.test(text))?.[1] ?? "error.plain.generic";
  return t(key);
}
