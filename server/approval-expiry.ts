// Nordus: a tool permission that nobody answers does not wait forever. It is stamped with its deadline on the card, so a
// restart keeps it, and declined for the person with the plain reason "expirou" when the time runs out.
import { approvalDeadline, EXPIRED_DECLINE_REASON, expiresAfterWaiting } from "../shared/approvals.ts";
import type { ApprovalsIndex, IndexedCard } from "./approvals-index.ts";
import type { Message } from "./store.ts";

const SWEEP_EVERY_MS = 30_000;

export interface ApprovalExpiryDeps {
  index: ApprovalsIndex;
  store: {
    messagesFor(threadId: string): Message[];
    patchMessage(threadId: string, messageId: string, patch: Partial<Message>): unknown;
  };
  ttlMs: () => number;
  now?: () => number;
  decline: (card: IndexedCard, reason: string) => Promise<boolean>;
  everyMs?: number;
}

export function createApprovalExpiry(deps: ApprovalExpiryDeps) {
  const now = deps.now ?? Date.now;
  const settling = new Set<string>();
  let timer: ReturnType<typeof setInterval> | null = null;
  let stopWatching: (() => void) | null = null;
  let stampQueued = false;

  const latest = (card: IndexedCard) => deps.store.messagesFor(card.threadId).find((message) => message.id === card.message.id);

  function stampAll(): void {
    stampQueued = false;
    for (const card of deps.index.all()) {
      if (!expiresAfterWaiting(card.kind) || card.message.card?.approval?.expiresAt !== undefined) continue;
      const current = latest(card);
      if (!current?.card || current.card.approval?.expiresAt !== undefined || approvalDeadline(current, deps.ttlMs()) === undefined) continue;
      deps.store.patchMessage(card.threadId, current.id, {
        card: { ...current.card, approval: { ...current.card.approval, expiresAt: current.at + deps.ttlMs() } },
      });
    }
  }

  function queueStamp(): void {
    if (stampQueued) return;
    stampQueued = true;
    setImmediate(stampAll);
  }

  function mark(card: IndexedCard, patch: (card: NonNullable<Message["card"]>) => NonNullable<Message["card"]>): void {
    const current = latest(card);
    if (current?.card && waitingStill(current)) deps.store.patchMessage(card.threadId, current.id, { card: patch(current.card) });
  }

  const waitingStill = (message: Message) => Boolean(message.card && !message.card.answered && !message.card.dismissed && !message.card.expired);

  /** `quiet`: nothing is listening for the answer (the server just started), so the card is settled without trying to deliver one. */
  async function sweep(quiet = false): Promise<number> {
    const at = now();
    let settled = 0;
    for (const card of deps.index.all()) {
      if (!expiresAfterWaiting(card.kind)) continue;
      const deadline = approvalDeadline(card.message, deps.ttlMs());
      if (deadline === undefined || deadline > at) continue;
      const key = `${card.threadId}.${card.message.id}`;
      if (settling.has(key)) continue;
      settling.add(key);
      try {
        mark(card, (current) => ({ ...current, approval: { ...current.approval, expiresAt: deadline, lapsed: true } }));
        if (!quiet) await deps.decline(card, EXPIRED_DECLINE_REASON).catch(() => false);
        mark(card, (current) => ({ ...current, expired: true }));
        settled += 1;
      } finally {
        settling.delete(key);
      }
    }
    return settled;
  }

  return {
    sweep,
    start(): void {
      this.stop();
      stopWatching = deps.index.onChange(queueStamp);
      queueStamp();
      void sweep(true);
      timer = setInterval(() => void sweep(), deps.everyMs ?? SWEEP_EVERY_MS);
      timer.unref?.();
    },
    stop(): void {
      stopWatching?.();
      stopWatching = null;
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}

export type ApprovalExpiry = ReturnType<typeof createApprovalExpiry>;
