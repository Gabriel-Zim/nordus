import type { AppState, Message } from "@/state/store";

type TranscriptRow = Pick<Message, "id"> & Partial<Pick<Message, "at" | "sendId" | "parentId">>;

export const optimisticMessageId = (sendId: string): string => `optimistic-${sendId}`;

export function isOptimisticMessage(message: Pick<Message, "id" | "sendId">): boolean {
  return message.sendId !== undefined && message.id === optimisticMessageId(message.sendId);
}

export function optimisticUserMessage(
  text: string,
  sendId: string,
  replyToId?: string,
  parentId?: string | null,
  channelMode?: "chat" | "goal",
): Message {
  return {
    id: optimisticMessageId(sendId),
    role: "user",
    kind: "text",
    text,
    at: Date.now(),
    parentId: parentId ?? null,
    replyToId,
    sendId,
    channelMode,
  };
}

export interface MergedTranscript<T> {
  messages: T[];
  /** The snapshot shares no id with the held rows, so it replaced them and older history must page from its oldest row. */
  rebased: boolean;
}

/**
 * Folds a snapshot of the same thread into the rows already loaded. The incoming order is the server's insertion order
 * and wins for every id it carries; held rows the snapshot does not carry stay before it when they sat before the first
 * shared row. A snapshot that shares no id with the held rows is the thread's new base: without an overlap there is no
 * way to place the held rows, so older history is refetched from the snapshot instead of leaving a hole.
 */
export function mergeTranscriptRows<T extends TranscriptRow>(held: readonly T[], incoming: readonly T[]): MergedTranscript<T> {
  if (incoming.length === 0) return { messages: [...held], rebased: false };
  const incomingIds = new Set(incoming.map((message) => message.id));
  const confirmedSendIds = new Set(incoming.flatMap((message) => (message.sendId ? [message.sendId] : [])));
  const kept = held.filter((message) => !isOptimisticMessage(message) || !message.sendId || !confirmedSendIds.has(message.sendId));
  const regular = kept.filter((message) => !isOptimisticMessage(message));
  const optimistic = kept.filter(isOptimisticMessage);
  const firstShared = regular.findIndex((message) => incomingIds.has(message.id));
  if (firstShared < 0 && regular.length > 0) return { messages: [...incoming, ...optimistic], rebased: true };
  const front = regular.slice(0, Math.max(firstShared, 0));
  const frontIds = new Set(front.map((message) => message.id));
  const back = regular.filter((message) => !incomingIds.has(message.id) && !frontIds.has(message.id));
  return { messages: [...front, ...incoming, ...back, ...optimistic], rebased: false };
}

/** A rebased base has to keep paging from its own oldest row, so it reports a history until the server says otherwise. */
export function mergedHasMore(rebased: boolean, incoming: boolean | undefined, held: boolean | undefined): boolean | undefined {
  return rebased ? incoming ?? true : incoming ?? held;
}

interface TranscriptHost {
  messages: Message[];
  hasMore?: boolean;
  activeLeafId?: string | null;
}

function foldedActiveLeaf(
  previousLeaf: string | null | undefined,
  incomingLeaf: string | null | undefined,
  held: readonly Message[],
  incomingMessages: readonly Message[],
  rebased: boolean,
): string | null | undefined {
  const confirmedSendIds = new Set(incomingMessages.map((message) => message.sendId).filter((sendId): sendId is string => Boolean(sendId)));
  const replaced = held.find((message) => message.id === previousLeaf && isOptimisticMessage(message) && message.sendId && confirmedSendIds.has(message.sendId));
  const confirmed = replaced?.sendId ? incomingMessages.find((message) => message.sendId === replaced.sendId) : undefined;
  if (confirmed && previousLeaf === replaced?.id) return confirmed.id;
  const heldLeaf = held.find((message) => message.id === previousLeaf);
  if (!heldLeaf) return incomingLeaf;
  if (isOptimisticMessage(heldLeaf)) {
    const settled = incomingMessages.some((message) => message.id === heldLeaf.id) ||
      Boolean(heldLeaf.sendId && confirmedSendIds.has(heldLeaf.sendId));
    return settled ? incomingLeaf : previousLeaf;
  }
  if (rebased) return incomingLeaf;
  // A reply the snapshot window does not carry yet is newer than the leaf that window ended on.
  const incomingLeafRow = incomingMessages.find((message) => message.id === incomingLeaf);
  const keepsNewerHeldLeaf = incomingLeafRow !== undefined &&
    !incomingMessages.some((message) => message.id === previousLeaf) &&
    typeof heldLeaf.at === "number" && typeof incomingLeafRow.at === "number" &&
    heldLeaf.at > incomingLeafRow.at;
  return keepsNewerHeldLeaf ? previousLeaf : incomingLeaf;
}

