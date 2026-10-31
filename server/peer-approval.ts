// Harness-native approval cards for peer comms (approvePeerComms), resolved before an answer reaches the provider adapter.

import { newId } from "./contracts.ts";
import { optionCardsForTools } from "./message-db.ts";
import { buildNotification, type Notification } from "./notify.ts";
import { peerAllowKey, type PeerAction } from "./peer-approval-key.ts";
import type { BotRecord, Message, Store } from "./store.ts";

export { peerAllowKey } from "./peer-approval-key.ts";

/** Only allow authorizes work; absence of an answer is not a user decision. */
export type PeerApprovalOutcome = "allow" | "deny" | "expired" | "cancelled";
export type PeerApprovalFailure = Exclude<PeerApprovalOutcome, "allow">;

export function peerApprovalFailure(outcome: PeerApprovalFailure): {
  error: string;
  approvalOutcome: PeerApprovalFailure;
  approvalSource: "user" | "system";
} {
  return {
    error: outcome === "deny" ? "denied by user"
      : outcome === "expired" ? "the approval card expired without an answer"
        : "the approval was cancelled before a decision",
    approvalOutcome: outcome,
    approvalSource: outcome === "deny" ? "user" : "system",
  };
}

export interface ApprovalBus {
  store: Store;
  broadcast: (payload: Record<string, unknown>) => void;
  notify?: (notification: Notification | null) => void;
  autoApply?: (botId: string, threadId: string) => boolean;
  /** A task is about to stop on the person (the desk tells them); called before the waiting mark is set. */
  questionAsked?: (threadId: string, summary?: string) => void;
  onPeerApprovalPending?: (from: BotRecord, target: PeerApprovalTarget, action: PeerAction, sourceThreadId: string, message: string) => void;
  /** The person's conversation above a conversation between bots, where the card goes instead. */
  personHome?: (botId: string, threadId: string) => string | undefined;
}

interface Pending {
  resolve: (result: PeerApprovalOutcome) => void;
  timer: ReturnType<typeof setTimeout>;
  fromBotId: string;
  toBotId: string;
  message: string;
  threadId: string;
  messageId: string;
  bus: ApprovalBus;
}

function settleCard(pending: Pending, behavior: string, source: "user" | "system"): void {
  const existing = pending.bus.store
    .messagesFor(pending.threadId)
    .find((m) => m.id === pending.messageId);
  if (!existing?.card || existing.card.answered) return;
  pending.bus.store.patchMessage(pending.threadId, pending.messageId, {
    card: { ...existing.card, answered: behavior, dismissed: source !== "user" },
  });
  const store = pending.bus.store;
  const task = store.projectBotForTask(pending.fromBotId, pending.threadId);
  if (task) {
    if (task.activity === "waiting-on-you") store.setTaskActivity(task.id, pending.threadId, "working");
  } else if (store.groupByThread(pending.threadId)) {
    const waiting = store.bot(pending.fromBotId);
    if (waiting?.activity === "waiting-on-you") store.setActivity(waiting.id, "working");
  }
}

const pendingComms = new Map<string, Pending>();

const APPROVAL_TIMEOUT_MS = 15 * 60_000;
const PEER_TOOLS: readonly PeerAction[] = ["ask_bot", "delegate_bot", "post_to_room"];

function allowKeyAllowed(from: BotRecord, allowKey: string): boolean {
  return from.alwaysAllow?.includes(allowKey) ?? false;
}

export interface PeerApprovalTarget {
  id: string;
  name: string;
}


function pushApprovalCard(
  bus: ApprovalBus,
  from: BotRecord,
  target: PeerApprovalTarget,
  message: string,
  action: PeerAction,
  requestId: string,
  cardThreadId: string,
  away: boolean,
): Message {
  const subtitle = message.length > 200 ? `${message.slice(0, 200)}…` : message;
  const intent = peerActionText(action, target);
  return bus.store.appendMessage(cardThreadId, {
    role: "bot",
    kind: "options",
    card: {
      title: `${from.name} quer ${intent}`,
      subtitle,
      options: ["Allow", "Deny", "Always allow"],
      requestId,
      tool: action,
      intent,
      ...(away ? { explanation: `${from.name} quer ${intent}: "${subtitle}"` } : {}),
      allowKey: peerAllowKey(action, target.id),
    },
  });
}

/** What the banner asks the person to authorize, in the app's words. */
function peerActionText(action: PeerAction, target: PeerApprovalTarget): string {
  return action === "post_to_room" ? `postar em “${target.name}”` : action === "delegate_bot" ? `passar uma tarefa para @${target.name}` : `falar com @${target.name}`;
}

