/** The notification wire shape: what the harness decides is worth
 * interrupting someone for, emitted as the `notify` live frame. */
export type NotifyKind =
  | "approval"
  | "question"
  | "done"
  | "routine-failed"
  | "routine-deferred"
  | "turn-failed"
  /** A run failed, stalled or could not start and no Chief of Staff was
   * there to take it: the person is the one who has to look. */
  | "incident"
  /** A bot asked the person to sign in to a website themselves
   * (request_sign_in): it waits on their hands, at the place it works. */
  | "sign-in"
  /** A delegated room request settled and the coordinator auto-resumed with
   * the results; both are internal, so without this the parent conversation
   * sits silent until the resume's first token. */
  | "delegation-settled"
  /** A bot's settled room reply tagged the person (`@you` or their profile name). Rooms only. */
  | "mention"
  /** The workspace crossed its monthly spend warning or reached its cap.
   * Sent to admins only, at most once per month for each. */
  | "spend"
  /** The day's normal news in one banner (Nordus: the decision model held them for the summary). */
  | "daily-digest";

export interface Notification {
  kind: NotifyKind;
  botId: string;
  botName: string;
  threadId: string;
  title: string;
  body: string;
  /** The bot's stored profile image, when it has one; clients show it as
   * the OS notification's icon so every banner carries its bot's face. */
  avatarUrl?: string;
  /** The room this came out of, when the bot was speaking in one. Routing
   * already works off `threadId` alone; this is what lets a client say which
   * room, and stack a room's banners together instead of under the bot. */
  groupId?: string;
  /** Nordus: the decision model's call. urgent shows a banner; normal waits for the daily summary and shows none.
   * Absent is urgent, as before. Noise never becomes a notification. */
  priority?: "urgent" | "normal";
  /** The card's request, on an approval or a question: a tap on the banner scrolls the conversation to that card. */
  requestId?: string;
  /** Nordus: only these people (lowercased emails) receive this notification; absent means everyone who can see the thread. */
  toPersons?: string[];
}

/** A `Notification` as the feed stores it: the live `notify` frame and `GET /api/notifications` carry the same entry. */
export interface NotificationLogEntry extends Notification {
  id: string;
  at: number;
  read: boolean;
  /** When the person answered, or the work moved on: the entry stays in the feed but no longer counts. */
  resolvedAt?: number;
}

/** What the bell and the badge count: news nobody has seen that still waits on someone. */
export function countsAsUnread(entry: NotificationLogEntry): boolean {
  return !entry.read && entry.resolvedAt === undefined;
}

/** Which open notifications a change settles: one card's request, or some kinds in one conversation (for one bot, in a room).
 * A conversation never settles a notification tied to a card: only the card's answer does. */
export type NotificationSettlement = { requestId: string } | { threadId: string; kinds: readonly NotifyKind[]; botId?: string };
