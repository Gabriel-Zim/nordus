/**
 * Durable payload carried by a profile confirmation card (propose_profile).
 *
 * The fields a bot may propose for itself (`cwd` is the working folder its
 * tools run in; "" means its private workspace; `notifications` and
 * `speakReplies` are the alert and voice toggles). `before` is the snapshot
 * the user was shown; `expectedRevision` is a hash of the target's whole
 * profile at proposal time so a confirmation fails closed if anything moved.
 */
export const PROFILE_REQUEST_FIELDS = ["name", "title", "description", "soul", "cwd", "notifications", "speakReplies"] as const;
export type ProfileRequestField = (typeof PROFILE_REQUEST_FIELDS)[number];
export type ProfileRequestChanges = Partial<Record<Exclude<ProfileRequestField, "notifications" | "speakReplies">, string>> &
  Partial<Record<"notifications" | "speakReplies", boolean>>;

/** What became of one item once the person approved its card. */
export type ProfileItemOutcome =
  | { state: "applied"; appliedAt: number }
  /** The target's profile moved after the card was prepared. */
  | { state: "stale" }
  /** The target bot was deleted. */
  | { state: "gone" }
  /** The target or the change itself was no longer allowed at approval. */
  | { state: "refused"; reason: string };

/** One bot's profile change. `itemId` is what the target's `lastProfileRequestId` records once it applies. */
export interface ProfileChangeItem {
  itemId: string;
  targetBotId: string;
  targetName: string;
  reason: string;
  changes: ProfileRequestChanges;
  before: ProfileRequestChanges;
  expectedRevision: string;
  /** Absent until the person approves. */
  outcome?: ProfileItemOutcome;
}

/** A card written before cards held a list. Still read; nothing writes it. */
export interface ProfileRequestV1 {
  version: 1;
  requestId: string;
  /** The proposing conversation; authority is fixed here. */
  botId: string;
  threadId: string;
  /** Whose profile changes: the proposer, or a section peer named by a Chief. */
  targetBotId: string;
  targetName: string;
  createdAt: number;
  reason: string;
  changes: ProfileRequestChanges;
  before: ProfileRequestChanges;
  expectedRevision: string;
  appliedAt?: number;
  /** Written when the change applied without a person: the profile's
   * revision right after it, so Undo refuses once anything moved. Absent
   * when the before values could not be kept exactly (credential-shaped
   * text is scrubbed from cards), which means no Undo. */
  undo?: { appliedRevision: string };
}

export interface ProfileRequestV2 {
  version: 2;
  /** The card's id, the one an answer names. */
  requestId: string;
  /** The proposing bot; authority is fixed here. */
  botId: string;
  threadId: string;
  createdAt: number;
  /** Names the proposer's turn that opened the card. While that turn runs, its further proposals join this card.
   * Absent: the card never takes another item. */
  turnKey?: string;
  /** In arrival order, at most one per target and at most MAX_PROFILE_BATCH. */
  items: ProfileChangeItem[];
  /** A hash of every item's id and changes. An approval carries the key of the list the person saw. */
  reviewKey: string;
  /** Only on a card that applied without a person, which always holds one item. Same meaning as in v1. */
  undo?: { appliedRevision: string };
}

export type ProfileRequestCardData = ProfileRequestV1 | ProfileRequestV2;

export const MAX_PROFILE_BATCH = 8;

/** The one way to read a card's changes, whatever its version. */
export function profileItems(data: ProfileRequestCardData): ProfileChangeItem[] {
  if (data.version === 2) return data.items;
  return [{
    itemId: data.requestId,
    targetBotId: data.targetBotId,
    targetName: data.targetName,
    reason: data.reason,
    changes: data.changes,
    before: data.before,
    expectedRevision: data.expectedRevision,
    ...(data.appliedAt === undefined ? {} : { outcome: { state: "applied" as const, appliedAt: data.appliedAt } }),
  }];
}

/** What an approval sends back to prove which list it saw; undefined for a card that never grows. */
export function reviewedProfileKey(data: ProfileRequestCardData): string | undefined {
  return data.version === 2 ? data.reviewKey : undefined;
}