function announceCard(bus: ApprovalBus, from: BotRecord, card: Message, sourceThreadId: string, action: string): void {
  const task = bus.store.projectBotForTask(from.id, sourceThreadId);
  const room = bus.store.groupByThread(sourceThreadId);
  if (task) {
    if (task.busy) {
      // Order matters: questionAsked reads the waiting mark, so it must run before the mark is set.
      bus.questionAsked?.(sourceThreadId, card.card?.subtitle);
      bus.store.setTaskActivity(from.id, sourceThreadId, "waiting-on-you");
    }
  } else if (room && bus.store.bot(from.id)?.busy) {
    bus.store.setActivity(from.id, "waiting-on-you");
  }
  const group = room && !room.dm ? { id: room.id, name: room.name } : undefined;
  const asks = `@${from.name} quer ${action}`;
  const detail = card.card?.subtitle ? `${asks}: ${card.card.subtitle}` : asks;
  bus.notify?.(buildNotification("approval", from, sourceThreadId, detail, { avatarUrl: from.avatarUrl, group, requestId: card.card?.requestId, action }));
}

export function requestPeerApproval(
  bus: ApprovalBus,
  from: BotRecord,
  target: PeerApprovalTarget,
  message: string,
  action: PeerAction,
  sourceThreadId = from.threadId,
): Promise<PeerApprovalOutcome> {
  if (bus.autoApply?.(from.id, sourceThreadId) || allowKeyAllowed(from, peerAllowKey(action, target.id))) {
    return Promise.resolve("allow");
  }
  return new Promise((resolve) => {
    const requestId = newId();
    // The card must exist before the entry, so a timeout or an answer can always settle it.
    // Never inside a conversation between bots: the person answers in their own conversation above it.
    const cardThreadId = bus.personHome?.(from.id, sourceThreadId) ?? sourceThreadId;
    const card = pushApprovalCard(bus, from, target, message, action, requestId, cardThreadId, cardThreadId !== sourceThreadId);
    announceCard(bus, from, card, cardThreadId, peerActionText(action, target));
    const timer = setTimeout(() => {
      const pending = pendingComms.get(requestId);
      if (!pending) return;
      pendingComms.delete(requestId);
      settleCard(pending, "deny", "system");
      resolve("expired");
    }, APPROVAL_TIMEOUT_MS);
    timer.unref?.();
    pendingComms.set(requestId, {
      resolve,
      timer,
      fromBotId: from.id,
      toBotId: target.id,
      message,
      threadId: cardThreadId,
      messageId: card.id,
      bus,
    });
    try {
      bus.onPeerApprovalPending?.(from, target, action, sourceThreadId, message);
    } catch (error) {
      console.warn(`peer approval ${requestId}: pending hook failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
}

/** Call before forwarding an answer to the provider adapter; true when it settled a peer approval. */
export function resolvePeerComms(
  _bus: ApprovalBus,
  requestId: string,
  behavior: string | undefined,
): boolean {
  const pending = pendingComms.get(requestId);
  if (!pending) return false;
  pendingComms.delete(requestId);
  clearTimeout(pending.timer);
  const allow = behavior === "allow";
  settleCard(pending, allow ? "allow" : "deny", "user");
  pending.resolve(allow ? "allow" : "deny");
  return true;
}

export function cancelPeerApprovalsFor(botId: string): void {
  for (const [requestId, pending] of Array.from(pendingComms)) {
    if (pending.fromBotId !== botId && pending.toBotId !== botId) continue;
    pendingComms.delete(requestId);
    clearTimeout(pending.timer);
    settleCard(pending, "deny", "system");
    pending.resolve("cancelled");
  }
}

export function cancelPeerApprovalsForThread(threadId: string): void {
  for (const [requestId, pending] of pendingComms) {
    if (pending.threadId !== threadId) continue;
    pendingComms.delete(requestId);
    clearTimeout(pending.timer);
    settleCard(pending, "deny", "system");
    pending.resolve("cancelled");
  }
}

function peerCardThreads(bus: ApprovalBus): Set<string> {
  const threadIds = new Set<string>();
  for (const bot of bus.store.bots) {
    threadIds.add(bot.threadId);
    for (const task of bot.tasks ?? []) threadIds.add(task.threadId);
  }
  for (const group of bus.store.groups) {
    threadIds.add(group.threadId);
    for (const task of group.tasks ?? []) threadIds.add(task.threadId);
  }
  return threadIds;
}

export function dismissStalePeerCards(bus: ApprovalBus): number {
  let dismissed = 0;
  const threads = peerCardThreads(bus);
  for (const { threadId, messageId } of optionCardsForTools(PEER_TOOLS)) {
    if (!threads.has(threadId)) continue;
    const card = bus.store.messagesFor(threadId).find((message) => message.id === messageId)?.card;
    if (!card?.requestId || card.answered || card.dismissed) continue;
    if (pendingComms.has(card.requestId)) continue;
    const patched = bus.store.patchMessage(threadId, messageId, {
      card: { ...card, answered: "deny", dismissed: true },
    });
    if (patched) dismissed += 1;
  }
  return dismissed;
}
