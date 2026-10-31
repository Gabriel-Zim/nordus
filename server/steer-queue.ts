// Mid-turn sends wait here off the transcript (else they become the active leaf mid-turn) and survive Stop: stop-then-steer is the feature.

import { newId } from "./contracts.ts";
import { chatFollowups, rankChatFollowups, saveChatFollowup, settleChatFollowups } from "./message-db.ts";
import { drainCoalesceHead } from "./admission.ts";
import { spokenLineFields } from "./live-call-record.ts";
import { workOriginSchema, type WorkOrigin } from "./peer-provenance.ts";
import type { ResolvedSender, SteerQueueReason } from "../shared/wire.ts";
import type { BotRecord, Message } from "./store.ts";
import type { UsageTrigger } from "./usage-ledger.ts";

export interface SteerStore {
  bot(id: string): BotRecord | null;
  projectBotForTask?(botId: string, threadId: string): BotRecord | null;
  appendMessage(threadId: string, message: Omit<Message, "id" | "at">): Message;
  patchMessage(threadId: string, messageId: string, patch: Partial<Message>): Message | null;
}

interface QueueEntry {
  botId: string;
  items: Array<{
    messageId: string;
    text: string;
    prompt: string;
    replyToId?: string;
    sendId?: string;
    dataContext?: Message["dataContext"];
    reason?: SteerQueueReason;
    /** Queued by a bot running unattended: the drained turn inherits it (a queue is a delay, not a person at the keyboard). */
    unattended?: boolean;
    peerAsk?: Message["peerAsk"];
    origin?: WorkOrigin;
    sender?: ResolvedSender;
    trigger?: UsageTrigger;
    queuedAt: number;
    via?: "call";
    callId?: string;
    reaction?: string;
    /** Another part of the system wrote this line on a person's behalf (a board card): it is never read as the person's own word. */
    relayed?: boolean;
  }>;
}

export type SteerQueueHead = Pick<QueueEntry["items"][number], "trigger" | "sender" | "peerAsk" | "origin">;

const queues = new Map<string, QueueEntry>();

export interface HeldSteerQueue {
  botId: string;
  threadId: string;
  items: QueueEntry["items"];
}

export function restoreSteeredMessages(): void {
  queues.clear();
  const rows = chatFollowups("bot");
  const placed = rows.map((row, index) => ({ row, key: row.payload.rank ?? Number.MAX_SAFE_INTEGER, index }))
    .sort((a, b) => a.key - b.key || a.index - b.index)
    .map(({ row }) => row);
  for (const row of placed) {
    if (row.status !== "pending") continue;
    const entry = queues.get(row.threadId) ?? { botId: row.ownerId, items: [] };
    if (entry.botId !== row.ownerId) throw new Error("queued task belongs to another bot");
    const { via, callId, origin: storedOrigin, rank: _rank, ...payload } = row.payload;
    const origin = workOriginSchema.safeParse(storedOrigin);
    entry.items.push({
      ...payload,
      ...spokenLineFields(via, callId),
      ...(origin.success ? { origin: origin.data } : {}),
      messageId: row.id,
      prompt: row.payload.prompt ?? row.payload.text,
      queuedAt: row.payload.queuedAt ?? Date.now(),
    });
    queues.set(row.threadId, entry);
  }
}
const listeners = new Set<() => void>();
const changed = () => {
  for (const listener of listeners) {
    try { listener(); }
    catch { console.warn("steer-queue: change listener failed"); }
  }
};

/** Public pending chips only: never expose provider prompts or reply context. */
export function queuedSteerSnapshot(ownsThread: (botId: string, threadId: string) => boolean):
  Record<string, Array<{ queueId: string; text: string; reason?: SteerQueueReason }>> {
  return Object.fromEntries([...queues]
    .filter(([threadId, entry]) => ownsThread(entry.botId, threadId))
    .map(([threadId, entry]) => [threadId, entry.items.map((item) => ({
      queueId: item.messageId, text: item.text, ...(item.reason ? { reason: item.reason } : {}),
    }))]));
}

