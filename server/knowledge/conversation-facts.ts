import type { ConversationFacts } from "./audience.ts";

/** What the rest of the server can say about a thread. Each answer is looked up when asked, so a room that changes client is followed at once. */
export interface ConversationSources {
  room: (threadId: string) => { client?: string; memberIds: readonly string[] } | undefined;
  bot: (threadId: string) => { id: string } | null | undefined;
  named: (threadId: string) => readonly string[] | undefined;
  inherited: (threadId: string) => readonly string[] | undefined;
}

export function conversationFacts(sources: ConversationSources, threadId: string): ConversationFacts {
  const room = sources.room(threadId);
  const bot = room ? undefined : sources.bot(threadId);
  return {
    ...(room?.client ? { roomClient: room.client } : {}),
    members: room ? [...room.memberIds] : bot ? [bot.id] : [],
    named: [...(sources.named(threadId) ?? [])],
    inherited: [...(sources.inherited(threadId) ?? [])],
  };
}
