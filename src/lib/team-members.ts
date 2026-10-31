import { teamOf } from "../../shared/team-lead";
import type { Bot } from "@/state/store";
import { botShowsUnread } from "./bot-unread";
import { waitingTaskFor } from "./waiting-approval";
import { botStepNow, taskStepNow, whoIsDoing } from "./work-steps";
import { t } from "./i18n";
import { taskPlace } from "../../shared/team-work";

function leaderOfEachTeam(bots: readonly Bot[]): Map<string, Bot | null> {
  const leaders = new Map<string, Bot | null>();
  for (const bot of bots) {
    const team = teamOf(bot.section);
    if (bot.hidden || !bot.teamLead || !team) continue;
    leaders.set(team, leaders.has(team) ? null : bot);
  }
  return leaders;
}

export interface MemberNeedingPerson {
  member: Bot;
  threadId: string;
}

export function waitingThreadOf(bot: Bot): string | undefined {
  const taskWaits = Boolean(bot.tasks?.some((task) => task.activity === "waiting-on-you"));
  return waitingTaskFor(bot)?.threadId ?? (bot.activity === "waiting-on-you" && !taskWaits ? bot.threadId : undefined);
}

export function memberNeedingPerson(bots: readonly Bot[], leader: Bot, openBotId?: string): MemberNeedingPerson | undefined {
  if (waitingThreadOf(leader)) return undefined;
  for (const member of membersOf(bots, leader)) {
    const threadId = member.id === openBotId ? undefined : waitingThreadOf(member);
    if (threadId) return { member, threadId };
  }
  return undefined;
}

export interface BotWait {
  waiting: boolean;
  waitingBot: Bot;
  waitingThreadId?: string;
  teamWork?: string;
  teamWorkWhere?: string;
  teamWorkOthers?: number;
}

function taskWorks(task: { busy?: boolean; activity?: string }): boolean {
  return task.activity !== "waiting-on-you" && (Boolean(task.busy) || task.activity === "working");
}

function works(bot: Bot): boolean {
  if (bot.tasks?.length) return bot.tasks.some(taskWorks);
  return taskWorks(bot);
}

function memberWork(member: Bot, bots: readonly Bot[], rooms: Parameters<typeof botStepNow>[1]): { short: string; where: string; at: number } {
  const task = member.tasks?.find(taskWorks);
  const step = (task && taskStepNow(task)) ?? botStepNow(member, rooms) ?? t("chat.activity.working");
  const place = task && taskPlace(task, bots);
  return {
    short: whoIsDoing(member.name, step),
    where: whoIsDoing(place ? `${member.name} · ${place}` : member.name, step),
    at: task ? Math.max(task.turnStartedAt ?? 0, task.steps?.at(-1)?.at ?? 0, task.updatedAt ?? 0) : 0,
  };
}

export function botWait(bots: readonly Bot[], bot: Bot, openBotId?: string, rooms: Parameters<typeof botStepNow>[1] = []): BotWait {
  const teamWait = bot.teamLead ? memberNeedingPerson(bots, bot, openBotId) : undefined;
  if (teamWait) return { waiting: true, waitingBot: teamWait.member, waitingThreadId: teamWait.threadId };
  const waiting = bot.activity === "waiting-on-you" || Boolean(bot.tasks?.some((task) => task.activity === "waiting-on-you"));
  const workers = !waiting && bot.teamLead
    ? membersOf(bots, bot).filter((member) => member.id !== openBotId && works(member)).map((member) => memberWork(member, bots, rooms)).sort((a, b) => b.at - a.at)
    : [];
  return { waiting, waitingBot: bot, waitingThreadId: waitingTaskFor(bot)?.threadId ?? (waiting ? bot.threadId : undefined),
    ...(workers[0] ? { teamWork: workers[0].short, teamWorkWhere: workers[0].where, teamWorkOthers: workers.length - 1 } : {}) };
}

export function attentionForPerson<T extends { botId?: string; task: { activity?: string } }>(
  entries: readonly T[], bots: readonly Bot[], openBotId?: string,
): T[] {
  const led = ledMemberIds(bots, openBotId);
  return entries.filter((entry) => !entry.botId || !led.has(entry.botId) || entry.task.activity === "waiting-on-you");
}

export function leadersWithWaitingMember(bots: readonly Bot[], openBotId?: string): ReadonlySet<string> {
  return new Set(bots.filter((bot) => bot.teamLead && memberNeedingPerson(bots, bot, openBotId)).map((bot) => bot.id));
}

export function appUnreadCount(bots: readonly Bot[], groups: readonly { unread?: boolean }[]): number {
  const led = ledMemberIds(bots);
  return bots.filter((bot) => !bot.hidden && botShowsUnread(bot) && (!led.has(bot.id) || Boolean(waitingThreadOf(bot)))).length
    + groups.filter((group) => group.unread).length;
}

export function ledMemberIds(bots: readonly Bot[], openBotId?: string): ReadonlySet<string> {
  const leaders = leaderOfEachTeam(bots);
  const led = new Set<string>();
  for (const bot of bots) {
    const leader = leaders.get(teamOf(bot.section));
    if (leader && leader.id !== bot.id && bot.id !== openBotId && !bot.hidden) led.add(bot.id);
  }
  return led;
}

export function membersOf(bots: readonly Bot[], leader: Bot): Bot[] {
  const team = teamOf(leader.section);
  if (leaderOfEachTeam(bots).get(team)?.id !== leader.id) return [];
  return bots.filter((bot) => !bot.hidden && bot.id !== leader.id && teamOf(bot.section) === team);
}

export function listedBots(bots: readonly Bot[], openBotId?: string): Bot[] {
  const led = ledMemberIds(bots, openBotId);
  return bots.filter((bot) => !bot.hidden && !led.has(bot.id));
}

export function botForShortcut(bots: readonly Bot[], openBotId: string, key: string): Bot | undefined {
  if (/^[1-9]$/.test(key)) return listedBots(bots)[Number(key) - 1];
  const around = listedBots(bots, openBotId);
  const index = around.findIndex((bot) => bot.id === openBotId);
  return around[(index + (key === "]" ? 1 : -1) + around.length) % around.length];
}
