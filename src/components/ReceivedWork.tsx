import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { whenIdleLimited } from "@/lib/idle-queue";
import { t } from "@/lib/i18n";
import { HANDOFF_PILL, HANDOFF_ROW } from "@/lib/handoff-label";
import { visibleBotText } from "@/lib/visible-bot-text";
import { plainChatText } from "../../shared/plain-chat-text";
import { newestRounds, receivedRounds, receivedTasks, type ReceivedRound } from "@/lib/received-work";
import { stepLines, taskStepNow } from "@/lib/work-steps";
import { api, openThread, useStore, visibleMessages, type Bot, type Message, type Task } from "@/state/store";
import { useShowThreads } from "@/lib/thread-preferences";
import { BotAvatar } from "./Avatar";
import { PeerLabel } from "./PeerLabel";
import { StepList, TaskDots, useNow } from "./WorkingNow";

const PAGE = 80;

/** One round of a conversation another bot opened on this one, and where it stands. */
export interface ReceivedBlock {
  botId: string;
  threadId: string;
  sender: { botId: string; name: string; threadId?: string };
  round: ReceivedRound;
  anchorAt: number;
}

const stateKey = (task: Task) =>
  [task.threadId, task.busy, task.activity, task.waitingForTeammates, task.turnStartedAt].join("|");

/** The rounds of each conversation other bots opened on this bot, the newest few. Each page is read again only when a turn there
 *  starts or ends; nothing is written to any thread. */
export function useReceivedWork(bot: Pick<Bot, "id" | "name" | "threadId" | "tasks">, enabled: boolean): ReceivedBlock[] {
  const tasks = useMemo(() => (enabled ? receivedTasks(bot) : []), [enabled, bot.id, bot.threadId, bot.tasks]);
  const [rounds, setRounds] = useState<Record<string, { botId: string; rounds: ReceivedRound[] }>>({});
  const loaded = useRef(new Map<string, string>());
  const signature = tasks.map(stateKey).join("\n");
  useEffect(() => {
    let current = true;
    for (const task of tasks) {
      const key = stateKey(task);
      if (loaded.current.get(task.threadId) === key) continue;
      void whenIdleLimited(() => api<{ messages: Message[]; activeLeafId?: string | null }>(`/api/threads/${task.threadId}/messages?limit=${PAGE}`))
        .then((page) => {
          if (!current) return;
          loaded.current.set(task.threadId, key);
          const messages = visibleMessages({ messages: page.messages, activeLeafId: page.activeLeafId ?? undefined });
          setRounds((previous) => ({ ...previous, [task.threadId]: { botId: bot.id, rounds: receivedRounds(task, messages, bot) } }));
        })
        .catch(() => {});
    }
    return () => { current = false; };
  }, [signature, bot.id, bot.name]);
  // Keyed on who sent what, not on the tasks themselves: their steps change every moment and the transcript must not.
  const senders = tasks.map((task) => [task.threadId, task.openedBy.botId, task.openedBy.name, task.openedBy.threadId].join("|")).join("\n");
  return useMemo(
    () => newestRounds(tasks.flatMap((task) => {
      const entry = rounds[task.threadId];
      if (!entry || entry.botId !== bot.id) return [];
      const { botId, name, threadId } = task.openedBy;
      return entry.rounds.map((round) => ({ botId: bot.id, threadId: task.threadId, sender: { botId, name, threadId }, round, anchorAt: round.anchorAt }));
    })),
    [senders, rounds, bot.id],
  );
}

const ASK_BUBBLE =
  "w-fit max-w-[min(var(--chat-bubble-max),var(--chat-bubble-pct))] rounded-md px-0.5 text-left text-[13px] leading-relaxed text-ink-secondary transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60";

/** What another bot sent this one, with the bot working on it live and, once done, the way back to the sender. It reads
 *  as part of the conversation but is drawn from the work thread: the model never sees it. */
export function ReceivedWork({ block }: { block: ReceivedBlock }) {
  const { state, dispatch } = useStore();
  const showThreads = useShowThreads();
  const { round, sender } = block;
  const bot = state.bots.find((candidate) => candidate.id === block.botId);
  const task = bot?.tasks?.find((candidate) => candidate.threadId === block.threadId);
  const author = state.bots.find((candidate) => candidate.id === sender.botId) ?? state.bots.find((candidate) => candidate.name === sender.name);
  const kind = round.state.kind;
  const open = () => openThread(dispatch, { botId: block.botId, threadId: block.threadId }, state, showThreads);
  const goToSender = () => {
    if (sender.threadId) openThread(dispatch, { botId: sender.botId, threadId: sender.threadId }, state, showThreads);
    else dispatch({ type: "select", id: sender.botId });
  };
  const running = Boolean(task && (task.busy || task.waitingForTeammates));
  const live = kind === "queued" || ((kind === "working" || kind === "waiting") && running);
  const now = useNow(live);
  const lines = stepLines(task?.steps);
  return (
    <div data-received-work={block.threadId} data-received-state={kind} className="flex w-full flex-col gap-2">
      {round.asks.length > 0 && (
        <div className="flex w-full flex-col items-start gap-0.5">
          <PeerLabel peer={{ botId: sender.botId, name: sender.name, delivery: "coordinate_bots", body: "", awaitsReply: true }} bots={state.bots} />
          {round.asks.map((ask) => (
            <button
              key={ask.id}
              type="button"
              data-received-ask={ask.id}
              onClick={open}
              title={t("chat.openConversationWith", { name: sender.name })}
              className={ASK_BUBBLE}
            >
              <span className={cn("block whitespace-pre-wrap break-words", kind === "returned" ? "line-clamp-1" : "line-clamp-2")}>
                {plainChatText(visibleBotText(ask.text))}
              </span>
            </button>
          ))}
        </div>
      )}
      {live && (
        <div data-received-live="" className="flex min-w-0 flex-col gap-1.5 pl-0.5">
          {kind === "waiting" ? (
            <span className="text-[13px] text-ink-secondary">{`${bot?.name ?? ""}: ${t("task.waitingForYou")}`}</span>
          ) : lines.length > 0 && task?.busy ? (
            <StepList lines={lines} now={now} />
          ) : (
            <div className="flex items-center gap-2 px-1 text-[13px] text-ink-secondary">
              <TaskDots />
              <span className="min-w-0 break-words">{(task && taskStepNow(task)) ?? t(kind === "queued" ? "task.waiting" : "chat.activity.working")}</span>
            </div>
          )}
        </div>
      )}
      {kind === "stopped" && (
        <span data-received-stopped="" className="pl-0.5 text-[13px] text-ink-tertiary">{t("interrupted.title")}</span>
      )}
      {kind === "returned" && (
        <div className={HANDOFF_ROW}>
          <button
            type="button"
            data-received-return={sender.botId}
            onClick={goToSender}
            title={t("chat.openConversationWith", { name: sender.name })}
            className={HANDOFF_PILL}
          >
            <BotAvatar bot={author ?? { name: sender.name, color: "blue" }} state="happy" size={16} animated={false} />
            <span className="max-w-[480px] truncate">{t("handoff.sent", { name: sender.name })}</span>
            <ChevronRight size={12} aria-hidden="true" className="shrink-0 text-ink-tertiary" />
          </button>
        </div>
      )}
    </div>
  );
}