/** The leaf a folded snapshot leaves on screen, keeping an optimistic row the snapshot predates. */
export function mergeTranscriptLeaf(
  previousLeaf: string | null | undefined,
  incomingLeaf: string | null | undefined,
  held: readonly Message[],
  incoming: readonly Message[],
): string | null | undefined {
  return foldedActiveLeaf(previousLeaf, incomingLeaf, held, incoming, mergeTranscriptRows(held, incoming).rebased);
}

export interface FoldedSnapshot extends TranscriptHost {
  /** The caller advances the thread's generation, so a page fetched from the replaced list cannot land on the base. */
  rebased: boolean;
}

/** Folds a snapshot of the thread already on screen into the rows held for it. */
export function mergeSnapshotTranscript(previous: TranscriptHost, incoming: TranscriptHost): FoldedSnapshot {
  const held = previous.messages ?? [];
  const incomingMessages = incoming.messages ?? [];
  const merged = mergeTranscriptRows(held, incomingMessages);
  return {
    messages: incomingMessages.length ? merged.messages : held,
    hasMore: mergedHasMore(merged.rebased, incoming.hasMore, previous.hasMore),
    activeLeafId: foldedActiveLeaf(previous.activeLeafId, incoming.activeLeafId, held, incomingMessages, merged.rebased),
    rebased: merged.rebased,
  };
}

export interface FoldedConfirmation<T> {
  messages: T[];
  /** Id of the held optimistic row this confirmation replaced or removed. */
  optimisticId: string | null;
  /** The server's row id is already held, so this delivery repeats one already folded in. */
  duplicate: boolean;
}

/**
 * Puts the server's confirmed row where its optimistic copy stood. A repeat of a row that is already held still removes
 * the optimistic copy, so a resync that raced the send cannot leave both on screen.
 */
export function foldConfirmedMessage<T extends Pick<Message, "id" | "sendId">>(held: readonly T[], confirmed: T): FoldedConfirmation<T> {
  const optimisticId = confirmed.sendId ? optimisticMessageId(confirmed.sendId) : null;
  const optimistic = optimisticId !== null && held.some((message) => message.id === optimisticId);
  if (held.some((message) => message.id === confirmed.id)) {
    return { messages: optimistic ? held.filter((message) => message.id !== optimisticId) : [...held], optimisticId: optimistic ? optimisticId : null, duplicate: true };
  }
  if (optimistic) {
    return { messages: held.map((message) => (message.id === optimisticId ? confirmed : message)), optimisticId, duplicate: false };
  }
  return { messages: [...held, confirmed], optimisticId: null, duplicate: false };
}

/**
 * Removes the held optimistic copies the incoming rows confirm and moves a leaf that stood on one to the server row.
 * Every merge path runs this, so a confirmation arriving through any window cannot leave the message twice.
 */
export function reconcileOptimisticRows<T extends Pick<Message, "id" | "sendId">>(
  held: readonly T[],
  incoming: readonly T[],
  activeLeafId: string | null | undefined,
): { messages: T[]; activeLeafId: string | null | undefined } {
  const confirmed = new Map<string, T>();
  for (const row of incoming) {
    if (!row.sendId) continue;
    const optimisticId = optimisticMessageId(row.sendId);
    if (held.some((message) => message.id === optimisticId)) confirmed.set(optimisticId, row);
  }
  if (confirmed.size === 0) return { messages: held as T[], activeLeafId };
  const messages = held.filter((message) => !confirmed.has(message.id));
  const leaf = activeLeafId && confirmed.get(activeLeafId);
  return { messages, activeLeafId: leaf ? leaf.id : activeLeafId };
}

