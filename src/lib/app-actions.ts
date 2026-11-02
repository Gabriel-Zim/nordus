import type { Action, AppState } from "@/state/store";
import { roomThreadWorking } from "./room-threads";

type Selection = Pick<AppState, "bots" | "groups" | "selectedId">;

export function newConversationAction(state: Selection): Action | null {
  const group = state.groups.find((entry) => entry.id === state.selectedId);
  if (group) return group.dm ? null : { type: "newGroupTask", groupId: group.id };
  const bot = state.bots.find((entry) => entry.id === state.selectedId);
  return bot ? { type: "newTask", botId: bot.id } : null;
}

export type RunningWork =
  | { kind: "bot"; botId: string; threadId: string }
  | { kind: "group"; groupId: string; threadId: string };

/** A turn that waits on the person is not running: stopping it would throw away the question it asked. */
export function runningWork(state: Pick<AppState, "bots" | "groups">): RunningWork[] {
  const work: RunningWork[] = [];
  for (const bot of state.bots) {
    const tasks = bot.tasks ?? [{ threadId: bot.threadId, busy: bot.busy, activity: bot.activity }];
    for (const task of tasks) {
      if (task.activity === "waiting-on-you") continue;
      if (task.busy || task.activity === "working") work.push({ kind: "bot", botId: bot.id, threadId: task.threadId });
    }
  }
  for (const group of state.groups) {
    const threadIds = new Set([group.threadId, ...(group.tasks ?? []).map((task) => task.threadId)]);
    for (const threadId of threadIds) {
      if (roomThreadWorking(group, threadId)) work.push({ kind: "group", groupId: group.id, threadId });
    }
  }
  return work;
}

export function stopWorkActions(work: readonly RunningWork[]): Action[] {
  return work.map((entry) => entry.kind === "bot"
    ? { type: "interrupt", botId: entry.botId, threadId: entry.threadId }
    : { type: "interruptGroup", groupId: entry.groupId, threadId: entry.threadId });
}
