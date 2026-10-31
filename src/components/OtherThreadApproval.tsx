import { useEffect, useState } from "react";
import { BotAvatar } from "@/components/Avatar";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { waitingTaskFor } from "@/lib/waiting-approval";
import { api, STARTUP_MESSAGES, useStore, type Bot, type Message, type Task } from "@/state/store";
import { APPROVAL_CONTROL, approvalNaturalText, PendingApprovalActions, pendingApprovals, type Pending } from "./PendingApproval";

/** Reads the first approval still waiting in another thread of the bot; undefined while loading, when it cannot be read, or when none waits. */
function useThreadPending(threadId: string | undefined, version: string): Pending | undefined {
  const [loaded, setLoaded] = useState<{ key: string; pending?: Pending }>();
  const key = `${threadId}:${version}`;
  useEffect(() => {
    if (!threadId) return;
    let current = true;
    api<{ messages?: Message[] }>(`/api/threads/${threadId}/messages?limit=${STARTUP_MESSAGES}`)
      .then((page) => { if (current) setLoaded({ key, pending: pendingApprovals(page.messages ?? [])[0] }); })
      .catch(() => { if (current) setLoaded({ key }); });
    return () => { current = false; };
  }, [threadId, key]);
  return loaded?.key === key ? loaded.pending : undefined;
}

/** The approval card of a task in another thread, pinned above the message box with the same answers as the card in the timeline. */
export function OtherThreadApprovalCard({ bot, task, pending, onOpen }: {
  bot: Pick<Bot, "id" | "name" | "color"> & Partial<Bot>;
  task: Pick<Task, "threadId" | "title">;
  pending?: Pending;
  onOpen: () => void;
}) {
  return (
    <div
      role="region"
      aria-label={t("approval.aria.pending")}
      data-other-thread-approval=""
      className="pointer-events-auto mx-5 mb-2 rounded-xl border border-hairline/40 bg-card px-4 py-3 text-ink"
    >
      <div className="flex min-w-0 items-center gap-2">
        <BotAvatar bot={bot} size={18} motion="none" motionKey={0} animated={false} />
        <span className="min-w-0 truncate text-[12.5px] font-medium text-ink-secondary">{t("approval.card.asksApproval", { name: bot.name })}</span>
      </div>
      <p dir="auto" className="mt-1 truncate text-[12px] text-ink-tertiary">{t("approval.other.task", { title: task.title })}</p>
      <p className="mt-2 whitespace-pre-wrap break-words text-[15px] leading-relaxed" aria-live="polite">
        {pending ? approvalNaturalText(pending) : t("approval.other.waiting", { name: bot.name })}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {pending && <PendingApprovalActions part="primary" pending={pending} threadId={task.threadId} bot={{ id: bot.id, name: bot.name }} />}
        <button type="button" onClick={onOpen} className={cn(APPROVAL_CONTROL, "ml-auto bg-ink/[0.07] text-ink hover:bg-ink/[0.12]")}>
          {t("approval.other.open")}
        </button>
      </div>
    </div>
  );
}

/**
 * When the open conversation is not where the bot waits for an answer, the question follows the person here:
 * the waiting task's own approval, answerable without leaving. Nothing shows when the waiting task is the open one,
 * whose timeline already carries the card.
 */
export function OtherThreadApproval({ bot }: { bot: Bot }) {
  const { dispatch } = useStore();
  const found = waitingTaskFor(bot, bot.threadId);
  const task = found && found.threadId !== bot.threadId ? found : undefined;
  const pending = useThreadPending(task?.threadId, `${task?.updatedAt ?? ""}`);
  if (!task) return null;
  return <OtherThreadApprovalCard bot={bot} task={task} pending={pending} onOpen={() => dispatch({ type: "switchTask", botId: bot.id, threadId: task.threadId })} />;
}
