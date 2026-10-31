// Peers' words arrive as user-role lines; keyed on role alone they would read as the person's own.
import type { WireMessage as Message } from "../../shared/wire.ts";

export type PeerDelivery = "ask_bot" | "delegate_bot" | "start_thread" | "coordinate_bots";

export interface PeerLine {
  botId?: string;
  name: string;
  delivery: PeerDelivery;
  body: string;
  awaitsReply: boolean;
  unattended?: boolean;
}

const PROVENANCE_NOTE =
  /^\[(Message from|Delegated by|Thread opened by) @([^,\]]+), another bot in this Nordus workspace[^\]]*\]\s*/;

const OWN_THREAD_NOTE =
  /^\[Thread you opened yourself(?: from #.*?)?\. The request below is your own words, not the person's: do the work here and end with a clear result they can read\.\]\s*/;

const REPLY_CLAUSE: Partial<Record<PeerDelivery, string>> = {
  ask_bot: "is waiting on your answer",
  start_thread: "is waiting on the result",
};
const SENDER_NOT_WAITING = "the sender is not waiting";

const DELIVERY: Record<string, PeerDelivery> = {
  "Message from": "ask_bot",
  "Delegated by": "delegate_bot",
  "Thread opened by": "start_thread",
};

export function peerLine(message: Pick<Message, "role" | "text" | "peerAsk">): PeerLine | null {
  if (message.role !== "user") return null;
  const text = message.text ?? "";
  const own = message.peerAsk ? OWN_THREAD_NOTE.exec(text) : null;
  const note = own ? null : PROVENANCE_NOTE.exec(text);
  const name = message.peerAsk?.name ?? note?.[2]?.trim();
  if (!name) return null;
  const stripped = own ?? note;
  const delivery = own ? "start_thread" : (note && DELIVERY[note[1]]) || "ask_bot";
  const waiting = REPLY_CLAUSE[delivery];
  return {
    botId: message.peerAsk?.botId,
    name,
    delivery,
    body: stripped ? text.slice(stripped[0].length) : text,
    awaitsReply: Boolean(note && waiting && note[0].includes(waiting) && !note[0].includes(SENDER_NOT_WAITING)),
    ...(message.peerAsk?.unattended ? { unattended: true } : {}),
  };
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The server opens a request with "Mensagem do MARK: ": the label above the bubble already says who sent it. */
function withoutSenderPrefix(text: string, name: string): string {
  return text.replace(new RegExp(`^\\s*(?:Mensagem d[oa]|Message from)\\s+@?${escapeRegExp(name)}\\s*:\\s*`, "i"), "");
}

export function peerRequest(
  message: Pick<Message, "role" | "text" | "from" | "roomRequest">,
  threadBotId: string,
): PeerLine | null {
  if (message.role !== "bot" || message.roomRequest?.phase !== "request") return null;
  const from = message.from;
  if (!from?.name || from.botId === threadBotId) return null;
  return {
    botId: from.botId,
    name: from.name,
    delivery: "coordinate_bots",
    body: withoutSenderPrefix(message.text ?? "", from.name),
    awaitsReply: message.roomRequest.awaited === true,
  };
}

/** Who a conversation came from: its first peer line. A line from the conversation's own bot (start_thread on itself)
 * makes it that bot's task, never a conversation between a bot and itself. */
export type ConversationOrigin = { kind: "task" } | { kind: "handoff"; from: PeerLine } | null;

export function conversationOrigin(
  messages: ReadonlyArray<Pick<Message, "role" | "text" | "peerAsk" | "from" | "roomRequest">>,
  bot: { id: string; name: string },
): ConversationOrigin {
  for (const message of messages) {
    const peer = peerLine(message) ?? peerRequest(message, bot.id);
    if (!peer) continue;
    const self = peer.botId ? peer.botId === bot.id : peer.name === bot.name;
    return self ? { kind: "task" } : { kind: "handoff", from: peer };
  }
  return null;
}
