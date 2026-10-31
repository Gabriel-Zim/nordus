import { ArrowRight, Loader2, Zap } from "lucide-react";

import { cn } from "@/lib/cn";
import { routineDateTime } from "@/lib/routine-display";
import { plainChatText } from "../../shared/plain-chat-text";
import { ChatMarkdown } from "./ChatMarkdown";
import { t } from "@/lib/i18n";
import { useShowThreads } from "@/lib/thread-preferences";
import { liveCardKind } from "../../shared/live-approval";
import type { AutomationLine, RoutineRunCardData } from "../../shared/routine-run";
import { formatTime, openNotificationTarget, useStore, type Message } from "@/state/store";

const DETAIL_LIMIT = 280;

const STATUS_TONE = {
  queued: "text-ink-secondary",
  running: "text-accent",
  waiting: "text-warning",
  completed: "text-ink-secondary",
  failed: "text-danger",
  cancelled: "text-ink-secondary",
  missed: "text-danger",
} satisfies Record<RoutineRunCardData["status"], string>;

const GOAL_TONE = {
  completed: STATUS_TONE.completed,
  "needs-input": "text-warning",
  blocked: "text-danger",
  "limit-reached": "text-warning",
  paused: "text-warning",
  stopped: "text-ink-secondary",
  failed: STATUS_TONE.failed,
} satisfies Record<NonNullable<RoutineRunCardData["goalStatus"]>, string>;

function statusCopy(run: RoutineRunCardData): { label: string; tone: string } {
  if (run.goalStatus) return { label: t(`routines.goal.${run.goalStatus}`), tone: GOAL_TONE[run.goalStatus] };
  if (run.status === "queued" && run.deferredAt != null) return { label: t("routines.run.deferred"), tone: "text-warning" };
  return { label: t(`routines.status.${run.status}`), tone: STATUS_TONE[run.status] };
}

function compactDetail(value: string | undefined): string {
  const clean = value?.replace(/\s+/g, " ").trim() ?? "";
  return clean.length > DETAIL_LIMIT ? `${clean.slice(0, DETAIL_LIMIT - 1).trimEnd()}…` : clean;
}

export function hasRoutineExecutionTask(
  tasks: ReadonlyArray<{ threadId: string }> | undefined,
  executionThreadId: string | undefined,
): executionThreadId is string {
  return Boolean(
    executionThreadId && tasks?.some((task) => task.threadId === executionThreadId),
  );
}

export function RoutineRunCard({
  message,
  onOpen,
}: {
  message: Message;
  onOpen?: () => void;
}) {
  const run = message.routineRun;
  if (!run) {
    const fallback = compactDetail(message.text);
    return fallback ? (
      <div className="w-fit max-w-[min(var(--chat-bubble-max),var(--chat-card-pct))] rounded-2xl bg-card px-4 py-2.5 text-[14px] leading-relaxed text-ink">
        {fallback}
      </div>
    ) : null;
  }

  // Nordus: a finished routine's result reads as the bot's own message (markdown rendered, no card, no status word),
  // under one quiet line naming the routine and its time. The run's details stay in Registros.
  if (run.status === "completed" && !run.goalStatus && run.summary?.trim()) {
    const at = run.scheduledFor ?? message.at;
    return (
      <div data-routine-result="" className="flex w-full min-w-0 flex-col items-start gap-1">
        <div className="px-1 text-[11.5px] text-ink-tertiary">
          {t("routines.results.line", { name: run.routineName, time: routineDateTime(at) })}
        </div>
        <div className="chat-text w-fit max-w-[min(var(--chat-bubble-max),var(--chat-card-pct))] rounded-2xl bg-card px-4 py-2.5 text-ink">
          <ChatMarkdown text={plainChatText(run.summary)} />
        </div>
      </div>
    );
  }

  const copy = statusCopy(run);
  const detail = compactDetail(
    run.status === "failed" || run.status === "missed"
      ? (run.error ?? run.summary)
      : (run.summary ?? run.error),
  );
  const review = run.goalStatus === "needs-input";

  return (
    <section
      aria-label={t("routines.run.aria", { name: run.routineName, status: copy.label })}
      className="w-full max-w-[680px] rounded-xl border border-hairline/45 bg-card px-4 py-3"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <h3 className="truncate text-[14px] font-semibold text-ink">{run.routineName}</h3>
            <span aria-live="polite" className={cn("inline-flex items-center gap-1 text-[11.5px] font-semibold", copy.tone)}>
              {run.status === "running" && !run.goalStatus && <Loader2 aria-hidden="true" className="size-3 animate-spin" />}
              {copy.label}
            </span>
          </div>
          <time dateTime={new Date(run.scheduledFor ?? message.at).toISOString()} className="mt-0.5 block text-[11.5px] text-ink-secondary">
            {routineDateTime(run.scheduledFor ?? message.at)}
          </time>
          {detail && <p className="mt-1.5 text-[13px] leading-relaxed text-ink-secondary">{detail}</p>}
          {run.status === "completed" && run.summary && run.summary.length > DETAIL_LIMIT && <details className="mt-2 text-[12px] text-ink-secondary">
            <summary className="cursor-pointer font-medium text-ink-secondary hover:text-ink">{t("routines.results.showReport")}</summary>
            <p className="mt-2 whitespace-pre-wrap leading-relaxed">{run.summary}</p>
          </details>}
        </div>
        {onOpen && run.executionThreadId && (
          <button
            type="button"
            onClick={onOpen}
            aria-label={t(review ? "routines.run.reviewAria" : "routines.run.openAria", { name: run.routineName })}
            className={cn(
              "flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[12px] font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
              review
                ? "bg-warning/15 text-warning hover:bg-warning/25"
                : "text-ink-secondary hover:bg-inset hover:text-ink",
            )}
          >
            {t(review ? "routines.run.review" : "routines.run.open")}
            <ArrowRight aria-hidden="true" size={13} />
          </button>
        )}
      </div>
    </section>
  );
}

