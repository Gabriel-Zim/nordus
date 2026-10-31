import type { WireMessage as Message } from "../../shared/wire.ts";
import { failedTurnCause } from "../../shared/failed-turn.ts";
import { isStoppedTurnName } from "../../shared/client-cancel.ts";
import { peerLine, peerRequest, type PeerLine } from "./peer-message";
import { hasNeedsInputLine } from "./visible-bot-text";

function carriesReplies(message: Message): boolean {
  if (message.role !== "bot" || message.from || message.roomRequest) return false;
  if (message.attachments?.length) return false;
  if (message.kind === "text") return !hasNeedsInputLine(message.text ?? "");
  if (message.kind !== "activity" || !message.tool) return false;
  if (message.comm || message.threadRef || message.dataResult) return false;
  const name = message.tool.name;
  if (isStoppedTurnName(name) || name.startsWith("recovery:") || name.startsWith("notice:")) return false;
  return failedTurnCause(name) === null;
}

function ownPeer(line: PeerLine, botId: string, botName?: string): boolean {
  return line.botId ? line.botId === botId : botName !== undefined && line.name === botName;
}

function opensPeerTurn(message: Message, botId: string): boolean {
  return peerLine(message) !== null || peerRequest(message, botId) !== null;
}

function closesPeerTurn(message: Message, botId: string): boolean {
  return message.role === "user" || opensPeerTurn(message, botId);
}

function groupEnd<T extends Message>(messages: readonly T[], start: number, botId: string): number {
  let end = start + 1;
  while (end < messages.length && !closesPeerTurn(messages[end]!, botId)) end++;
  return end;
}

function repliesByRequest<T extends Message>(messages: readonly T[], start: number, end: number, requestId: string): T[] {
  const replies: T[] = [];
  for (let index = start; index < end; index++) {
    const message = messages[index]!;
    if (carriesReplies(message) && message.requestMessageId === requestId) replies.push(message);
  }
  return replies;
}

function repliesByTurn<T extends Message>(messages: readonly T[], start: number, end: number, requestId: string): T[] {
  let turnId: string | undefined;
  for (let index = start; index < end; index++) {
    const message = messages[index]!;
    if (!carriesReplies(message) || !message.turnId) continue;
    if (message.requestMessageId && message.requestMessageId !== requestId) return [];
    turnId = message.turnId;
    break;
  }
  if (!turnId || messages.slice(0, start).some((message) => message.turnId === turnId)) return [];
  const replies: T[] = [];
  for (let index = start; index < end; index++) {
    const message = messages[index]!;
    if (!carriesReplies(message) || message.turnId !== turnId) continue;
    if (message.requestMessageId && message.requestMessageId !== requestId) continue;
    replies.push(message);
  }
  return replies;
}

export function peerReplyGroups<T extends Message>(messages: readonly T[], botId: string, botName?: string): ReadonlyMap<string, readonly T[]> {
  const groups = new Map<string, readonly T[]>();
  for (let index = 0; index < messages.length; index++) {
    const opening = messages[index]!;
    if (opening.peerAsk?.incident) continue;
    const line = peerLine(opening);
    if (line && ownPeer(line, botId, botName)) continue;
    if (line?.awaitsReply) {
      const replies = repliesByRequest(messages, index + 1, groupEnd(messages, index, botId), opening.id);
      if (replies.length) groups.set(opening.id, replies);
      continue;
    }
    if (line) continue;
    const request = peerRequest(opening, botId);
    if (!request?.awaitsReply) continue;
    const replies = repliesByTurn(messages, index + 1, groupEnd(messages, index, botId), opening.id);
    if (replies.length) groups.set(opening.id, replies);
  }
  return groups;
}