export function bumpTranscriptGenerations(generation: Record<string, number>, threadIds: readonly string[]): Record<string, number> {
  const unique = new Set(threadIds);
  if (unique.size === 0) return generation;
  return [...unique].reduce((next, threadId) => ({ ...next, [threadId]: (next[threadId] ?? 0) + 1 }), generation);
}

export function bumpTranscriptGeneration(state: AppState, threadId: string | undefined | null): AppState {
  if (!threadId) return state;
  return { ...state, transcriptGeneration: bumpTranscriptGenerations(state.transcriptGeneration, [threadId]) };
}

type ScrollbackState = Pick<AppState, "loadingOlder" | "olderFailed" | "transcriptGeneration" | "bots" | "groups">;

function withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record;
  const { [key]: _dropped, ...rest } = record;
  return rest;
}

/** A branch move retires the old branch's failed page and drops any older page still on the wire for it. */
export function movedBranchTranscript(
  state: Pick<AppState, "transcriptGeneration" | "olderFailed">,
  threadId: string,
): Pick<AppState, "transcriptGeneration" | "olderFailed"> {
  return {
    transcriptGeneration: bumpTranscriptGenerations(state.transcriptGeneration, [threadId]),
    olderFailed: withoutKey(state.olderFailed, threadId),
  };
}

export function beginScrollbackPage(
  state: Pick<AppState, "loadingOlder" | "olderFailed">,
  threadId: string,
): Pick<AppState, "loadingOlder" | "olderFailed"> {
  return {
    loadingOlder: { ...state.loadingOlder, [threadId]: true },
    olderFailed: withoutKey(state.olderFailed, threadId),
  };
}

/**
 * Lands one page fetched before a cursor. Rows the list already has keep their newer copy, an optimistic row the page
 * confirms leaves its server row alone in the list, a page that could not answer leaves `hasMore` alone, and a page that
 * adds nothing while more history exists stops the automatic loop with a retry.
 */
export function applyScrollbackPage(
  state: ScrollbackState,
  page: { threadId: string; generation: number; messages: Message[]; hasMore: boolean; failed?: boolean; canceled?: boolean },
): Partial<Pick<AppState, "loadingOlder" | "olderFailed" | "bots" | "groups">> {
  const { [page.threadId]: _done, ...loadingOlder } = state.loadingOlder;
  if (page.canceled || (state.transcriptGeneration[page.threadId] ?? 0) !== page.generation) return { loadingOlder };
  const owner = [...state.bots, ...state.groups].find((candidate) => candidate.threadId === page.threadId);
  const ownerLeaf = owner && "activeLeafId" in owner ? owner.activeLeafId : undefined;
  const folded = reconcileOptimisticRows(owner?.messages ?? [], page.messages, ownerLeaf);
  const heldIds = new Set(folded.messages.map((message) => message.id));
  const fresh = page.messages.filter((message) => !heldIds.has(message.id));
  const stalled = !page.failed && fresh.length === 0 && page.hasMore;
  const olderFailed = page.failed || stalled
    ? { ...state.olderFailed, [page.threadId]: true as const }
    : withoutKey(state.olderFailed, page.threadId);
  const mergePage = <T extends { threadId: string; messages: Message[]; hasMore?: boolean; activeLeafId?: string | null }>(held: T): T => {
    if (held.threadId !== page.threadId) return held;
    return {
      ...held,
      messages: [...fresh, ...folded.messages],
      hasMore: page.hasMore,
      ...(folded.activeLeafId === held.activeLeafId ? {} : { activeLeafId: folded.activeLeafId }),
    };
  };
  return {
    loadingOlder,
    olderFailed,
    bots: state.bots.map(mergePage),
    groups: state.groups.map(mergePage),
  };
}
