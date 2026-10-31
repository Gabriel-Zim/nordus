import { ChevronRight, MessagesSquare } from "lucide-react";
import { openThread, useStore, type Message } from "@/state/store";
import { useShowThreads } from "@/lib/thread-preferences";
import { t } from "@/lib/i18n";
import { BotAvatar } from "./Avatar";
import { HANDOFF_PILL, HANDOFF_ROW, handoffKind, handoffLabel, handoffLine } from "@/lib/handoff-label";

export function ThreadChip({ message, count = 1 }: { message: Message; count?: number }) {
  const { state, dispatch } = useStore();
  const showThreads = useShowThreads();
  const ref = message.threadRef;
  const tool = message.tool;
  if (!ref || !tool) return null;
  const bot = state.bots.find((candidate) => candidate.id === ref.botId);
  const open = () => openThread(dispatch, ref, state, showThreads);
  if (tool.name === `Opened thread #${ref.title}`) {
    return (
      <div className="flex justify-start">
        <button
          type="button"
          data-thread-chip={ref.threadId}
          data-task-card={ref.threadId}
          onClick={open}
          title={t("chat.openThread", { title: ref.title })}
          className="flex w-fit max-w-[min(var(--chat-bubble-max),var(--chat-bubble-pct))] items-center gap-3 rounded-2xl bg-card px-4 py-3 text-left text-ink transition-colors hover:bg-raised-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          {bot ? <BotAvatar bot={bot} state="happy" size={36} animated={false} /> : <MessagesSquare size={18} aria-hidden="true" className="shrink-0 text-ink-tertiary" />}
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[12px] text-ink-secondary">{t("thread.card.opened")}</span>
            <span data-task-card-title="" className="truncate text-[15px] font-semibold leading-snug text-ink">{ref.title}</span>
            {ref.statusLine && <span className="text-[13px] leading-snug text-ink-secondary">{ref.statusLine}</span>}
          </span>
          <ChevronRight size={16} aria-hidden="true" className="shrink-0 text-ink-tertiary" />
        </button>
      </div>
    );
  }
  const handoff = handoffKind(tool.name) !== null;
  const name = bot?.name ?? ref.title;
  return (
    <div className={HANDOFF_ROW}>
      <button
        type="button"
        data-thread-chip={ref.threadId}
        onClick={open}
        title={handoff ? handoffLabel(tool.name) : t("chat.openThread", { title: ref.title })}
        className={HANDOFF_PILL}
      >
        {bot ? <BotAvatar bot={bot} state="happy" size={20} animated={false} /> : <MessagesSquare size={13} aria-hidden="true" />}
        <span className="max-w-[480px] truncate">{tool.name.startsWith("Incident:") ? t("chat.incident.chip", { name: bot?.name ?? t("room.aBot") }) : handoff ? handoffLine(tool.name, count, name) : handoffLabel(tool.name)}</span>
        <ChevronRight size={13} aria-hidden="true" className="shrink-0 text-ink-tertiary" />
      </button>
    </div>
  );
}