/** The lines still waiting to reach a thread's turn. */
export function queuedSteerItems(threadId: string): ReadonlyArray<Pick<QueueEntry["items"][number], "peerAsk" | "sender">> {
  return queues.get(threadId)?.items ?? [];
}

export function onSteeredQueueChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export interface QueuedSteer {
  id: string;
}

export function queueSteeredMessage(
  botId: string,
  threadId: string,
  text: string,
  options: { prompt?: string; replyToId?: string; sendId?: string; dataContext?: Message["dataContext"]; reason?: SteerQueueReason; unattended?: boolean; peerAsk?: Message["peerAsk"]; origin?: WorkOrigin; sender?: ResolvedSender; trigger?: UsageTrigger; callId?: string; via?: "call"; reaction?: string; relayed?: boolean } = {},
): QueuedSteer {
  const id = newId();
  const entry = queues.get(threadId) ?? { botId, items: [] };
  if (entry.botId !== botId) throw new Error("queued task belongs to another bot");
  const item = {
    messageId: id,
    text,
    prompt: options.prompt ?? text,
    replyToId: options.replyToId,
    sendId: options.sendId,
    dataContext: options.dataContext,
    reason: options.reason,
    unattended: options.unattended,
    peerAsk: options.peerAsk,
    ...(options.origin ? { origin: options.origin } : {}),
    sender: options.sender,
    trigger: options.trigger,
    queuedAt: Date.now(),
    ...spokenLineFields(options.via, options.callId),
    ...(options.reaction ? { reaction: options.reaction } : {}),
    ...(options.relayed ? { relayed: true } : {}),
  };
  saveChatFollowup({ id, kind: "bot", ownerId: botId, threadId, payload: item });
  entry.items.push(item);
  queues.set(threadId, entry);
  changed();
  return { id };
}

export function queuedThreadPosition(botId: string, threadId: string): number | null {
  let position = 0;
  for (const [candidate, entry] of queues) {
    if (entry.botId !== botId || !entry.items.some((item) => item.reason === "capacity" || item.reason === "group-turn")) continue;
    position += 1;
    if (candidate === threadId) return position;
  }
  return null;
}

export function hasQueuedSteeredMessages(botId: string, threadId: string): boolean {
  const entry = queues.get(threadId);
  return entry?.botId === botId && entry.items.length > 0;
}

export function isSteeredMessageQueued(botId: string, threadId: string, queueId: string): boolean {
  const entry = queues.get(threadId);
  return entry?.botId === botId && entry.items.some((item) => item.messageId === queueId);
}

