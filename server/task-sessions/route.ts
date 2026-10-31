import type { TaskRecord } from "../store.ts";

export type DeskRoute = { action: "new-task" } | { action: "continue"; taskThreadId: string };

/** Where a message written in the desk goes: back into a task, or into a new one. */
export function routeDeskMessage(input: {
  thread: { desk?: TaskRecord["desk"] } | null;
  threadId: string;
  replyTo?: { threadRef?: { threadId: string } };
  taskExists: (threadId: string) => boolean;
}): DeskRoute {
  if (input.thread?.desk) return { action: "continue", taskThreadId: input.threadId };
  const ref = input.replyTo?.threadRef?.threadId;
  if (ref && input.taskExists(ref)) return { action: "continue", taskThreadId: ref };
  return { action: "new-task" };
}
