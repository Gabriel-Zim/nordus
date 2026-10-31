// Direct messages on the client: the list and the open conversations, kept current by the `dm` and `dm.message`
// live frames. Those frames go to the two people only and are never replayed, so a reconnect asks again.
import { useSyncExternalStore } from "react";

import { DIRECT_THREAD_PREFIX, type DirectConversation, type DirectMessage } from "../../shared/people";
import { listenLiveFrames } from "@/lib/live-events";
import { ApiError, api } from "./api";

export const DIRECT_PAGE = 30;

export interface DirectThread {
  messages: DirectMessage[];
  hasMore: boolean;
  loading: boolean;
  failed: boolean;
}

export interface DirectState {
  loaded: boolean;
  /** False once the server says this person has no address to write from: the whole block goes away. */
  available: boolean;
  /** Newest first. */
  dms: DirectConversation[];
  threads: Record<string, DirectThread>;
}

export const EMPTY_DIRECT: DirectState = { loaded: false, available: true, dms: [], threads: {} };

export type DirectFrame =
  | { kind: "dm"; dm: DirectConversation }
  | { kind: "dm.message"; dmId: string; message: DirectMessage };

function present<T>(value: T | null): value is T {
  return value !== null;
}

export function parseMessage(value: unknown): DirectMessage | null {
  const record = Object(value) as Record<string, unknown>;
  if (typeof record.id !== "string" || typeof record.text !== "string" || typeof record.at !== "number" || typeof record.from !== "string") return null;
  return { id: record.id, at: record.at, from: record.from, name: typeof record.name === "string" ? record.name : "", text: record.text };
}

export function parseConversation(value: unknown): DirectConversation | null {
  const record = Object(value) as Record<string, unknown>;
  if (typeof record.id !== "string" || typeof record.peer !== "string" || !record.peer) return null;
  const last = parseMessage(record.last);
  return {
    id: record.id,
    threadId: typeof record.threadId === "string" ? record.threadId : `${DIRECT_THREAD_PREFIX}${record.id}`,
    peer: record.peer,
    peerName: typeof record.peerName === "string" && record.peerName ? record.peerName : record.peer,
    unread: record.unread === true,
    ...(last ? { last } : {}),
  };
}

/** The conversation id a notification's thread names, or null when the thread is not a direct message. */
export function directIdOf(threadId: string | null | undefined): string | null {
  return threadId?.startsWith(DIRECT_THREAD_PREFIX) && threadId.length > DIRECT_THREAD_PREFIX.length ? threadId.slice(DIRECT_THREAD_PREFIX.length) : null;
}

export function readDirectFrame(frame: { kind: string }): DirectFrame | null {
  const record = frame as unknown as Record<string, unknown>;
  if (frame.kind === "dm") {
    const dm = parseConversation(record.dm);
    return dm ? { kind: "dm", dm } : null;
  }
  if (frame.kind === "dm.message") {
    const message = parseMessage(record.message);
    return typeof record.dmId === "string" && message ? { kind: "dm.message", dmId: record.dmId, message } : null;
  }
  return null;
}

function newestFirst(dms: readonly DirectConversation[]): DirectConversation[] {
  return [...dms].sort((a, b) => (b.last?.at ?? 0) - (a.last?.at ?? 0));
}

export function withConversation(state: DirectState, dm: DirectConversation): DirectState {
  return { ...state, dms: newestFirst([dm, ...state.dms.filter((item) => item.id !== dm.id)]) };
}

export function mergeLines(current: readonly DirectMessage[], incoming: readonly DirectMessage[]): DirectMessage[] {
  const byId = new Map<string, DirectMessage>();
  for (const line of [...current, ...incoming]) byId.set(line.id, line);
  return [...byId.values()].sort((a, b) => a.at - b.at);
}

/** A line that arrived live or that this person just sent. A line for a conversation this person is not in is dropped. */
export function withLine(state: DirectState, dmId: string, message: DirectMessage, me: string | undefined): DirectState {
  const dm = state.dms.find((item) => item.id === dmId);
  if (!dm) return state;
  const thread = state.threads[dmId];
  const threads = thread && !thread.messages.some((line) => line.id === message.id)
    ? { ...state.threads, [dmId]: { ...thread, messages: mergeLines(thread.messages, [message]) } }
    : state.threads;
  const last = !dm.last || message.at >= dm.last.at ? message : dm.last;
  return withConversation({ ...state, threads }, { ...dm, last, unread: message.from !== me });
}

export function reduceDirectFrame(state: DirectState, frame: DirectFrame, me: string | undefined): DirectState {
  if (frame.kind === "dm") return frame.dm.peer === me ? state : withConversation(state, frame.dm);
  return withLine(state, frame.dmId, frame.message, me);
}

const FRESH_THREAD: DirectThread = { messages: [], hasMore: false, loading: false, failed: false };

export function withThread(state: DirectState, dmId: string, change: Partial<DirectThread>): DirectState {
  return { ...state, threads: { ...state.threads, [dmId]: { ...FRESH_THREAD, ...state.threads[dmId], ...change } } };
}

/** The newest page replaces what is shown only when it does not connect to it, so a long absence leaves no hole. */
export function withLatestPage(state: DirectState, dmId: string, page: { messages: DirectMessage[]; hasMore: boolean }): DirectState {
  const thread = state.threads[dmId] ?? FRESH_THREAD;
  const known = new Set(thread.messages.map((line) => line.id));
  const connects = thread.messages.length === 0 || page.messages.length === 0 || page.messages.some((line) => known.has(line.id));
  return withThread(state, dmId, connects
    ? { messages: mergeLines(thread.messages, page.messages), hasMore: thread.messages.length ? thread.hasMore : page.hasMore, loading: false, failed: false }
    : { messages: mergeLines([], page.messages), hasMore: page.hasMore, loading: false, failed: false });
}

