// The reply a bot is writing, kept apart from the app state: pieces arrive many times a second and only the open
// conversation reads them, so nothing else re-renders while a reply is being written.
import { useSyncExternalStore } from "react";

import type { ReplyDraftChunk, ReplyDraftSnapshot } from "../../shared/runtime-events";

export interface ReplyDraft { streamId: string; rev: number; text: string }

export type DraftEvent =
  | { type: "chunk"; threadId: string; chunk: ReplyDraftChunk }
  /** The draft is over: its saved message arrived, or the server dropped it. */
  | { type: "end"; threadId: string; streamId: string }
  /** What the server holds right now, fetched after a hole. */
  | { type: "loaded"; threadId: string; draft: ReplyDraftSnapshot | null }
  /** The bot has nothing left to write here (or, with no thread, a fresh snapshot came in): no draft may stay on screen. */
  | { type: "clear"; threadId?: string };

export interface DraftsState {
  drafts: Readonly<Record<string, ReplyDraft>>;
  /** Recently ended ids: a late or replayed piece of one must not bring it back. */
  ended: readonly string[];
}

export const EMPTY_DRAFTS: DraftsState = { drafts: {}, ended: [] };

const ENDED_KEPT = 64;

export interface DraftOutcome {
  state: DraftsState;
  /** The conversation missed a piece and must fetch its draft again. */
  reload?: string;
}

function withDraft(state: DraftsState, threadId: string, draft: ReplyDraft | null): DraftsState {
  const drafts = { ...state.drafts };
  if (draft) drafts[threadId] = draft;
  else delete drafts[threadId];
  return { ...state, drafts };
}

export function reduceDrafts(state: DraftsState, event: DraftEvent): DraftOutcome {
  const current = event.threadId === undefined ? undefined : state.drafts[event.threadId];
  switch (event.type) {
    case "chunk": {
      const { streamId, rev, offset, delta } = event.chunk;
      if (state.ended.includes(streamId)) return { state };
      if (!current || current.streamId !== streamId || rev > current.rev) {
        // A new reply, or a new revision of this one, starts at the beginning; anything else means pieces went missing.
        if (offset !== 0) return { state, reload: event.threadId };
        return { state: withDraft(state, event.threadId, { streamId, rev, text: delta }) };
      }
      if (rev < current.rev) return { state };
      if (offset > current.text.length) return { state, reload: event.threadId };
      if (offset + delta.length <= current.text.length) return { state };
      return { state: withDraft(state, event.threadId, { ...current, text: current.text.slice(0, offset) + delta }) };
    }
    case "end": {
      const ended = [...state.ended.filter((id) => id !== event.streamId), event.streamId].slice(-ENDED_KEPT);
      const next = { ...state, ended };
      return { state: current?.streamId === event.streamId ? withDraft(next, event.threadId, null) : next };
    }
    case "clear":
      if (event.threadId === undefined) return { state: Object.keys(state.drafts).length ? { ...state, drafts: {} } : state };
      return { state: current ? withDraft(state, event.threadId, null) : state };
    case "loaded": {
      const loaded = event.draft;
      if (!loaded) return { state: current ? withDraft(state, event.threadId, null) : state };
      if (state.ended.includes(loaded.streamId)) return { state };
      // Pieces that arrived while the fetch was out may already be ahead of it.
      if (current && current.streamId === loaded.streamId && current.rev === loaded.rev && current.text.length >= loaded.text.length) {
        return { state };
      }
      return { state: withDraft(state, event.threadId, { ...loaded }) };
    }
  }
}

type Listener = () => void;

/** One store per app: the live feed writes, the open conversation reads. */
export function createDraftStore(fetchDraft: (threadId: string) => Promise<ReplyDraftSnapshot | null>) {
  let state = EMPTY_DRAFTS;
  const listeners = new Set<Listener>();
  const loading = new Set<string>();

  const apply = (event: DraftEvent) => {
    const outcome = reduceDrafts(state, event);
    if (outcome.state !== state) {
      state = outcome.state;
      for (const listener of listeners) listener();
    }
    if (outcome.reload && !loading.has(outcome.reload)) {
      const threadId = outcome.reload;
      loading.add(threadId);
      void fetchDraft(threadId)
        .then((draft) => apply({ type: "loaded", threadId, draft }), () => {})
        .finally(() => loading.delete(threadId));
    }
  };

  return {
    apply,
    draft: (threadId: string): ReplyDraft | null => state.drafts[threadId] ?? null,
    subscribe: (listener: Listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export type DraftStore = ReturnType<typeof createDraftStore>;

export const replyDrafts: DraftStore = createDraftStore(async (threadId) => {
  const res = await fetch(`/api/threads/${encodeURIComponent(threadId)}/reply-draft`);
  if (!res.ok) return null;
  const body = (await res.json()) as { draft?: ReplyDraftSnapshot | null };
  return body.draft ?? null;
});

export function useReplyDraft(threadId: string | undefined, store: DraftStore = replyDrafts): ReplyDraft | null {
  const snapshot = () => (threadId ? store.draft(threadId) : null);
  return useSyncExternalStore(store.subscribe, snapshot, snapshot);
}