/** Entries leave the map before running, so racing settles never fire one queue twice; one coalesced group drains per settle. */
export function drainSteeredMessages(
  store: SteerStore,
  run: (
    botId: string,
    threadId: string,
    prompt: string,
    userMessage: Message,
    excludeIds: string[],
    unattended: boolean,
    head: SteerQueueHead,
  ) => void | Promise<void>,
  isBlocked?: (botId: string, threadId: string, head: SteerQueueHead) => boolean,
): void {
  // deleting only the entry being visited is safe under Map iteration
  for (const [threadId, entry] of queues) {
    const bot = store.projectBotForTask
      ? store.projectBotForTask(entry.botId, threadId)
      : store.bot(entry.botId);
    if (!bot) {
      settleChatFollowups(entry.items.map((item) => item.messageId), "cancelled");
      queues.delete(threadId);
      changed();
      continue;
    }
    if (bot.busy || isBlocked?.(entry.botId, threadId, entry.items[0])) continue;
    // isBlocked can re-enter this drain; if a nested drain took this entry, it is stale.
    if (queues.get(threadId) !== entry) continue;
    const group = drainCoalesceHead(entry.items, coalesceIdentity, (item) => item.queuedAt);
    const ids = group.map((item) => item.messageId);
    settleChatFollowups(ids, "dispatching");
    const rest = entry.items.slice(group.length);
    if (rest.length > 0) queues.set(threadId, { botId: entry.botId, items: rest });
    else queues.delete(threadId);
    changed();
    const appended: Message[] = [];
    for (const item of group) {
      appended.push(
        store.appendMessage(threadId, {
          role: "user",
          kind: "text",
          text: item.text,
          replyToId: item.replyToId,
          sendId: item.sendId,
          ...(item.dataContext ? { dataContext: item.dataContext } : {}),
          queueId: item.messageId,
          peerAsk: item.peerAsk,
          sender: item.sender,
          ...spokenLineFields(item.via, item.callId),
          ...(item.reaction ? { reaction: item.reaction } : {}),
          ...(item.relayed ? { relayed: true } : {}),
        }),
      );
    }
    const last = appended.at(-1);
    if (!last) continue;
    // A blank line keeps each message its own Markdown block; otherwise a trailing attachment tag merges into the next and stops being an image.
    const prompt = group.map((item) => item.prompt).join("\n\n");
    const running = run(
      entry.botId,
      threadId,
      prompt,
      last,
      appended.map((message) => message.id),
      // One unattended line makes the turn unattended: a person's words in the group cannot re-attend a bot's own.
      group.some((item) => item.unattended === true),
      { trigger: group[0].trigger, sender: group[0].sender, peerAsk: group[0].peerAsk, origin: group[0].origin },
    );
    void Promise.resolve(running).then(
      () => settleChatFollowups(ids, null),
      () => settleChatFollowups(ids, "interrupted"),
    ).catch((error) => console.warn("steer-queue: could not settle durable follow-up", error));
  }
}

/** Who sent it, provenance included: a bot's own work never merges with a person's texts, nor a spoken line with a typed one. */
function coalesceIdentity(item: QueueEntry["items"][number]): string {
  if (item.peerAsk?.incident) return "incident";
  if (item.peerAsk?.teamRequest) return "team-request";
  if (item.peerAsk) return `peer:${item.peerAsk.botId}:${item.unattended === true ? "unattended" : "attended"}:${JSON.stringify(item.origin ?? null)}`;
  if (item.unattended === true) return "unattended";
  const person = item.sender ? `person:${item.sender.id ?? item.sender.name}` : "person:local";
  if (item.relayed) return `relayed:${person}`;
  return item.via === "call" ? `call:${item.callId ?? ""}|${person}` : person;
}

export function queuedSteeredMessage(
  botId: string,
  threadId: string,
  sendId: string,
): { id: string; text: string; replyToId?: string; reason?: SteerQueueReason } | null {
  const entry = queues.get(threadId);
  if (!entry || entry.botId !== botId) return null;
  const item = entry.items.find((candidate) => candidate.sendId === sendId);
  return item ? { id: item.messageId, text: item.text, replyToId: item.replyToId, ...(item.reason ? { reason: item.reason } : {}) } : null;
}

export function cancelSteeredMessage(botId: string, messageId: string, expectedThreadId?: string): boolean {
  for (const [threadId, entry] of queues) {
    if (entry.botId !== botId || (expectedThreadId !== undefined && threadId !== expectedThreadId)) continue;
    const items = entry.items.filter((item) => item.messageId !== messageId);
    if (items.length === entry.items.length) continue;
    settleChatFollowups([messageId], "cancelled");
    if (items.length === 0) queues.delete(threadId);
    else queues.set(threadId, { botId: entry.botId, items });
    changed();
    return true;
  }
  return false;
}

/** The entry leaves first, so a racing settle cannot also dispatch these words; the caller must restore or settle it. */
export function holdSteeredQueue(botId: string, threadId: string, queueId: string): HeldSteerQueue | null {
  const entry = queues.get(threadId);
  if (!entry || entry.botId !== botId || !entry.items.some((item) => item.messageId === queueId)) return null;
  queues.delete(threadId);
  changed();
  return { botId, threadId, items: entry.items };
}

