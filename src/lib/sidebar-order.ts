import type { AttentionThread } from "@/components/SidebarBotActivity";
import type { Bot, Group, Message } from "@/state/store";
import { movesThreadToTop } from "../../shared/wire";

export type SidebarFlatItem = { kind: "bot"; bot: Bot; waiting: boolean; at: number } | { kind: "group"; group: Group; waiting: boolean; at: number };

type OrderedTask = { title: string; lastThreadOrderAt?: number; attentionAt?: number; routineRunId?: string; openedBy?: unknown; archivedAt?: number };

/** The server names a routine or trigger run's conversation "<name> · Oct 17, 12:15 AM". */
const RUN_TITLE = / · [A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2}\s?[AP]M$/;

export function runConversation(title: string): boolean {
  return RUN_TITLE.test(title);
}

/** Nordus: an automation's own results chat, "<name> · Resultados" (" · Results" before), is a helper, not a conversation. */
const RESULTS_TITLE = / · (?:Results|Resultados)$/;

/** A conversation the server keeps for a bot's own work: a run, or an automation's results chat. */
export function auxiliaryConversation(title: string): boolean {
  return runConversation(title) || RESULTS_TITLE.test(title);
}

/** Routine and trigger runs and requests from another bot are the bot's own work: their prompts and answers are not
 *  lines for the person. */
const personReads = (task: OrderedTask) => !task.routineRunId && !task.openedBy && !auxiliaryConversation(task.title);

/** Moves only with a line in a conversation the person reads (lastThreadOrderAt) or when any conversation lights the
 *  unread dot or waits on the person (attentionAt). Steps, status and tool calls leave both, so the row stays put. */
function listOrderAt(messages: readonly Message[], tasks: readonly OrderedTask[] | undefined): number {
  if (!tasks?.length) {
    const last = messages.findLast((message) => movesThreadToTop(message));
    return last ? last.turnCompletedAt ?? last.at : 0;
  }
  let at = 0;
  for (const task of tasks) {
    if (task.archivedAt !== undefined) continue;
    at = Math.max(at, task.attentionAt ?? 0, personReads(task) ? task.lastThreadOrderAt ?? 0 : 0);
  }
  return at;
}

/** Whoever waits on the person comes first; then the conversation with the newest message for the person, bots and rooms alike. */
export function sidebarFlatItems(bots: readonly Bot[], groups: readonly Group[], needsYou: readonly AttentionThread[], waitingLeaders: ReadonlySet<string> = new Set()): SidebarFlatItem[] {
  const waitingBots = new Set(needsYou.flatMap((entry) => entry.kind === "bot" ? [entry.botId] : []));
  const waitingGroups = new Set(needsYou.flatMap((entry) => entry.kind === "group" ? [entry.groupId] : []));
  const items: SidebarFlatItem[] = [
    ...bots.map((bot): SidebarFlatItem => ({
      kind: "bot",
      bot,
      waiting: bot.activity === "waiting-on-you" || waitingBots.has(bot.id) || waitingLeaders.has(bot.id),
      at: listOrderAt(bot.messages, bot.tasks),
    })),
    ...groups.map((group): SidebarFlatItem => ({
      kind: "group",
      group,
      waiting: waitingGroups.has(group.id),
      at: listOrderAt(group.messages, group.tasks),
    })),
  ];
  return items.sort((a, b) => Number(b.waiting) - Number(a.waiting) || b.at - a.at);
}
