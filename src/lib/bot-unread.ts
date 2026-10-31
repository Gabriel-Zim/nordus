type UnreadTask = {
  threadId?: string;
  unread?: boolean;
  routineRunId?: string;
  archivedAt?: number;
  activity?: string;
  openedBy?: unknown;
};

/** The bot's dot. A request another bot opened here is bot-to-bot work (its answer goes back to whoever asked), so it
 *  lights the dot only when it waits for the person. */
export function botShowsUnread(bot: {
  unread?: boolean;
  tasks?: ReadonlyArray<UnreadTask> | null;
}): boolean {
  if (!bot.tasks?.length) return Boolean(bot.unread);
  return bot.tasks.some((task) => Boolean(task.unread) && !task.routineRunId && task.archivedAt === undefined
    && (!task.openedBy || task.activity === "waiting-on-you"));
}

/** Unread side conversations the list does not show under the bot (a trigger, an e-mail, a request from another bot):
 *  opening the bot reads them along with the conversation it opens. One that waits for the person stays unread. */
export function hiddenUnreadThreads(bot: { mainThreadId?: string; tasks?: ReadonlyArray<UnreadTask> | null }, shownThreadId: string | undefined): string[] {
  // The main conversation is the bot's own row in the list, so it is never one of these.
  return (bot.tasks ?? [])
    .filter((task) => task.unread && task.threadId && task.threadId !== shownThreadId && task.threadId !== bot.mainThreadId
      && task.activity !== "waiting-on-you")
    .map((task) => task.threadId!);
}