export function restoreHeldSteeredQueue(held: HeldSteerQueue): void {
  const existing = queues.get(held.threadId);
  if (existing && existing.botId !== held.botId) throw new Error("queued task belongs to another bot");
  queues.set(held.threadId, {
    botId: held.botId,
    items: existing ? [...held.items, ...existing.items] : held.items,
  });
  changed();
}

export function settleHeldSteeredQueue(held: HeldSteerQueue): void {
  settleChatFollowups(held.items.map((item) => item.messageId), null);
}

export function _queuedCount(threadId: string): number {
  return queues.get(threadId)?.items.length ?? 0;
}

export interface BotQueueItem {
  queueId: string;
  threadId: string;
  text: string;
  queuedAt: number;
  from: { kind: "person"; name?: string } | { kind: "bot"; name: string } | { kind: "routine"; name?: string };
  reason?: SteerQueueReason;
}

/** One bot's waiting work across its conversations, in the order the queue drains it. No prompt or reply context. */
export function botQueue(botId: string): BotQueueItem[] {
  const out: BotQueueItem[] = [];
  for (const [threadId, entry] of queues) {
    if (entry.botId !== botId) continue;
    for (const item of entry.items) {
      const from: BotQueueItem["from"] = item.peerAsk
        ? { kind: "bot", name: item.peerAsk.name }
        : item.trigger?.kind === "routine"
          ? { kind: "routine", ...(item.trigger.label ? { name: item.trigger.label } : {}) }
          : { kind: "person", ...(item.sender?.name ? { name: item.sender.name } : {}) };
      out.push({
        queueId: item.messageId,
        threadId,
        text: item.text.replace(/\s+/g, " ").trim().slice(0, 160),
        queuedAt: item.queuedAt,
        from,
        ...(item.reason ? { reason: item.reason } : {}),
      });
    }
  }
  return out;
}

/** Puts a bot's waiting work in the order the person dragged it to. Items keep to their own conversation (a turn runs in its
 *  thread); the conversations drain in the order of their first item, and within one the items follow the new order.
 *  Other bots' queues keep their places. Returns false when the ids are not exactly this bot's queue. */
export function reorderBotQueue(botId: string, orderedIds: readonly string[]): boolean {
  const current = botQueue(botId);
  if (current.length !== orderedIds.length || new Set(orderedIds).size !== orderedIds.length) return false;
  const threadOf = new Map(current.map((item) => [item.queueId, item.threadId]));
  if (orderedIds.some((id) => !threadOf.has(id))) return false;
  const threadOrder: string[] = [];
  for (const id of orderedIds) {
    const threadId = threadOf.get(id)!;
    if (!threadOrder.includes(threadId)) threadOrder.push(threadId);
  }
  const rank = new Map(orderedIds.map((id, index) => [id, index]));
  const reordered = threadOrder.map((threadId): [string, QueueEntry] => {
    const entry = queues.get(threadId)!;
    return [threadId, { botId, items: [...entry.items].sort((a, b) => rank.get(a.messageId)! - rank.get(b.messageId)!) }];
  });
  const rebuilt: Array<[string, QueueEntry]> = [];
  let placed = false;
  for (const [threadId, entry] of queues) {
    if (entry.botId !== botId) {
      rebuilt.push([threadId, entry]);
      continue;
    }
    if (!placed) {
      rebuilt.push(...reordered);
      placed = true;
    }
  }
  queues.clear();
  for (const [threadId, entry] of rebuilt) queues.set(threadId, entry);
  rankChatFollowups(botQueue(botId).map((item, index) => [item.queueId, index] as const));
  changed();
  return true;
}

/** The conversation a waiting item belongs to, so its cancel can reopen what waited on it there. */
export function botQueueItemThread(botId: string, queueId: string): string | null {
  for (const [threadId, entry] of queues) {
    if (entry.botId === botId && entry.items.some((item) => item.messageId === queueId)) return threadId;
  }
  return null;
}
