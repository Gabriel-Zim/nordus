import type { Task } from "@/state/store";

/** The slice of a task that decides whether it waits on the person. */
export type WaitingTaskShape = Pick<Task, "threadId" | "activity" | "routineRunId" | "updatedAt" | "createdAt">;

const stamp = (task: Pick<Task, "updatedAt" | "createdAt">) => task.updatedAt ?? task.createdAt ?? 0;

/**
 * The task of this bot that is waiting on the person (activity "waiting-on-you"), or undefined when none is.
 * A task in another thread than `currentThreadId` comes first, because that is the approval the open conversation
 * does not show; among equals the most recently updated wins, then the order the bot lists them in.
 * A routine run's own conversation never counts, as in the sidebar. When the only waiting task is the current one,
 * that task is returned, so the caller can tell "nothing waits" from "it is right here".
 */
export function waitingTaskFor<T extends WaitingTaskShape>(bot: { tasks?: readonly T[] }, currentThreadId?: string): T | undefined {
  const waiting = (bot.tasks ?? []).filter((task) => task.activity === "waiting-on-you" && !task.routineRunId);
  const elsewhere = waiting.filter((task) => task.threadId !== currentThreadId);
  const pool = elsewhere.length ? elsewhere : waiting;
  return pool.reduce<T | undefined>((best, task) => (best && stamp(best) >= stamp(task) ? best : task), undefined);
}
