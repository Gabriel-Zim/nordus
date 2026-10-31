// Adapted from touri ui/src/api/sendJournal.ts, Copyright 2026 Hodle Tecnologia Ltda and touri contributors,
// licensed under the Apache License, Version 2.0 (http://www.apache.org/licenses/LICENSE-2.0).
// Modified for Nordus: bot, room and task targets, voice notes kept in IndexedDB, cancel and retry.
import { useCallback, useSyncExternalStore } from "react";
import type { DataContext } from "../../shared/data-context";
import { isSignedOutError } from "./signed-out";
import { voiceNoteMessage, type SentVoiceNote } from "./voice-note";

export const OUTBOX_KEY = "nordus-send-outbox";
export const OUTBOX_TTL_MS = 24 * 60 * 60_000;
export const DELIVERED_SHOWN_MS = 3_000;
const FIRST_RETRY_MS = 500;
/** Long enough for a server restart; a server still failing after this will likely keep failing. */
export const SERVER_FAILURE_LIMIT_MS = 10 * 60_000;
const FAILED_KEPT_MS = 7 * 24 * 60 * 60_000;
/** Past the 90 s a delivery may take: a send still "sending" after this belongs to a tab that closed mid-request. */
export const STALE_SENDING_MS = 120_000;
const LAST_RETRY_MS = 5_000;

export type OutboxTarget =
  | { kind: "bot"; botId: string }
  | { kind: "group"; groupId: string; mode: "chat" | "goal" };

export type OutboxStatus = "queued" | "sending" | "delivered" | "failed";

export interface OutboxEntry {
  sendId: string;
  draftId: string;
  target: OutboxTarget;
  threadId: string;
  text: string;
  /** The body the server receives; a voice note has none until its transcript comes back. */
  requestText?: string;
  replyToId?: string;
  dataContext?: DataContext;
  /** The recording itself waits in IndexedDB under the sendId. */
  voice?: { mime: string; durationMs: number };
  createdAt: number;
  expiresAt: number;
  status: OutboxStatus;
  error?: string;
  expired?: boolean;
  /** When the server first answered this send with an error it may recover from. */
  failingSince?: number;
  /** The HTTP status of a refusal; 409 means this sendId can never go through again. */
  errorStatus?: number;
  sendingSince?: number;
  /** The request never reached Nordus because the Cloudflare Access sign-in in front of it expired. */
  signInExpired?: boolean;
  /** Nordus refused it because this browser has no session any more: it waits, untouched, for the person to sign in again. */
  signedOut?: boolean;
}

export interface OutboxTransport {
  /** False until the target bot or room is loaded, so the send lands in a known conversation. */
  ready(entry: OutboxEntry): boolean;
  voiceNote(entry: OutboxEntry): Promise<SentVoiceNote>;
  deliver(entry: OutboxEntry & { requestText: string }): Promise<void>;
}

export interface VoiceBlobs {
  delete(id: string): Promise<void>;
}

type Storage_ = Pick<Storage, "getItem" | "setItem">;
type NewEntry = Omit<OutboxEntry, "createdAt" | "expiresAt" | "status" | "error" | "expired" | "failingSince" | "errorStatus" | "sendingSince" | "signInExpired" | "signedOut">;

/** A 4xx other than timeout or rate limit will answer the same way next time; anything else may pass on retry. */
export function permanentFailure(error: unknown): string | null {
  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status !== "number" || status < 400 || status >= 500 || status === 408 || status === 429) return null;
  return error instanceof Error && error.message ? error.message : `${status}`;
}

function parse(raw: string | null): OutboxEntry[] {
  try {
    const value = raw ? JSON.parse(raw) : [];
    return Array.isArray(value)
      ? value
        .filter((entry): entry is OutboxEntry => Boolean(entry) && typeof entry.sendId === "string" && typeof entry.threadId === "string")
        .map((entry) => typeof entry.text === "string" ? entry : { ...entry, text: entry.requestText ?? "" })
      : [];
  } catch {
    return [];
  }
}

/** A typed message is usually its own request body: store it once, so a long one does not fill the quota twice. */
function serialize(entries: OutboxEntry[]): string {
  return JSON.stringify(entries.map(({ text, ...entry }) => text === entry.requestText ? entry : { ...entry, text }));
}

