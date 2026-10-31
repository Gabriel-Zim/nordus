import { presentSender, type OwnerProfile } from "../person-identity.ts";
import type { Message } from "../store.ts";

const MESSAGE_PAGE_MAX = 200;

/** undefined = absent, null = present but unusable (the caller answers 400). */
export function pageSize(raw: string | null): number | null | undefined {
  if (raw === null) return undefined;
  const size = Number(raw);
  if (!Number.isInteger(size) || size < 0) return null;
  return Math.min(size, MESSAGE_PAGE_MAX);
}

export function slimMessage(message: Message): Message | Record<string, unknown> {
  if (message.kind !== "screen" || !message.png) return message;
  const { png: _png, ...rest } = message;
  return { ...rest, hasImage: true };
}

/** The same message object unless its sender is the owner's paired device, which is shown as the owner. */
export function presentedMessage(message: Message, profile: OwnerProfile | null | undefined): Message {
  const sender = presentSender(message.sender, profile);
  return sender === message.sender ? message : { ...message, sender };
}

export function clientMessage(message: Message, profile: OwnerProfile | null | undefined): Message | Record<string, unknown> {
  return slimMessage(presentedMessage(message, profile));
}
