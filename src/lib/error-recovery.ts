import { activeLocale, t } from "@/lib/i18n";
import { plainErrorLine } from "@/lib/plain-error";
import { toolStepLabel } from "@/lib/tool-step-label";
import type { LocaleKey } from "@/locales";
import type { Message } from "@/state/store";
import { classifyTurnError, type TurnError, type TurnErrorClass } from "../../shared/turn-error";

export type RecoveryAction = "retry" | "sign-in" | "see-done" | "resume" | "open-engines" | "switch-account" | "see-backups";

export interface ErrorRecovery {
  /** one plain sentence; undefined leaves the caller's own wording */
  line?: string;
  actions: RecoveryAction[];
}

export const RECOVERY_LABEL: Record<RecoveryAction, LocaleKey> = {
  retry: "chat.retry",
  "sign-in": "chat.recovery.signIn",
  "see-done": "chat.recovery.seeDone",
  resume: "chat.recovery.resume",
  "open-engines": "chat.recovery.openEngines",
  "switch-account": "chat.recovery.switchAccount",
  "see-backups": "chat.recovery.seeBackups",
};

const LINE: Record<TurnErrorClass, LocaleKey> = {
  "engine-unreachable": "chat.recovery.engineUnreachable",
  "signed-out": "chat.recovery.signedOut",
  "usage-limit": "chat.recovery.usageLimit",
  "engine-down": "chat.recovery.engineDown",
  "disk-full": "chat.recovery.diskFull",
  interrupted: "chat.recovery.interrupted",
};

/** The same failure said of a turn that had already done work: no advice to try again. */
const MID_WORK: Record<TurnErrorClass, LocaleKey> = {
  "engine-unreachable": "chat.recovery.engineUnreachableMidWork",
  "signed-out": "chat.recovery.signedOutMidWork",
  "usage-limit": "chat.recovery.usageLimitMidWork",
  "engine-down": "chat.recovery.engineDownMidWork",
  "disk-full": "chat.recovery.diskFullMidWork",
  interrupted: "chat.recovery.interruptedMidWork",
};

/** What fixes the class, besides trying again. */
const FIX: Record<TurnErrorClass, RecoveryAction[]> = {
  "engine-unreachable": ["retry", "open-engines"],
  "signed-out": ["sign-in"],
  "usage-limit": ["retry", "switch-account"],
  "engine-down": ["retry", "open-engines"],
  "disk-full": ["see-backups", "retry"],
  interrupted: ["retry"],
};

/** A failed turn as one sentence and the ways out. The server's class wins;
 * a row written before it existed is classified from its words, and a cause
 * that fits no class keeps the plain sentence with Retry. When the turn had
 * already done work, the way out is to look first and resume, never to repeat. */
export function errorRecovery(cause: string, error?: TurnError, now = Date.now()): ErrorRecovery {
  const kind: TurnError | undefined = error ?? classifyTurnError(cause, {}, now);
  const restarted = kind?.class === "interrupted" && /Nordus AI restarted/i.test(cause);
  const done = kind?.done ?? 0;
  if (done > 0) {
    const what = t(restarted ? "chat.recovery.restartedMidWork" : kind?.class ? MID_WORK[kind.class] : "chat.recovery.interruptedMidWork");
    const fixes = kind?.class ? FIX[kind.class].filter((action) => action !== "retry") : [];
    return {
      line: `${what} ${t(done === 1 ? "chat.recovery.doneOne" : "chat.recovery.doneMany", { count: done })}`,
      actions: ["see-done", ...fixes, "resume"],
    };
  }
  if (!kind?.class) return { line: plainErrorLine(cause), actions: ["retry"] };
  // A row written before the server counted the turn's work cannot say nothing was done.
  if (kind.class === "interrupted" && !error) return { line: plainErrorLine(cause) ?? t("chat.recovery.interruptedMidWork"), actions: ["retry"] };
  if (kind.class === "interrupted") return { line: t(restarted ? "chat.recovery.restartedBeforeWork" : "chat.recovery.interrupted"), actions: ["retry"] };
  if (kind.class === "usage-limit" && kind.retryAt && kind.retryAt > now) {
    return { line: t("chat.recovery.usageLimitUntil", { when: whenItResets(kind.retryAt, now) }), actions: ["switch-account"] };
  }
  return { line: t(LINE[kind.class]), actions: FIX[kind.class] };
}

/** The send id of a failure row's Resume: the same for every tap, so the server takes it once. */
export function resumeSendId(messageId: string): string {
  return `resume-${messageId.replace(/[^A-Za-z0-9_-]/g, "-")}`.padEnd(16, "-").slice(0, 80);
}

/** "às 15:40", "amanhã às 15:40" or "em 21/10 às 15:40", in the reader's clock. */
export function whenItResets(at: number, now = Date.now()): string {
  const locale = activeLocale();
  const time = new Date(at).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  const day = (ms: number) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const days = Math.round((day(at) - day(now)) / 86_400_000);
  if (days <= 0) return t("chat.recovery.atTime", { time });
  if (days === 1) return t("chat.recovery.tomorrowAt", { time });
  return t("chat.recovery.onDayAt", { date: new Date(at).toLocaleDateString(locale, { day: "2-digit", month: "2-digit" }), time });
}

/** The steps the failed turn started, finished or not, in order: the tool rows
 * between the person's last message and the failure row at `index`, only the
 * failed turn's own when its id is known (a goal or routine runs turns with no
 * message from the person in between). */
export function doneStepsBefore(transcript: readonly Message[], index: number, turnId?: string): string[] {
  const steps: string[] = [];
  for (let i = index - 1; i >= 0; i -= 1) {
    const row = transcript[i]!;
    if (row.role === "user") break;
    if (turnId !== undefined && row.turnId !== turnId) continue;
    if (row.kind === "activity" && row.tool?.itemId) steps.unshift(toolStepLabel(row.tool));
  }
  return steps;
}
