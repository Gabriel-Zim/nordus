import { useEffect, useState } from "react";
import { BotAvatar } from "@/components/Avatar";
import { t } from "@/lib/i18n";
import { waitingTaskFor } from "@/lib/waiting-approval";
import { api, STARTUP_MESSAGES, type Bot, type Message } from "@/state/store";
import { approvalNaturalText, PendingApprovalActions, pendingApprovals, type Pending } from "./PendingApproval";

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

/** An approval waiting in another thread of the bot, pinned above the message box with the same answers as the card in the timeline. */
export function OtherThreadApprovalCard({ bot, threadId, pending }: {
  bot: Pick<Bot, "id" | "name" | "color"> & Partial<Bot>;
  threadId: string;
  pending: Pending;
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
      <p className="mt-2 whitespace-pre-wrap break-words text-[15px] leading-relaxed" aria-live="polite">
        {approvalNaturalText(pending)}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <PendingApprovalActions part="primary" pending={pending} threadId={threadId} bot={{ id: bot.id, name: bot.name }} />
      </div>
    </div>
  );
}

/**
 * When the bot waits for an answer in another thread than the open conversation, the question itself follows the
 * person here and is answered without leaving. Only a real open request shows; nothing shows when the waiting thread
 * is the open one, whose timeline already carries the card.
 */
export function OtherThreadApproval({ bot }: { bot: Bot }) {
  const found = waitingTaskFor(bot, bot.threadId);
  const threadId = found && found.threadId !== bot.threadId ? found.threadId : undefined;
  const pending = useThreadPending(threadId, `${found?.updatedAt ?? ""}`);
  if (!threadId || !pending) return null;
  return <OtherThreadApprovalCard bot={bot} threadId={threadId} pending={pending} />;
}