export function RoutineRunRow({ message, botId }: { message: Message; botId: string }) {
  const { state, dispatch } = useStore();
  const showThreads = useShowThreads();
  const executionThreadId = message.routineRun?.executionThreadId;
  const canOpen = executionThreadId && state.bots.some((candidate) =>
    candidate.threadId === executionThreadId || hasRoutineExecutionTask(candidate.tasks, executionThreadId)
  );
  return (
    <RoutineRunCard
      message={message}
      onOpen={canOpen && executionThreadId
        ? () => openNotificationTarget(dispatch, { botId, threadId: executionThreadId }, state, showThreads)
        : undefined}
    />
  );
}

/** Above a line an automation run wrote in a chat: which automation, when, and the way to its full run. */
export function AutomationCaption({ message, line, botId }: { message: Message; line: AutomationLine; botId: string }) {
  const { state, dispatch } = useStore();
  const showThreads = useShowThreads();
  const canOpen = state.bots.some((bot) => bot.threadId === line.executionThreadId || hasRoutineExecutionTask(bot.tasks, line.executionThreadId));
  const asking = line.needsYou === true && (message.card ? liveCardKind(message.card) !== null : line.copyOf !== undefined ||
    !state.bots.find((bot) => bot.id === botId)?.messages.some((later) => later.role === "user" && later.at > message.at));
  const tone = line.failed ? "text-danger" : asking ? "text-warning" : "text-accent";
  return (
    <div data-automation-caption={line.runId} className="-mb-2 flex min-w-0 items-center gap-1.5 pl-0.5 text-[11px] text-ink-tertiary">
      <Zap aria-hidden="true" size={12} className={cn("shrink-0", tone)} />
      <span className="truncate font-medium text-ink-secondary">{line.name}</span>
      <time className="shrink-0" dateTime={new Date(line.scheduledFor).toISOString()}>· {formatTime(line.scheduledFor)}</time>
      {(line.failed || asking) && <span className={cn("shrink-0", tone)}>· {t(line.failed ? "chat.automation.failed" : "chat.automation.needsYou")}</span>}
      {canOpen && (
        <button
          type="button"
          onClick={() => openNotificationTarget(dispatch, { botId, threadId: line.executionThreadId }, state, showThreads)}
          aria-label={t("chat.automation.openRunFor", { name: line.name })}
          className="shrink-0 rounded px-1 hover:bg-inset hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        >
          {t("chat.automation.openRun")}
        </button>
      )}
    </div>
  );
}