const byAge = (a: OutboxEntry, b: OutboxEntry) => a.createdAt - b.createdAt;

export function createSendOutbox({
  storage,
  blobs,
  now = () => Date.now(),
  online = true,
  signInExpired,
  onSignedOut,
}: {
  storage?: Storage_;
  blobs?: VoiceBlobs;
  now?: () => number;
  online?: boolean;
  /** Asked after a send that never reached the server, once per run of such failures. */
  signInExpired?: () => Promise<boolean>;
  /** Told when Nordus says this browser is signed out, so the page can ask the person to sign in. */
  onSignedOut?: (error: unknown) => void;
}) {
  // Storage is the source of truth, so another tab of the app never overwrites sends it did not see.
  const stored = (): OutboxEntry[] | undefined => {
    if (!storage) return undefined;
    try {
      return parse(storage.getItem(OUTBOX_KEY));
    } catch {
      return undefined;
    }
  };
  const loaded = stored() ?? [];
  const forgotten = loaded.filter((entry) => entry.status === "failed" && entry.createdAt <= now() - FAILED_KEPT_MS);
  for (const entry of forgotten) if (entry.voice) void blobs?.delete(entry.sendId).catch(() => undefined);
  // A send the page died in the middle of may or may not have landed; the same sendId settles it either way.
  let entries = loaded
    .filter((entry) => !forgotten.includes(entry))
    .map((entry) => entry.status === "sending" ? { ...entry, status: "queued" as const } : entry)
    // A fresh page (often right after signing in) tries again; the first refusal marks the queue once more.
    .map((entry) => {
      const { signedOut, ...rest } = entry;
      void signedOut;
      return rest;
    });
  // While writes fail (a full quota), storage misses sends this tab still holds; memory stays the source for those.
  let durable = true;
  let delivered: OutboxEntry[] = [];
  let snapshot: OutboxEntry[] = [];
  let transport: OutboxTransport | undefined;
  let connected = online;
  // Signed out: every request would get the same answer, so nothing goes out until a reconnect or a fresh page tries again.
  let held = false;
  const sending = new Set<string>();
  const inFlight = new Set<string>();
  // Conversations whose oldest send failed for a reason that may pass: they wait for the retry timer.
  const waiting = new Set<string>();
  let retryDelay = FIRST_RETRY_MS;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();

  const publish = () => {
    snapshot = [...entries, ...delivered];
    for (const listener of listeners) listener();
  };
  // What this tab changed (null: removed) since storage last accepted a write; it wins over the stale copy on disk.
  const unsaved = new Map<string, OutboxEntry | null>();
  const current = (): OutboxEntry[] => {
    const disk = stored();
    if (!disk) return entries;
    if (durable) return disk;
    const merged = new Map(disk.map((entry) => [entry.sendId, entry]));
    for (const entry of entries) if (!merged.has(entry.sendId)) merged.set(entry.sendId, entry);
    for (const [sendId, entry] of unsaved) {
      if (entry) merged.set(sendId, entry);
      else merged.delete(sendId);
    }
    return [...merged.values()].sort(byAge);
  };
  const change = (apply: (current: OutboxEntry[]) => OutboxEntry[]) => {
    const before = current();
    entries = apply(before);
    try {
      storage?.setItem(OUTBOX_KEY, serialize(entries));
      durable = true;
      unsaved.clear();
    } catch {
      durable = false;
      const after = new Map(entries.map((entry) => [entry.sendId, entry]));
      for (const entry of before) if (!after.has(entry.sendId)) unsaved.set(entry.sendId, null);
      for (const entry of entries) if (!before.includes(entry)) unsaved.set(entry.sendId, entry);
    }
    publish();
  };
  const update = (sendId: string, patch: Partial<OutboxEntry>) =>
    change((current) => current.map((entry) => entry.sendId === sendId ? { ...entry, ...patch } : entry));
  const find = (sendId: string) => entries.find((entry) => entry.sendId === sendId);
  const fail = (sendId: string, error: string, expired = false, errorStatus?: number) =>
    update(sendId, { status: "failed", error, expired, errorStatus, sendingSince: undefined });
  const abandoned = (entry: OutboxEntry) =>
    entry.status === "sending" && !inFlight.has(entry.sendId) && now() - (entry.sendingSince ?? 0) > STALE_SENDING_MS;

  const takeBackAbandoned = () => {
    for (const stale of entries.filter(abandoned)) update(stale.sendId, { status: "queued", sendingSince: undefined });
  };
  const expire = () => {
    takeBackAbandoned();
    for (const entry of entries) {
      if (entry.status === "queued" && entry.expiresAt <= now()) fail(entry.sendId, "expired", true);
    }
    armExpiry();
    drain();
  };
  /** Wakes for the next deadline and for a send another tab left "sending", so it gets its Cancelar back without any event. */
  const armExpiry = () => {
    clearTimeout(expiryTimer);
    const deadlines = [
      ...entries.filter((entry) => entry.status === "queued").map((entry) => entry.expiresAt),
      ...entries.filter((entry) => entry.status === "sending" && !inFlight.has(entry.sendId))
        .map((entry) => (entry.sendingSince ?? 0) + STALE_SENDING_MS + 1),
    ];
    if (deadlines.length) expiryTimer = setTimeout(expire, Math.max(1, Math.min(2_147_483_647, Math.min(...deadlines) - now())));
  };
  const scheduleRetry = () => {
    if (!connected || retryTimer) return;
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      waiting.clear();
      drain();
    }, retryDelay);
    retryDelay = Math.min(retryDelay * 2, LAST_RETRY_MS);
  };
  const markDelivered = (sendId: string) => {
    const entry = find(sendId);
    if (!entry) return;
    delivered = [...delivered, { ...entry, status: "delivered" }];
    change((current) => current.filter((candidate) => candidate.sendId !== sendId));
    setTimeout(() => {
      delivered = delivered.filter((candidate) => candidate.sendId !== sendId);
      publish();
    }, DELIVERED_SHOWN_MS);
  };

  /** Oldest first within a conversation, so it receives its messages in the order they were written; conversations run side by side. */
  const drain = () => {
    takeBackAbandoned();
    if (!connected || !transport || held) return;
    const seen = new Set<string>();
    for (const entry of entries) {
      if (entry.status === "failed" || seen.has(entry.threadId)) continue;
      if (entry.status === "queued" && entry.expiresAt <= now()) {
        fail(entry.sendId, "expired", true);
        continue;
      }
      seen.add(entry.threadId);
      if (entry.status === "queued" && !sending.has(entry.threadId) && !waiting.has(entry.threadId) && transport.ready(entry)) {
        void attempt(entry, transport);
      }
    }
    armExpiry();
  };

  const attempt = async (entry: OutboxEntry, via: OutboxTransport) => {
    // Another tab may have cancelled or taken it since this tab last looked.
    if (current().find((candidate) => candidate.sendId === entry.sendId)?.status !== "queued") {
      entries = current();
      publish();
      return;
    }
    sending.add(entry.threadId);
    inFlight.add(entry.sendId);
    update(entry.sendId, { status: "sending", sendingSince: now() });
    try {
      let requestText = entry.requestText;
      if (requestText === undefined) {
        requestText = voiceNoteMessage(await via.voiceNote(entry));
        update(entry.sendId, { requestText });
        await blobs?.delete(entry.sendId).catch(() => undefined);
      }
      await via.deliver({ ...entry, requestText });
      markDelivered(entry.sendId);
      retryDelay = FIRST_RETRY_MS;
    } catch (error) {
      if (isSignedOutError(error)) {
        held = true;
        change((list) => list.map((candidate) =>
          candidate.sendId === entry.sendId || candidate.status === "queued"
            ? { ...candidate, status: "queued" as const, sendingSince: undefined, signedOut: true }
            : candidate));
        onSignedOut?.(error);
        return;
      }
      const reason = permanentFailure(error);
      const status = (error as { status?: unknown } | null)?.status;
      const answered = typeof status === "number";
      const failingSince = answered ? (find(entry.sendId)?.failingSince ?? now()) : undefined;
      if (reason) fail(entry.sendId, reason, false, status as number);
      else if (failingSince !== undefined && now() - failingSince >= SERVER_FAILURE_LIMIT_MS) {
        fail(entry.sendId, error instanceof Error && error.message ? error.message : "server error", false, status as number);
      } else {
        const expiredSignIn = answered
          ? false
          : find(entry.sendId)?.signInExpired || (await signInExpired?.().catch(() => false)) === true;
        update(entry.sendId, {
          status: "queued",
          sendingSince: undefined,
          signInExpired: expiredSignIn || undefined,
          ...(failingSince !== undefined ? { failingSince } : {}),
        });
        waiting.add(entry.threadId);
        scheduleRetry();
      }
    } finally {
      sending.delete(entry.threadId);
      inFlight.delete(entry.sendId);
      drain();
    }
  };

  change(() => entries);
  armExpiry();
  return {
    entries: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    online: () => connected,
    enqueue(input: NewEntry) {
      if (find(input.sendId)) return;
      const at = now();
      change((current) => [...current, { ...input, createdAt: at, expiresAt: at + OUTBOX_TTL_MS, status: "queued", ...(held ? { signedOut: true } : {}) }]);
      armExpiry();
      drain();
    },
    /** Only an entry not on its way: a request already out may still land. */
    cancel(sendId: string): boolean {
      const entry = find(sendId);
      if (!entry || entry.status === "sending") return false;
      change((current) => current.filter((candidate) => candidate.sendId !== sendId));
      armExpiry();
      if (entry.voice) void blobs?.delete(sendId).catch(() => undefined);
      return true;
    },
    retry(sendId: string) {
      const entry = find(sendId);
      if (!entry || entry.status !== "failed") return;
      update(sendId, { status: "queued", error: undefined, expired: undefined, failingSince: undefined, errorStatus: undefined, expiresAt: now() + OUTBOX_TTL_MS });
      drain();
    },
    /** A 409 means the server holds this sendId for something else (or the person cancelled it there): only a new id goes through. */
    resendAsNew(sendId: string, newSendId: string) {
      const entry = find(sendId);
      if (!entry || entry.status !== "failed" || entry.requestText === undefined) return;
      const at = now();
      change((list) => list.map((candidate) => candidate.sendId !== sendId ? candidate : {
        ...candidate, sendId: newSendId, status: "queued" as const, error: undefined, expired: undefined, failingSince: undefined,
        errorStatus: undefined, createdAt: at, expiresAt: at + OUTBOX_TTL_MS,
      }).sort(byAge));
      drain();
    },
    attach(next: OutboxTransport | undefined) {
      transport = next;
      drain();
    },
    reconnect() {
      connected = true;
      held = false;
      clearTimeout(retryTimer);
      retryTimer = undefined;
      retryDelay = FIRST_RETRY_MS;
      waiting.clear();
      drain();
    },
    disconnect() {
      connected = false;
      clearTimeout(retryTimer);
      retryTimer = undefined;
      publish();
    },
    drain,
    refresh() {
      entries = current();
      publish();
      armExpiry();
      drain();
    },
    /** Signing out: what one person queued must never go out under the next person's session. */
    clear() {
      for (const entry of entries) if (entry.voice) void blobs?.delete(entry.sendId).catch(() => undefined);
      change(() => []);
      armExpiry();
    },
    stop() {
      connected = false;
      clearTimeout(retryTimer);
      clearTimeout(expiryTimer);
      retryTimer = undefined;
    },
  };
}

export type SendOutbox = ReturnType<typeof createSendOutbox>;

export function useOutboxEntries(outbox: SendOutbox, draftId: string): OutboxEntry[] {
  const pick = useCallback(() => outbox.entries(), [outbox]);
  const all = useSyncExternalStore(outbox.subscribe, pick, pick);
  return all.filter((entry) => entry.draftId === draftId);
}

export function useOutboxEntry(outbox: SendOutbox, sendId: string): OutboxEntry | undefined {
  const pick = useCallback(() => outbox.entries().find((entry) => entry.sendId === sendId), [outbox, sendId]);
  return useSyncExternalStore(outbox.subscribe, pick, pick);
}

export function useOutboxOnline(outbox: SendOutbox): boolean {
  return useSyncExternalStore(outbox.subscribe, outbox.online, outbox.online);
}
