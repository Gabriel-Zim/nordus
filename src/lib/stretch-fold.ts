import type { Message } from "@/state/store";

export interface StretchFold {
  /** The newest line of each group, with how many lines the group holds. */
  counts: ReadonlyMap<string, number>;
  /** Every line that gives way to a newer one in its group. */
  folded: ReadonlySet<string>;
  /** The newest line's id to every id in its group, oldest first, the newest included. */
  members: ReadonlyMap<string, readonly string[]>;
}

const isPersonMessage = (message: Message) => message.role === "user" && message.kind !== "activity" && !message.from && !message.peerAsk;

/** Groups lines that share a key within one stretch between the person's messages; the newest line of a group stands for it. */
export function foldPerStretch(messages: readonly Message[], keyOf: (message: Message) => string | null): StretchFold {
  const groups = new Map<string, string[]>();
  let stretch = 0;
  for (const message of messages) {
    if (isPersonMessage(message)) {
      stretch += 1;
      continue;
    }
    const key = keyOf(message);
    if (key === null) continue;
    const slot = `${stretch}|${key}`;
    const ids = groups.get(slot);
    if (ids) ids.push(message.id);
    else groups.set(slot, [message.id]);
  }
  const counts = new Map<string, number>();
  const folded = new Set<string>();
  const members = new Map<string, readonly string[]>();
  for (const ids of groups.values()) {
    const newest = ids.at(-1)!;
    counts.set(newest, ids.length);
    members.set(newest, ids);
    for (const id of ids.slice(0, -1)) folded.add(id);
  }
  return { counts, folded, members };
}
