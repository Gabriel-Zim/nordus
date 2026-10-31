import type { NotificationLogEntry, NotificationSettlement, NotifyKind } from "../shared/notification.ts";
import type { StoreChange } from "./store.ts";

/** The person wrote in the conversation: an answer, or a retry of what stopped. */
const SETTLED_BY_REPLY: readonly NotifyKind[] = ["question", "turn-failed", "routine-failed", "routine-deferred", "incident"];
/** The bot is writing again, so what stopped it is behind it. */
const SETTLED_BY_PROGRESS: readonly NotifyKind[] = ["turn-failed", "routine-failed", "routine-deferred", "incident"];

export function notificationSettlement(change: StoreChange): NotificationSettlement | null {
  if (change.type === "message.patch") {
    const card = change.message.card;
    return card?.requestId && (card.answered || card.dismissed || card.expired) ? { requestId: card.requestId } : null;
  }
  if (change.type !== "message") return null;
  const message = change.message;
  if (message.role === "user") {
    return message.peerAsk || message.relayed || message.from ? null : { threadId: change.threadId, kinds: SETTLED_BY_REPLY };
  }
  if (message.role === "bot" && message.kind === "text") {
    return { threadId: change.threadId, kinds: SETTLED_BY_PROGRESS, ...(message.from ? { botId: message.from.botId } : {}) };
  }
  return null;
}

/** Whether a settlement covers an entry: for a notification logged after the change that should have settled it. */
export function settles(settlement: NotificationSettlement, entry: Pick<NotificationLogEntry, "threadId" | "kind" | "botId" | "requestId">): boolean {
  if ("requestId" in settlement) return entry.requestId === settlement.requestId;
  return entry.requestId === undefined && entry.threadId === settlement.threadId && settlement.kinds.includes(entry.kind) &&
    (settlement.botId === undefined || settlement.botId === entry.botId);
}
