import { focusCardWhenShown } from "@/lib/card-focus";
import type { NotificationTarget } from "@/lib/notify";
import { DIRECT_THREAD_PREFIX } from "../../shared/people";
import { directIdOf } from "./direct-messages";
import type { Action, AppState } from "./store";

interface NotificationThreadOwner {
  id: string;
  threadId: string;
  mainThreadId?: string;
  tasks?: Array<{ threadId: string }>;
}

interface NotificationRoutingState {
  bots: NotificationThreadOwner[];
  groups: NotificationThreadOwner[];
}

export function visibleNotificationThread(
  state: NotificationRoutingState & Pick<AppState, "activeView" | "selectedId" | "directId">,
): string | null {
  if (state.activeView === "direct") return state.directId ? `${DIRECT_THREAD_PREFIX}${state.directId}` : null;
  if (state.activeView !== "chat") return null;
  return (
    state.bots.find((candidate) => candidate.id === state.selectedId)?.threadId ??
    state.groups.find((candidate) => candidate.id === state.selectedId)?.threadId ??
    null
  );
}

export function openNotificationTarget(
  dispatch: (action: Action) => void,
  target: NotificationTarget,
  state: NotificationRoutingState,
  threadsShown: boolean,
) {
  const direct = directIdOf(target.threadId);
  if (direct) {
    dispatch({ type: "showDirect", id: direct });
    return;
  }
  if (target.requestId) {
    focusCardWhenShown(target.requestId, (messageId) => dispatch({ type: "focusMessage", threadId: target.threadId, messageId }));
  }
  // A room notification carries the asker bot with the room's thread id; switching the bot to it would 404.
  const group = state.groups.find(
    (candidate) =>
      candidate.threadId === target.threadId ||
      (candidate.tasks ?? []).some((task) => task.threadId === target.threadId),
  );
  if (group) {
    dispatch({ type: "select", id: group.id });
    if (group.threadId !== target.threadId) {
      dispatch({ type: "switchGroupTask", groupId: group.id, threadId: target.threadId });
    }
    return;
  }
  const bot = state.bots.find((candidate) =>
    candidate.threadId === target.threadId || candidate.tasks?.some((task) => task.threadId === target.threadId)
  ) ?? state.bots.find((candidate) => candidate.id === target.botId);
  if (!bot) {
    dispatch({ type: "select", id: target.botId });
    return;
  }
  const known =
    bot.threadId === target.threadId ||
    (bot.tasks ?? []).some((task) => task.threadId === target.threadId);
  if (known) openBotThread(dispatch, bot, target.threadId, threadsShown);
  else openBot(dispatch, bot, threadsShown);
}

export function botOpensTo(bot: Pick<NotificationThreadOwner, "threadId" | "mainThreadId" | "tasks">, threadsShown: boolean): string {
  // A routine run's own conversation is a detail opened from Registros: picking the bot always leads back to talking to it.
  const inRun = Boolean(bot.tasks?.find((task) => task.threadId === bot.threadId && "routineRunId" in task && task.routineRunId));
  return (!threadsShown || inRun) && bot.mainThreadId && bot.tasks?.some((task) => task.threadId === bot.mainThreadId)
    ? bot.mainThreadId : bot.threadId;
}

export function awayFromMainThread(bot: Pick<NotificationThreadOwner, "threadId" | "mainThreadId" | "tasks">, threadsShown: boolean): boolean {
  return !threadsShown && botOpensTo(bot, false) !== bot.threadId;
}

export function openBot(
  dispatch: (action: Action) => void,
  bot: Pick<NotificationThreadOwner, "id" | "threadId" | "mainThreadId" | "tasks">,
  threadsShown: boolean,
) {
  const opened = botOpensTo(bot, threadsShown);
  if (opened === bot.threadId) dispatch({ type: "select", id: bot.id });
  else openBotThread(dispatch, bot, opened, threadsShown);
}

export function openWhereBotWaits(
  dispatch: (action: Action) => void,
  bot: Pick<NotificationThreadOwner, "id" | "threadId" | "mainThreadId" | "tasks">,
  waitingThreadId: string | undefined,
  threadsShown: boolean,
) {
  if (waitingThreadId === bot.threadId) dispatch({ type: "select", id: bot.id });
  else if (waitingThreadId) dispatch({ type: "switchTask", botId: bot.id, threadId: waitingThreadId });
  else openBot(dispatch, bot, threadsShown);
}

/** With threads hidden the switch alone selects the bot, so the thread left behind keeps its unread mark. */
export function openBotThread(
  dispatch: (action: Action) => void,
  bot: Pick<NotificationThreadOwner, "id" | "threadId">,
  threadId: string,
  threadsShown: boolean,
) {
  if (threadsShown || threadId === bot.threadId) dispatch({ type: "select", id: bot.id });
  dispatch({ type: "switchTask", botId: bot.id, threadId });
}

export interface ThreadTarget {
  botId: string;
  threadId: string;
  /** The card to land on once the conversation shows. */
  requestId?: string;
}

interface ThreadOpeningState extends NotificationRoutingState {
  bots: Array<NotificationThreadOwner & { name: string }>;
}

export function openThread(
  dispatch: (action: Action) => void,
  target: ThreadTarget,
  state: ThreadOpeningState,
  threadsShown: boolean,
): boolean {
  const owns = (owner: NotificationThreadOwner) =>
    owner.threadId === target.threadId || (owner.tasks ?? []).some((task) => task.threadId === target.threadId);
  if (state.groups.some(owns) || state.bots.some(owns)) {
    openNotificationTarget(dispatch, target, state, threadsShown);
    dispatch({ type: "revealThread", threadId: target.threadId });
    return true;
  }
  const bot = state.bots.find((candidate) => candidate.id === target.botId);
  if (bot) openBot(dispatch, bot, threadsShown);
  dispatch({ type: "notice", notice: { kind: "thread-gone", botName: bot?.name ?? null } });
  return false;
}
