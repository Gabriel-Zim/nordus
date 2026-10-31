// Nordus: every card that waits on a person, across bots, tasks and rooms, kept current from the store's own changes.
import {
  approvalCopy, approvalDeadline, approvalId, approvalRisk, decidedInList, waitingKind,
  type ApprovalItem, type ApprovalKind,
} from "../shared/approvals.ts";
import { deciderName, mayDecide, ownerOf, type Decider } from "./approval-decider.ts";
import type { Message, StoreChange } from "./store.ts";

export interface IndexedCard {
  threadId: string;
  message: Message;
  kind: ApprovalKind;
}

interface IndexedBot {
  id: string;
  name: string;
  color?: string;
  owner?: string;
}

export interface ApprovalsStore {
  onChange(listener: (change: StoreChange) => void): () => void;
  messagesFor(threadId: string): Message[];
  bot(id: string): IndexedBot | null | undefined;
  botByThread(threadId: string): IndexedBot | null | undefined;
  groupByThread(threadId: string): { id: string } | null | undefined;
}

export interface ApprovalsViewer {
  who: Decider;
  visible: { bot(id: string): boolean; thread(id: string): boolean; group(id: string): boolean };
  refusal?: (card: IndexedCard) => string | null;
}

export interface ApprovalsIndexDeps {
  store: ApprovalsStore;
  ttlMs: () => number;
  nameOf: (email: string) => string | undefined;
}

export function createApprovalsIndex(deps: ApprovalsIndexDeps) {
  const cards = new Map<string, IndexedCard>();
  const listeners = new Set<() => void>();
  let unsubscribe: (() => void) | null = null;

  const changed = () => {
    for (const listener of Array.from(listeners)) {
      try {
        listener();
      } catch (error) {
        console.error("approvals: listener threw", error);
      }
    }
  };

  function consider(threadId: string, message: Message): void {
    const key = approvalId(threadId, message.id);
    const kind = waitingKind(message);
    if (kind) {
      cards.set(key, { threadId, message, kind });
      changed();
    } else if (cards.delete(key)) {
      changed();
    }
  }

  function dropThread(threadId: string): void {
    let any = false;
    for (const [key, card] of cards) {
      if (card.threadId !== threadId) continue;
      cards.delete(key);
      any = true;
    }
    if (any) changed();
  }

  function cardBot(card: IndexedCard): IndexedBot | undefined {
    const relay = card.message.card?.relayFor;
    if (relay) return deps.store.bot(relay.botId) ?? undefined;
    if (card.message.from?.botId) return deps.store.bot(card.message.from.botId) ?? undefined;
    return deps.store.botByThread(card.threadId) ?? undefined;
  }

  function item(card: IndexedCard, viewer: ApprovalsViewer): ApprovalItem | null {
    const bot = cardBot(card);
    if (!bot) return null;
    const { message } = card;
    const relayName = message.card?.relayFor?.name;
    const botName = relayName ?? bot.name;
    const decider = deciderName(bot, deps.nameOf);
    const copy = approvalCopy(message, botName, decider);
    const groupId = deps.store.groupByThread(card.threadId)?.id;
    const requestId = message.card?.requestId;
    const expiresAt = approvalDeadline(message, deps.ttlMs());
    const mayAct = mayDecide(viewer.who, bot) && (!requestId || !viewer.refusal || viewer.refusal(card) === null);
    return {
      id: approvalId(card.threadId, message.id),
      kind: card.kind,
      botId: bot.id,
      botName,
      threadId: card.threadId,
      ...(groupId ? { groupId } : {}),
      messageId: message.id,
      ...(requestId ? { requestId } : {}),
      title: copy.title,
      summary: copy.summary,
      fields: copy.fields,
      risk: approvalRisk(message.card),
      requestedAt: message.at,
      ...(expiresAt !== undefined ? { expiresAt } : {}),
      decider,
      canDecide: mayAct,
      action: decidedInList(card.kind) ? "decide" : "open",
    };
  }

  function seen(card: IndexedCard, viewer: ApprovalsViewer): boolean {
    const bot = cardBot(card);
    if (!bot || !viewer.visible.bot(bot.id) || !viewer.visible.thread(card.threadId)) return false;
    const group = deps.store.groupByThread(card.threadId);
    return !group || viewer.visible.group(group.id);
  }

  return {
    start(rows: ReadonlyArray<{ threadId: string; messageId: string }>): void {
      unsubscribe?.();
      cards.clear();
      for (const row of rows) {
        let message: Message | undefined;
        try {
          message = deps.store.messagesFor(row.threadId).find((candidate) => candidate.id === row.messageId);
        } catch {
          continue;
        }
        if (message) consider(row.threadId, message);
      }
      unsubscribe = deps.store.onChange((change) => {
        if (change.type === "message" || change.type === "message.patch") consider(change.threadId, change.message);
        else if (change.type === "thread.deleted") dropThread(change.threadId);
      });
    },
    stop(): void {
      unsubscribe?.();
      unsubscribe = null;
      cards.clear();
    },
    get size(): number {
      return cards.size;
    },
    all(): IndexedCard[] {
      return Array.from(cards.values());
    },
    find(threadId: string, messageId: string): IndexedCard | undefined {
      return cards.get(approvalId(threadId, messageId));
    },
    byRequest(requestId: string): IndexedCard | undefined {
      for (const card of cards.values()) if (card.message.card?.requestId === requestId) return card;
      return undefined;
    },
    owner(card: IndexedCard): string | undefined {
      return ownerOf(cardBot(card));
    },
    voice(card: IndexedCard): { bot: { id: string; name: string; color: string }; speaker: boolean } | undefined {
      const bot = cardBot(card);
      if (!bot) return undefined;
      const home = deps.store.botByThread(card.threadId);
      return { bot: { id: bot.id, name: bot.name, color: bot.color ?? "#888888" }, speaker: Boolean(deps.store.groupByThread(card.threadId)) || home?.id !== bot.id };
    },
    visibleItem(card: IndexedCard, viewer: ApprovalsViewer): ApprovalItem | null {
      return seen(card, viewer) ? item(card, viewer) : null;
    },
    items(viewer: ApprovalsViewer): ApprovalItem[] {
      const out: ApprovalItem[] = [];
      for (const card of cards.values()) {
        const built = seen(card, viewer) ? item(card, viewer) : null;
        if (built) out.push(built);
      }
      return out.sort((a, b) => (a.risk === b.risk ? a.requestedAt - b.requestedAt : a.risk === "critical" ? -1 : 1));
    },
    onChange(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export type ApprovalsIndex = ReturnType<typeof createApprovalsIndex>;
