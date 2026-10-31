import type { Message } from "@/state/store";
import type { WireMessage } from "../../shared/wire";

/** Security: the file route opens an attachment only for the message that carries it, so a file shown in a later
 *  reply keeps naming that message in `sharedBy`. */
export type ShownAttachment = NonNullable<WireMessage["attachments"]>[number] & { sharedBy?: string };

function attachmentOnly(message: Message): boolean {
  return message.role !== "user" && message.kind === "text" && !message.text?.trim() && Boolean(message.attachments?.length);
}

/** Who said it, and from which task: a copy at home has no turn of its own, so its task stands in for one. */
function speaker(message: Message): string {
  return `${message.from?.botId ?? ""}:${message.fromTask?.threadId ?? ""}`;
}

function attachmentKey(attachment: ShownAttachment): string {
  return ("name" in attachment && attachment.name) || attachment.path;
}

function approves({ kind, widget }: Message): boolean {
  const root = widget?.root;
  return kind === "widget" && typeof root === "object" && root !== null && root.type === "Card" && Boolean(root.confirm || root.cancel);
}

const answeredBefore = (card: Message, reply: Message) => card.widget?.settled !== undefined && card.widget.settled.at <= reply.at;

const queue = (lists: Map<string, Message[]>, message: Message) => {
  lists.set(speaker(message), [...(lists.get(speaker(message)) ?? []), message]);
};

/** A turn reads as its reply with the files it is about, then the approval card. Files attached one by one are folded
 *  into the gallery of the reply that follows (a reply that carries as many files keeps its own: the engine copies them
 *  again under new paths), and an Aprovar/Ajustar card moves below that reply unless it was answered before the reply was
 *  written. Still working, the held files wait; with no reply, files and cards stay as they came. */
export function arrangeTurns(messages: readonly Message[], working: (botId: string | undefined) => boolean): Message[] {
  const held = new Map<string, Message[]>();
  const cards = new Map<string, Message[]>();
  const hidden = new Set<string>();
  const replaced = new Map<string, Message>();
  const after = new Map<string, Message[]>();
  for (const message of messages) {
    if (message.role === "user" && message.kind === "text") {
      held.clear();
      cards.clear();
      continue;
    }
    if (attachmentOnly(message)) {
      queue(held, message);
      continue;
    }
    if (approves(message)) {
      queue(cards, message);
      continue;
    }
    if (message.kind !== "text" || message.role === "user" || !message.text?.trim()) continue;
    const asked = (cards.get(speaker(message)) ?? []).filter((card) => !answeredBefore(card, message));
    cards.delete(speaker(message));
    if (asked.length) {
      for (const card of asked) hidden.add(card.id);
      after.set(message.id, asked);
    }
    const pending = held.get(speaker(message));
    if (!pending?.length) continue;
    held.delete(speaker(message));
    for (const early of pending) hidden.add(early.id);
    const own = message.attachments ?? [];
    const early = pending.flatMap((entry) => (entry.attachments ?? []).map((attachment) => ({ ...attachment, sharedBy: entry.id })));
    if (own.length >= early.length) continue;
    const seen = new Set(own.map(attachmentKey));
    const merged = [...own];
    for (const attachment of early) {
      const key = attachmentKey(attachment);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(attachment);
    }
    replaced.set(message.id, { ...message, attachments: merged });
  }
  for (const pending of held.values()) for (const early of pending) if (working(early.from?.botId)) hidden.add(early.id);
  if (hidden.size === 0 && replaced.size === 0) return messages as Message[];
  return messages.flatMap((message) => hidden.has(message.id) ? [] : [replaced.get(message.id) ?? message, ...after.get(message.id) ?? []]);
}

type MessageScope = { threadId: string; messageId: string };

export function sharingMessage(message: MessageScope, file?: { sharedBy?: string }): MessageScope;
export function sharingMessage(message: MessageScope | undefined, file?: { sharedBy?: string }): MessageScope | undefined;
export function sharingMessage(message: MessageScope | undefined, file?: { sharedBy?: string }): MessageScope | undefined {
  return message && file?.sharedBy ? { ...message, messageId: file.sharedBy } : message;
}