export function withEarlierPage(state: DirectState, dmId: string, page: { messages: DirectMessage[]; hasMore: boolean }): DirectState {
  const thread = state.threads[dmId] ?? FRESH_THREAD;
  return withThread(state, dmId, { messages: mergeLines(thread.messages, page.messages), hasMore: page.hasMore, loading: false, failed: false });
}

export function withRead(state: DirectState, dmId: string): DirectState {
  return state.dms.some((dm) => dm.id === dmId && dm.unread)
    ? { ...state, dms: state.dms.map((dm) => (dm.id === dmId ? { ...dm, unread: false } : dm)) }
    : state;
}

export function unreadCount(state: DirectState): number {
  return state.dms.filter((dm) => dm.unread).length;
}

let state: DirectState = EMPTY_DIRECT;
let self: string | undefined;
let stopListening: (() => void) | null = null;
let listing: Promise<void> | null = null;
const listeners = new Set<() => void>();

function commit(next: DirectState): void {
  if (next === state) return;
  state = next;
  for (const listener of listeners) listener();
}

export function directSnapshot(): DirectState {
  return state;
}

export function resetDirect(): void {
  stopListening?.();
  stopListening = null;
  listing = null;
  self = undefined;
  commit(EMPTY_DIRECT);
}

export function loadConversations(): Promise<void> {
  listing ??= api<{ dms?: unknown }>("/api/dms", { background: true })
    .then((body) => {
      const dms = Array.isArray(body.dms) ? body.dms.map(parseConversation).filter(present) : [];
      commit({ ...state, loaded: true, available: true, dms: newestFirst(dms) });
    })
    .catch((error: unknown) => {
      const refused = error instanceof ApiError && error.status === 403;
      commit({ ...state, loaded: true, available: refused ? false : state.available, dms: refused ? [] : state.dms });
    })
    .finally(() => { listing = null; });
  return listing;
}

async function fetchPage(dmId: string, before?: string): Promise<{ messages: DirectMessage[]; hasMore: boolean }> {
  const query = new URLSearchParams({ limit: String(DIRECT_PAGE), ...(before ? { before } : {}) });
  const body = await api<{ messages?: unknown; hasMore?: unknown }>(`/api/dms/${encodeURIComponent(dmId)}/messages?${query}`);
  return { messages: Array.isArray(body.messages) ? body.messages.map(parseMessage).filter(present) : [], hasMore: body.hasMore === true };
}

/** The newest page of a conversation: the first time it is opened, and again after a reconnect. */
export async function openThread(dmId: string): Promise<void> {
  commit(withThread(state, dmId, { loading: true, failed: false }));
  try {
    commit(withLatestPage(state, dmId, await fetchPage(dmId)));
  } catch {
    commit(withThread(state, dmId, { loading: false, failed: true }));
  }
}

export async function loadEarlier(dmId: string): Promise<void> {
  const thread = state.threads[dmId];
  const oldest = thread?.messages[0];
  if (!thread || !oldest || thread.loading || !thread.hasMore) return;
  commit(withThread(state, dmId, { loading: true, failed: false }));
  try {
    commit(withEarlierPage(state, dmId, await fetchPage(dmId, oldest.id)));
  } catch {
    commit(withThread(state, dmId, { loading: false, failed: true }));
  }
}

/** Rejects when the server refuses the line; the caller keeps what was typed. */
export async function sendLine(dmId: string, text: string): Promise<void> {
  const body = await api<{ message?: unknown }>(`/api/dms/${encodeURIComponent(dmId)}/messages`, { method: "POST", body: JSON.stringify({ text }) });
  const message = parseMessage(body.message);
  if (message) commit(withLine(state, dmId, message, self));
}

export async function startConversation(peer: string): Promise<DirectConversation> {
  const body = await api<{ dm?: unknown }>("/api/dms", { method: "POST", body: JSON.stringify({ peer }) });
  const dm = parseConversation(body.dm);
  if (!dm) throw new Error("no conversation");
  commit(withConversation(state, dm));
  return dm;
}

/** The `dm` frame the server sends back is what settles it; this only keeps the dot from lingering meanwhile. */
export async function markRead(dmId: string): Promise<void> {
  commit(withRead(state, dmId));
  try {
    await api(`/api/dms/${encodeURIComponent(dmId)}/read`, { method: "POST", body: "{}" });
  } catch {
    // The next frame or list carries the truth.
  }
}

/** After a reconnect nothing was replayed: ask for the list, and for the newest page of each conversation that is loaded. */
export async function syncDirect(): Promise<void> {
  await loadConversations();
  await Promise.all(Object.keys(state.threads).map((dmId) => (state.dms.some((dm) => dm.id === dmId) ? openThread(dmId) : Promise.resolve())));
}

export function startDirect(email: string | undefined): void {
  self = email;
  if (stopListening) return;
  stopListening = listenLiveFrames({
    onFrame: (frame) => {
      const direct = readDirectFrame(frame as { kind: string });
      if (!direct) return;
      if (direct.kind === "dm.message" && !state.dms.some((dm) => dm.id === direct.dmId)) {
        void loadConversations();
        return;
      }
      commit(reduceDirectFrame(state, direct, self));
    },
    onMissedFrames: () => void syncDirect(),
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useDirect(): DirectState {
  return useSyncExternalStore(subscribe, directSnapshot, () => EMPTY_DIRECT);
}
