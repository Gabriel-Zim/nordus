import type { AppState, Message } from "./store";

/** A conversation that is not on screen keeps this many recent messages; opening it pages the rest from the server. */
export const OFFSCREEN_TAIL = 40;
/** A long turn, a pending send or an approval chip cannot make an unopened conversation hold more than this; see `needsThePerson`. */
export const OFFSCREEN_HARD_CAP = 200;

/** A question, password or sign-in the person has not answered yet. These are never cut. */
export function needsThePerson(message: Message): boolean {
  if (message.kind === "options") return Boolean(message.card && !message.card.answered && !message.card.dismissed && !message.card.expired);
  if (message.kind === "secret") return Boolean(message.secret && !message.secret.provided && !message.secret.dismissed && !message.secret.superseded);
  if (message.kind === "signin") {
    const card = message.signIn;
    return Boolean(card && !card.done && !card.cancelled && !card.superseded && !card.stopped);
  }
  return false;
}

/** Still in flight: a send not yet confirmed, a queued message, a room goal at work, or anything waiting on the person. */
export function isPendingMessage(message: Message): boolean {
  return Boolean(
    message.queued ||
      message.id.startsWith("optimistic-") ||
      (message.kind === "goal.run" && (message.goalRun?.status === "working" || message.goalRun?.status === "needs-input")) ||
      // The server never clears this flag on a tool chip, so it only holds the chip within the hard cap.
      message.tool?.awaitingApproval ||
      needsThePerson(message),
  );
}

type Owner = { threadId: string; messages: Message[]; hasMore?: boolean };

const firstIndex = (messages: Message[], match: (message: Message) => boolean) => {
  const index = messages.findIndex(match);
  return index < 0 ? messages.length : index;
};

/**
 * Keeps the newest messages, the whole turn since the person last spoke, and everything from the oldest pending one
 * on. The cut is a contiguous prefix, so the server's "before the oldest held message" page refills exactly what went.
 */
export function retainedTail<T extends Owner>(owner: T): T {
  const { messages } = owner;
  if (messages.length <= OFFSCREEN_TAIL) return owner;
  let lastSpoke = messages.length;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.role === "user" && message.kind === "text") {
      lastSpoke = index;
      break;
    }
  }
  const keepFrom = Math.min(messages.length - OFFSCREEN_TAIL, lastSpoke, firstIndex(messages, isPendingMessage));
  const cut = Math.min(Math.max(messages.length - OFFSCREEN_HARD_CAP, keepFrom), firstIndex(messages, needsThePerson));
  if (cut <= 0) return owner;
  return { ...owner, messages: messages.slice(cut), hasMore: true };
}

/** Trims every bot and room that is not the open one. Returns the same state when nothing was trimmed. */
export function retainOffscreenMessages(state: AppState): AppState {
  const trim = <T extends Owner & { id: string }>(owners: T[]): T[] => {
    let changed = false;
    const next = owners.map((owner) => {
      if (owner.id === state.selectedId || owner.messages.length <= OFFSCREEN_TAIL || state.loadingOlder[owner.threadId]) return owner;
      const kept = retainedTail(owner);
      if (kept !== owner) changed = true;
      return kept;
    });
    return changed ? next : owners;
  };
  const bots = trim(state.bots);
  const groups = trim(state.groups);
  return bots === state.bots && groups === state.groups ? state : { ...state, bots, groups };
}
