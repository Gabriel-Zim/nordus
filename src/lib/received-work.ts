// Work another bot sent this one lives in a thread of its own; this reads those threads so the main conversation can show it.
import type { Message, Task } from "@/state/store";
import { peerLine, peerRequest } from "./peer-message";

export const RECEIVED_SHOWN = 6;
export const RECEIVED_ROUNDS_SHOWN = 12;

type ReceivedTask = Pick<Task, "threadId" | "openedBy" | "archivedAt" | "busy" | "activity" | "waitingForTeammates" | "updatedAt" | "createdAt">;
type Recipient = { id: string; name: string };

export type ReceivedState =
  | { kind: "queued" }
  | { kind: "working" }
  | { kind: "waiting" }
  | { kind: "returned"; at: number }
  | { kind: "stopped" };

export interface ReceivedAsk {
  id: string;
  at: number;
  text: string;
}

export interface ReceivedRound {
  asks: ReceivedAsk[];
  state: ReceivedState;
  anchorAt: number;
}

const openedAt = (task: ReceivedTask) => task.updatedAt ?? task.openedBy?.at ?? task.createdAt;

/** The conversations other bots opened on this one, newest few, apart from the one open now. Room lanes belong to their
 *  room and a bot's own tasks are not work it received. */
export function receivedTasks<T extends ReceivedTask>(
  bot: { id: string; threadId: string; tasks?: readonly T[] },
): Array<T & { openedBy: NonNullable<T["openedBy"]> }> {
  const received = (bot.tasks ?? []).filter(
    (task): task is T & { openedBy: NonNullable<T["openedBy"]> } =>
      Boolean(task.openedBy) &&
      task.openedBy!.botId !== bot.id &&
      !task.openedBy!.roomLane &&
      !task.archivedAt &&
      task.threadId !== bot.threadId,
  );
  return received.sort((a, b) => openedAt(b) - openedAt(a)).slice(0, RECEIVED_SHOWN).reverse();
}

function askOf(message: Message, bot: Recipient): ReceivedAsk | null {
  if (message.peerAsk?.incident) return null;
  const peer = peerRequest(message, bot.id) ?? peerLine(message);
  if (!peer || (peer.botId ? peer.botId === bot.id : peer.name === bot.name)) return null;
  const mention = `@${bot.name}`;
  const body = peer.body.startsWith(mention) ? peer.body.slice(mention.length).replace(/^[\s,:]+/, "") : peer.body;
  return { id: message.id, at: message.at, text: body.trim() };
}

const settles = (message: Message): boolean => message.turnSucceeded !== undefined || message.turnTerminal === true;

/** Every round of one received conversation, oldest first: the requests that came back to back, and where each stands.
 *  A round closes at the first message after its asks that settles the turn (the turn's last text, or its outcome), so the
 *  next request opens another. Texts a bot writes mid-turn settle nothing. A closed round is returned, or stopped when
 *  the turn failed. Only the last, still open round takes the live state of the task. A settling message with no request
 *  before it belongs to a round the page started in the middle of, and is left out.
 *  `messages` is a page from the end of the thread, oldest first. */
export function receivedRounds(task: ReceivedTask, messages: readonly Message[], bot: Recipient): ReceivedRound[] {
  type Open = { asks: ReceivedAsk[]; settled?: Message; afterAsk: boolean };
  const rounds: Open[] = [];
  for (const message of messages) {
    const ask = askOf(message, bot);
    const current = rounds.at(-1);
    if (ask) {
      if (current && !current.settled) {
        current.asks.push(ask);
        current.afterAsk = false;
      } else rounds.push({ asks: [ask], afterAsk: false });
    } else if (current && !current.settled) {
      current.afterAsk = true;
      if (settles(message)) current.settled = message;
    }
  }
  const busy = task.busy ?? (task.activity === "working" || task.activity === "waiting-on-you");
  return rounds.map((round): ReceivedRound => {
    const anchorAt = round.asks[0]!.at;
    const { settled } = round;
    if (settled) {
      const state: ReceivedState = settled.turnSucceeded === false ? { kind: "stopped" } : { kind: "returned", at: settled.turnCompletedAt ?? settled.at };
      return { asks: round.asks, anchorAt, state };
    }
    if (busy || task.waitingForTeammates) {
      return { asks: round.asks, anchorAt, state: busy && task.activity === "waiting-on-you" ? { kind: "waiting" } : { kind: "working" } };
    }
    return { asks: round.asks, anchorAt, state: round.afterAsk ? { kind: "stopped" } : { kind: "queued" } };
  });
}

/** The newest `limit` blocks across every conversation, oldest first. */
export function newestRounds<T extends { anchorAt: number }>(blocks: readonly T[], limit = RECEIVED_ROUNDS_SHOWN): T[] {
  return [...blocks].sort((a, b) => a.anchorAt - b.anchorAt).slice(-limit);
}

/** For each block, the index of the transcript item it follows (-1: before the first). A block older than every loaded
 *  item is left out while older messages remain unloaded, and one newer than the last item while newer ones are hidden,
 *  since it belongs somewhere not on screen. */
export function placeReceived<T extends { anchorAt: number }>(
  itemTimes: readonly number[],
  blocks: readonly T[],
  hidden: { older: boolean; newer: boolean },
): Array<{ block: T; after: number }> {
  const placed: Array<{ block: T; after: number }> = [];
  for (const block of [...blocks].sort((a, b) => a.anchorAt - b.anchorAt)) {
    let after = -1;
    for (let i = 0; i < itemTimes.length; i++) if (itemTimes[i]! <= block.anchorAt) after = i;
    if (after === -1 && hidden.older) continue;
    if (after === itemTimes.length - 1 && hidden.newer && itemTimes.length > 0 && block.anchorAt > itemTimes[after]!) continue;
    placed.push({ block, after });
  }
  return placed;
}
