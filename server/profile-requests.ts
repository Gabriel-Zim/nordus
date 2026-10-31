// propose_profile cards: everything is re-validated at confirm time, since a card can sit open for days.
import { createHash } from "node:crypto";

import { lineDiff, MAX_DIFF_LINES, soulDiffLines } from "../shared/line-diff.ts";
import { BOT_PROFILE_LIMITS } from "../shared/bot-profile.ts";
import {
  MAX_PROFILE_BATCH,
  PROFILE_REQUEST_FIELDS,
  profileItems,
  type ProfileChangeItem,
  type ProfileRequestCardData,
  type ProfileRequestChanges,
  type ProfileRequestField,
  type ProfileRequestV2,
} from "../shared/profile-request.ts";
import { parseBotProfilePatch, type BotProfilePatchInput } from "./bot-profile.ts";
import { validateBotCwd } from "./bot-cwd.ts";
import { newId } from "./contracts.ts";
import { profileGrant, UNDO_STALE, type DirectApply, type DirectApplyCheck } from "./direct-apply.ts";
import { profileRevision, profileSnapshot } from "./profile-revision.ts";
import { recordProfileChange } from "./profile-versions.ts";
import { redactSecretsInText } from "./redact.ts";
import type { BotRecord } from "./store.ts";

const MAX_REASON = 500;
const STALE = "This bot's profile changed after this card was prepared. Ask the bot to review it and propose again.";
const NO_SUCH_BOT = "That bot no longer exists";
const EXPIRED = "This profile request expired before it was confirmed. Ask for a fresh proposal.";
const LIST_CHANGED = "The list changed while you were reading it. Review it again.";
const STILL_BUILDING = "The bot is still putting this request together. Wait for it to finish, then answer.";
const CARD_GONE = "This profile confirmation card is no longer available";
const LABELS: Record<Exclude<(typeof PROFILE_REQUEST_FIELDS)[number], "soul" | "cwd">, string> = {
  name: "Name",
  title: "Title",
  description: "Description",
  notifications: "Notifications",
  speakReplies: "Speak replies",
};
const PRIVATE_WORKSPACE = "its private workspace";
const CHOOSE_ONE = "Choose at least one of name, title, description, soul, cwd, notifications, speakReplies";
const toggleText = (value: boolean | undefined): string => (value ? "on" : "off");
const TEXT_FIELDS = ["name", "title", "description", "soul"] as const;

export interface OptionCardLike {
  title: string;
  subtitle: string;
  options: string[];
  answered?: string;
  dismissed?: boolean;
  expired?: boolean;
  requestId?: string;
  tool?: string;
  held?: string;
  autoApplied?: boolean;
  undone?: boolean;
  profileRequest?: ProfileRequestCardData;
}

export interface ProfileRequestStore {
  bot(id: string): BotRecord | undefined | null;
  messagesFor(threadId: string): Array<{ id: string; card?: OptionCardLike }>;
  appendMessage(
    threadId: string,
    message: {
      role: "bot";
      kind: "options";
      card: OptionCardLike;
      from?: { botId: string; name: string; color: string };
    },
  ): { id: string };
  patchMessage(threadId: string, messageId: string, patch: { card: OptionCardLike }): { id: string } | null;
  patchBotProfile(id: string, patch: Partial<Pick<BotRecord, "name" | "title" | "description" | "cwd" | "soul" | "notifications" | "speakReplies" | "lastProfileRequestId">>): BotRecord | null;
}

export interface ProfileRequestServiceOptions {
  store: ProfileRequestStore;
  now?: () => number;
  /** Server-owned, never request input. */
  autoApply?: DirectApplyCheck;
  canPersist?: (botId: string, threadId: string, opensCard: boolean) => { ok: true } | { ok: false; status: number; error: string };
  /** Chief targeting another bot: returns a refusal sentence or null. Checked at propose AND confirm. */
  validateTarget?: (proposerBotId: string, targetBotId: string) => string | null;
  /** Server-owned: whether the turn a card's `turnKey` names is still running in that conversation. */
  turnIsLive?: (threadId: string, turnKey: string) => boolean;
}

export class ProfileRequestError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "ProfileRequestError";
    this.status = status;
  }
}

export type ResolveProfileRequestResult =
  | { claimed: false; state: "not_found" }
  | { claimed: true; state: "invalid"; error: string; status: number }
  | { claimed: true; state: "already_settled"; behavior: string }
  | { claimed: true; state: "denied" }
  | {
    claimed: true;
    state: "applied";
    applied: Array<{ targetBotId: string; fields: ProfileRequestField[] }>;
    skipped: Array<{ targetName: string; state: "stale" | "gone" | "refused" }>;
    settlementPending?: true;
    message?: string;
  };

export type UndoProfileRequestResult =
  | { claimed: false }
  | { claimed: true; state: "already_undone" }
  | { claimed: true; state: "invalid"; error: string; status: number; stale?: true }
  | { claimed: true; state: "undone"; targetBotId: string };

interface ProfileCardCopy {
  title: string;
  summary: string;
  detail: string;
}

interface Proposal extends ProfileCardCopy {
  requestId: string;
  messageId: string;
}

export type ProfileSubmitResult =
  | (Proposal & { state: "applied"; result: Extract<ResolveProfileRequestResult, { state: "applied" }>; appliedBy: DirectApply })
  | (Proposal & { state: "pending"; batch: { joined: boolean; count: number; targets: string[] } });

interface ProposeArgs {
  botId: string;
  threadId: string;
  targetBotId?: string;
  changes: unknown;
  reason: unknown;
  from?: { botId: string; name: string; color: string };
  /** The proposer's internal turn, when the call proved one. Proposals of one turn share a card. */
  turn?: string;
}

type ItemStep =
  | { outcome: Extract<ProfileChangeItem["outcome"], { state: "applied" }>; wrote: boolean }
  | { outcome: Exclude<ProfileChangeItem["outcome"], { state: "applied" } | undefined>; error: string; status: number };

function reasonText(value: unknown): string {
  if (typeof value !== "string") throw new ProfileRequestError("reason is required");
  const trimmed = value.trim();
  if (!trimmed) throw new ProfileRequestError("reason is required");
  if (trimmed.length > MAX_REASON) {
    throw new ProfileRequestError(`reason must be ${MAX_REASON} characters or fewer`);
  }
  return redactSecretsInText(trimmed);
}

/** parseBotProfilePatch accepts keys (like `voice`) a profile request must not carry: reject them first. */
function parseChanges(input: unknown): ProfileRequestChanges {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new ProfileRequestError(CHOOSE_ONE);
  }
  const keys = Object.keys(input);
  for (const key of keys) {
    if (!(PROFILE_REQUEST_FIELDS as readonly string[]).includes(key)) {
      throw new ProfileRequestError(`unsupported profile field: ${key}`);
    }
  }
  if (keys.length === 0) {
    throw new ProfileRequestError(CHOOSE_ONE);
  }
  const { cwd: rawCwd, ...profileInput } = input as Record<string, unknown>;
  let cwdChange: string | undefined;
  if (rawCwd !== undefined) {
    const checked = validateBotCwd(rawCwd);
    if (!checked.ok) throw new ProfileRequestError(checked.error, 400);
    cwdChange = checked.cwd ?? "";
  }
  const parsed = Object.keys(profileInput).length
    ? parseBotProfilePatch(profileInput as BotProfilePatchInput, true)
    : { ok: true as const, patch: {} as Partial<Record<string, unknown>> };
  if (!parsed.ok) throw new ProfileRequestError(parsed.error, 400);
  const changes: ProfileRequestChanges = {};
  if (cwdChange !== undefined) changes.cwd = cwdChange;
  for (const field of PROFILE_REQUEST_FIELDS) {
    if (field === "cwd") continue;
    const value = parsed.patch[field];
    if (field === "notifications" || field === "speakReplies") {
      if (value !== undefined) changes[field] = value as boolean;
      continue;
    }
    // Hidden under the card's visible fields, where the store's shallow card redaction cannot reach.
    if (typeof value !== "string") continue;
    const redacted = redactSecretsInText(value);
    // A redaction mask can be longer than the secret, so the cap is checked again after scrubbing.
    if (field === "soul") {
      if (Buffer.byteLength(redacted, "utf8") > BOT_PROFILE_LIMITS.soul) {
        throw new ProfileRequestError("standing instructions must be at most 24000 bytes");
      }
    } else {
      const limit = BOT_PROFILE_LIMITS[field];
      if (redacted.length > limit) {
        throw new ProfileRequestError(`${field} must be at most ${limit} characters`);
      }
    }
    changes[field] = redacted;
  }
  return changes;
}

const FIELD_NAMES: Record<ProfileRequestField, string> = {
  name: "name",
  title: "title",
  description: "description",
  soul: "standing instructions",
  cwd: "working folder",
  notifications: "notifications",
  speakReplies: "spoken replies",
};

function changeLines(
  name: string,
  before: ProfileRequestChanges,
  changes: ProfileRequestChanges,
  soulLines: (before: string, after: string) => string[],
): string[] {
  const lines: string[] = [];
  for (const field of PROFILE_REQUEST_FIELDS) {
    if (field === "soul" || field === "cwd") continue;
    if (changes[field] === undefined) continue;
    if (field === "notifications" || field === "speakReplies") {
      lines.push(`${LABELS[field]}: ${toggleText(before[field] as boolean | undefined)} → ${toggleText(changes[field] as boolean | undefined)}`);
      continue;
    }
    lines.push(`${LABELS[field]}: "${before[field] ?? ""}" → "${changes[field]}"`);
  }
  if (changes.cwd !== undefined) {
    lines.push(`Working folder: ${before.cwd || PRIVATE_WORKSPACE} → ${changes.cwd || PRIVATE_WORKSPACE}`);
  }
  if (changes.soul !== undefined) lines.push(...soulLines(before.soul ?? "", changes.soul));
  if (changes.cwd !== undefined) lines.push(`${name}'s tools will read and write files in that folder.`);
  return lines;
}

const changesText = (changes: ProfileRequestChanges) => TEXT_FIELDS.some((field) => changes[field] !== undefined);

export function profileCardCopy(
  target: { name: string; crossBot: boolean },
  fullProfile: { title: string; description: string; soul: string },
  before: ProfileRequestChanges,
  changes: ProfileRequestChanges,
  reason: string,
): ProfileCardCopy {
  const isSetup = !fullProfile.title && !fullProfile.description && !fullProfile.soul;
  const title = target.crossBot
    ? `Update @${target.name}'s profile?`
    : isSetup
      ? `Set up ${target.name}?`
      : `Update ${target.name}'s profile?`;

  const lines: string[] = target.crossBot ? [`Whose profile: @${target.name}`, `Why: ${reason}`] : [`Why: ${reason}`];
  lines.push(...changeLines(target.name, before, changes, soulDiffLines));
  lines.push(changesText(changes) ? `Changes what ${target.name} is told on every turn. Nothing runs.` : "Nothing runs.");
  const detail = lines.join("\n");

  const fields = PROFILE_REQUEST_FIELDS.filter((field) => changes[field] !== undefined);
  const summary = `${title} · ${fields.join(", ")}`;
  return { title, summary, detail };
}

/** Every changed line stays, since any of them may be what is being approved; only runs of unchanged lines fold away. */
function changedSoulLines(before: string, after: string): string[] {
  const lines = soulDiffLines(before, after);
  const diff = lineDiff(before, after);
  if (diff.length > MAX_DIFF_LINES) return lines;
  const out = [lines[0]!];
  let same = 0;
  const fold = () => {
    if (same) out.push(`  (${same} unchanged ${same === 1 ? "line" : "lines"})`);
    same = 0;
  };
  for (const line of diff) {
    if (line.startsWith(" ")) {
      same++;
      continue;
    }
    fold();
    out.push(line);
  }
  fold();
  return out;
}

function batchCardCopy(items: ProfileChangeItem[]): ProfileCardCopy {
  const title = `Update ${items.length} bot profiles?`;
  const lines: string[] = [];
  for (const item of items) {
    const fields = PROFILE_REQUEST_FIELDS.filter((field) => item.changes[field] !== undefined);
    lines.push(
      `@${item.targetName}: ${fields.map((field) => FIELD_NAMES[field]).join(", ")}`,
      `Why: ${item.reason}`,
      ...changeLines(item.targetName, item.before, item.changes, changedSoulLines),
      "",
    );
  }
  lines.push(items.some((item) => changesText(item.changes)) ? "Changes what these bots are told on every turn. Nothing runs." : "Nothing runs.");
  return { title, summary: `${title} · ${items.map((item) => `@${item.targetName}`).join(", ")}`, detail: lines.join("\n") };
}

export function profileTurnKey(turn: string): string {
  return createHash("sha256").update(turn, "utf8").digest("hex").slice(0, 32);
}

export function profileReviewKey(items: ProfileChangeItem[]): string {
  return createHash("sha256").update(JSON.stringify(items.map((item) => [item.itemId, item.changes])), "utf8").digest("hex");
}

/** A target proposed twice in one turn keeps only its latest change, in its first place. */
export function withItem(items: ProfileChangeItem[], item: ProfileChangeItem): ProfileChangeItem[] {
  const index = items.findIndex((candidate) => candidate.targetBotId === item.targetBotId);
  return index < 0 ? [...items, item] : items.map((candidate, at) => (at === index ? item : candidate));
}

function asV2(payload: ProfileRequestCardData): ProfileRequestV2 {
  if (payload.version === 2) return payload;
  const items = profileItems(payload);
  return {
    version: 2, requestId: payload.requestId, botId: payload.botId, threadId: payload.threadId, createdAt: payload.createdAt,
    items, reviewKey: profileReviewKey(items), ...(payload.undo ? { undo: payload.undo } : {}),
  };
}

const appliedFields = (item: ProfileChangeItem) => PROFILE_REQUEST_FIELDS.filter((field) => item.changes[field] !== undefined);

export class ProfileRequestService {
  private readonly store: ProfileRequestStore;
  private readonly now: () => number;
  private readonly canPersist?: ProfileRequestServiceOptions["canPersist"];
  private readonly autoApply?: ProfileRequestServiceOptions["autoApply"];
  private readonly turnIsLive?: ProfileRequestServiceOptions["turnIsLive"];
  validateTarget?: ProfileRequestServiceOptions["validateTarget"];

  constructor(options: ProfileRequestServiceOptions) {
    this.store = options.store;
    this.now = options.now ?? Date.now;
    this.canPersist = options.canPersist;
    this.autoApply = options.autoApply;
    this.turnIsLive = options.turnIsLive;
    this.validateTarget = options.validateTarget;
  }

  /** Always leaves a card for the person. */
  propose(args: Omit<ProposeArgs, "turn">): ProfileSubmitResult {
    return this.prepare(args);
  }

  submit(args: ProposeArgs): ProfileSubmitResult {
    return this.prepare(args, true);
  }

  private prepare(args: ProposeArgs, submitted = false): ProfileSubmitResult {
    const reason = reasonText(args.reason);
    const changes = parseChanges(args.changes);

    const targetBotId = args.targetBotId ?? args.botId;
    const target = this.store.bot(targetBotId);
    if (!target) throw new ProfileRequestError(NO_SUCH_BOT, 404);
    const crossBot = targetBotId !== args.botId;
    if (crossBot && this.validateTarget) {
      const refusal = this.validateTarget(args.botId, targetBotId);
      if (refusal) throw new ProfileRequestError(refusal, 403);
    }

    const snapshot = profileSnapshot(target);
    const before: ProfileRequestChanges = {};
    const finalChanges: ProfileRequestChanges = {};
    let exactBefore = true;
    for (const field of PROFILE_REQUEST_FIELDS) {
      if (field === "notifications" || field === "speakReplies") {
        const value = changes[field];
        if (value === undefined || value === snapshot[field]) continue;
        before[field] = snapshot[field];
        finalChanges[field] = value;
      } else {
        const value = changes[field];
        if (value === undefined || value === snapshot[field]) continue;
        before[field] = redactSecretsInText(snapshot[field]);
        if (before[field] !== snapshot[field]) exactBefore = false;
        finalChanges[field] = value;
      }
    }
    if (Object.keys(finalChanges).length === 0) {
      throw new ProfileRequestError("Nothing would change");
    }

    const item: ProfileChangeItem = {
      itemId: newId(),
      targetBotId,
      targetName: redactSecretsInText(target.name),
      reason,
      changes: finalChanges,
      before,
      expectedRevision: profileRevision(target),
    };
    const grant = submitted ? profileGrant(this.autoApply?.(args.botId, args.threadId, targetBotId) ?? null, finalChanges) : null;
    if (grant) return this.applyAlone(args, item, exactBefore, grant);

    const turnKey = submitted && args.turn ? profileTurnKey(args.turn) : undefined;
    const open = turnKey ? this.openBatch(args.threadId, args.botId, turnKey) : undefined;
    const joined = open && withItem(open.payload.items, item);
    if (open && joined && joined.length <= MAX_PROFILE_BATCH) {
      this.persist(args, false);
      const copy = this.cardCopy(args.botId, joined);
      const payload: ProfileRequestV2 = { ...open.payload, items: joined, reviewKey: profileReviewKey(joined) };
      const saved = this.store.patchMessage(args.threadId, open.messageId, {
        card: { ...open.card, title: copy.title, subtitle: copy.detail, profileRequest: payload },
      });
      if (!saved) throw new ProfileRequestError(CARD_GONE, 409);
      return { ...copy, state: "pending", requestId: payload.requestId, messageId: open.messageId, batch: this.batchOf(true, joined) };
    }

    this.persist(args, true);
    const requestId = newId();
    const items = [item];
    const payload: ProfileRequestV2 = {
      version: 2, requestId, botId: args.botId, threadId: args.threadId, createdAt: this.now(),
      ...(turnKey ? { turnKey } : {}), items, reviewKey: profileReviewKey(items),
    };
    const copy = this.cardCopy(args.botId, items);
    const message = this.append(args, {
      title: copy.title, subtitle: copy.detail, options: ["Confirm", "Cancel"], requestId, tool: "update_profile", profileRequest: payload,
    });
    return { ...copy, state: "pending", requestId, messageId: message.id, batch: this.batchOf(false, items) };
  }

  /** The card a turn's next proposal joins: the proposer's own, opened by that same turn, unanswered, its approval not started. */
  private openBatch(threadId: string, botId: string, turnKey: string): { messageId: string; card: OptionCardLike; payload: ProfileRequestV2 } | undefined {
    const messages = this.store.messagesFor(threadId);
    for (let index = messages.length - 1; index >= 0; index--) {
      const { id, card } = messages[index]!;
      const payload = card?.profileRequest;
      if (payload?.version !== 2 || payload.botId !== botId || payload.turnKey !== turnKey) continue;
      if (card!.answered || card!.dismissed || card!.expired || this.approvalStarted(payload.items)) continue;
      return { messageId: id, card: card!, payload };
    }
    return undefined;
  }

  private approvalStarted(items: ProfileChangeItem[]): boolean {
    return items.some((item) => item.outcome || this.store.bot(item.targetBotId)?.lastProfileRequestId === item.itemId);
  }

  private applyAlone(args: ProposeArgs, item: ProfileChangeItem, exactBefore: boolean, grant: DirectApply): ProfileSubmitResult {
    this.persist(args, false);
    const requestId = newId();
    const items = [item];
    const payload: ProfileRequestV2 = {
      version: 2, requestId, botId: args.botId, threadId: args.threadId, createdAt: this.now(), items, reviewKey: profileReviewKey(items),
    };
    const copy = this.cardCopy(args.botId, items);
    // The hidden receipt is persisted before the profile changes.
    const message = this.append(args, {
      title: copy.title, subtitle: copy.detail, options: [], dismissed: true, requestId, tool: "update_profile", profileRequest: payload,
    });
    const result = this.resolve({ botId: args.botId, threadId: args.threadId, requestId, behavior: "allow" });
    if (result.state === "applied") {
      if (!result.settlementPending) this.recordAutoApplied(args.threadId, message.id, item.targetBotId, exactBefore);
      return { ...copy, state: "applied", requestId, messageId: message.id, result, appliedBy: grant };
    }
    throw new ProfileRequestError(result.state === "invalid" ? result.error : "The profile change could not be applied", result.state === "invalid" ? result.status : 409);
  }

  private persist(args: ProposeArgs, opensCard: boolean): void {
    const persistence = this.canPersist?.(args.botId, args.threadId, opensCard);
    if (persistence && !persistence.ok) throw new ProfileRequestError(persistence.error, persistence.status);
  }

  private append(args: ProposeArgs, card: OptionCardLike): { id: string } {
    const messageInput: Parameters<ProfileRequestStore["appendMessage"]>[1] = { role: "bot", kind: "options", card };
    if (args.from) messageInput.from = args.from;
    return this.store.appendMessage(args.threadId, messageInput);
  }

  private batchOf(joined: boolean, items: ProfileChangeItem[]) {
    return { joined, count: items.length, targets: items.map((item) => item.targetName) };
  }

  private cardCopy(proposerId: string, items: ProfileChangeItem[]): ProfileCardCopy {
    if (items.length > 1) return batchCardCopy(items);
    const item = items[0]!;
    const target = this.store.bot(item.targetBotId);
    const profile = target ? profileSnapshot(target) : { title: "", description: "", soul: "" };
    return profileCardCopy({ name: item.targetName, crossBot: item.targetBotId !== proposerId }, profile, item.before, item.changes, item.reason);
  }

  private recordAutoApplied(threadId: string, messageId: string, targetBotId: string, exactBefore: boolean): void {
    try {
      const card = this.store.messagesFor(threadId).find((candidate) => candidate.id === messageId)?.card;
      const target = this.store.bot(targetBotId);
      if (!card?.profileRequest || !target) return;
      this.store.patchMessage(threadId, messageId, {
        card: {
          ...card,
          autoApplied: true,
          profileRequest: { ...card.profileRequest, ...(exactBefore ? { undo: { appliedRevision: profileRevision(target) } } : {}) },
        },
      });
    } catch {
    }
  }

  undo(args: { botId: string; threadId: string; requestId: string }): UndoProfileRequestResult {
    const message = this.store
      .messagesFor(args.threadId)
      .find((candidate) => candidate.card?.requestId === args.requestId && candidate.card.profileRequest);
    const card = message?.card;
    const payload = card?.profileRequest;
    if (!message || !card || !payload) return { claimed: false };
    if (card.undone) return { claimed: true, state: "already_undone" };
    const cannot = (error: string, status = 409): UndoProfileRequestResult => ({ claimed: true, state: "invalid", error, status });
    const items = profileItems(payload);
    if (!card.autoApplied || card.answered !== "allow" || items.length !== 1) return cannot("Only a change that applied on its own can be undone here.");
    if (payload.botId !== args.botId || payload.threadId !== args.threadId) {
      return cannot("This profile change belongs to another conversation", 403);
    }
    if (!payload.undo) return cannot("This change can't be undone here.");
    const item = items[0]!;
    const target = this.store.bot(item.targetBotId);
    if (!target || profileRevision(target) !== payload.undo.appliedRevision) {
      return { claimed: true, state: "invalid", error: UNDO_STALE, status: 409, stale: true };
    }
    const { cwd, ...rest } = item.before;
    const patch: Parameters<ProfileRequestStore["patchBotProfile"]>[1] = {};
    for (const field of PROFILE_REQUEST_FIELDS) {
      if (field === "cwd" || item.changes[field] === undefined) continue;
      (patch as Record<string, unknown>)[field] = rest[field];
    }
    if (item.changes.cwd !== undefined) {
      const checked = validateBotCwd(cwd || null);
      if (!checked.ok) return cannot(checked.error);
      patch.cwd = checked.cwd ?? undefined;
    }
    if (!this.store.patchBotProfile(target.id, patch)) return cannot(NO_SUCH_BOT, 404);
    recordProfileChange(target.id, "user", `undo:${message.id}`, item.changes, item.before);
    this.store.patchMessage(args.threadId, message.id, { card: { ...card, undone: true } });
    return { claimed: true, state: "undone", targetBotId: target.id };
  }

  /** Claims a card even after it settled, so a duplicate click never re-applies a change. */
  resolve(args: {
    botId: string;
    threadId: string;
    requestId: string;
    behavior: string | undefined;
    /** The review key of the list the person saw. */
    reviewedSha256?: string;
  }): ResolveProfileRequestResult {
    const message = this.store
      .messagesFor(args.threadId)
      .find((candidate) => candidate.card?.requestId === args.requestId && candidate.card.profileRequest);
    const card = message?.card;
    const payload = card?.profileRequest;
    if (!message || !card || !payload) return { claimed: false, state: "not_found" };
    if (payload.requestId !== card.requestId) {
      return { claimed: true, state: "invalid", error: "This profile request does not match its card", status: 409 };
    }

    if (args.behavior !== "allow" && args.behavior !== "deny") {
      return { claimed: true, state: "invalid", error: "Profile confirmations must be confirmed or cancelled", status: 400 };
    }
    if (payload.botId !== args.botId || payload.threadId !== args.threadId) {
      return { claimed: true, state: "invalid", error: "This profile request belongs to another conversation", status: 403 };
    }
    if (card.answered) return { claimed: true, state: "already_settled", behavior: card.answered };
    if (card.expired) return { claimed: true, state: "invalid", error: EXPIRED, status: 409 };

    const data = asV2(payload);
    if (args.behavior === "deny") {
      // A refusal applies nothing more; items an interrupted approval already saved keep their outcome, so the card tells the truth.
      const items = data.items.map((item) => item.outcome || this.store.bot(item.targetBotId)?.lastProfileRequestId !== item.itemId
        ? item
        : { ...item, outcome: { state: "applied" as const, appliedAt: this.now() } });
      const profileRequest = items.some((item, at) => item !== data.items[at]) ? { ...data, items } : payload;
      this.store.patchMessage(args.threadId, message.id, { card: { ...card, answered: "deny", held: undefined, profileRequest } });
      return { claimed: true, state: "denied" };
    }
    // An approval already under way is only finished: the list it applies is the one approved first.
    if (payload.version === 2 && !this.approvalStarted(data.items)) {
      if (args.reviewedSha256 !== undefined) {
        if (args.reviewedSha256 !== profileReviewKey(payload.items)) return { claimed: true, state: "invalid", error: LIST_CHANGED, status: 409 };
      } else if (payload.turnKey && this.turnIsLive?.(args.threadId, payload.turnKey)) {
        return { claimed: true, state: "invalid", error: STILL_BUILDING, status: 409 };
      }
    }
    return this.applyItems(args.threadId, message.id, card, data);
  }

  private applyItems(threadId: string, messageId: string, card: OptionCardLike, data: ProfileRequestV2): ResolveProfileRequestResult {
    let items = data.items;
    let wrote = false;
    let firstSkip: { error: string; status: number } | undefined;
    const save = (patch: Partial<OptionCardLike>) => {
      if (!this.store.patchMessage(threadId, messageId, { card: { ...card, ...patch, profileRequest: { ...data, items } } })) {
        throw new ProfileRequestError(CARD_GONE, 409);
      }
    };
    try {
      for (let index = 0; index < items.length; index++) {
        const item = items[index]!;
        if (item.outcome) continue;
        const step = this.applyItem(messageId, data.botId, item);
        if ("wrote" in step) wrote ||= step.wrote;
        else firstSkip ??= { error: step.error, status: step.status };
        items = items.map((candidate, at) => (at === index ? { ...candidate, outcome: step.outcome } : candidate));
        save({});
      }
      const applied = items.filter((item) => item.outcome?.state === "applied");
      if (!applied.length) {
        const skip = firstSkip ?? { error: STALE, status: 409 };
        save({ expired: true, options: [], held: redactSecretsInText(skip.error).slice(0, 500) });
        return { claimed: true, state: "invalid", ...skip };
      }
      save({ answered: "allow", held: undefined });
      if (!wrote) return { claimed: true, state: "already_settled", behavior: "allow" };
      return {
        claimed: true,
        state: "applied",
        applied: applied.map((item) => ({ targetBotId: item.targetBotId, fields: appliedFields(item) })),
        skipped: items.flatMap((item) => item.outcome && item.outcome.state !== "applied" ? [{ targetName: item.targetName, state: item.outcome.state }] : []),
      };
    } catch (error) {
      const status = error instanceof ProfileRequestError ? error.status : 400;
      const detail = error instanceof Error ? error.message : String(error);
      const saved = data.items.filter((item) => item.outcome?.state === "applied" || this.store.bot(item.targetBotId)?.lastProfileRequestId === item.itemId);
      const remaining = data.items.filter((item) => !item.outcome && !saved.includes(item)).length;
      const notice = card.dismissed && card.options.length === 0
        ? "Profile saved. Recording the operation receipt could not finish; the changes will not be applied again."
        : remaining
          ? `Saved ${saved.map((item) => `@${item.targetName}`).join(", ")} before this stopped. Approve to apply the remaining ${remaining === 1 ? "change" : `${remaining} changes`}, or refuse to apply nothing more; saved changes are not applied again.`
          : `${saved.length > 1 ? "Profiles" : "Profile"} saved. Confirm again to finish recording this decision; the changes will not be applied again.`;
      try {
        const latest = this.store.messagesFor(threadId).find((candidate) => candidate.id === messageId)?.card ?? card;
        this.store.patchMessage(threadId, messageId, { card: { ...latest, held: saved.length ? notice : redactSecretsInText(detail).slice(0, 500) } });
      } catch {}
      if (saved.length) return {
        claimed: true, state: "applied",
        applied: saved.map((item) => ({ targetBotId: item.targetBotId, fields: appliedFields(item) })),
        skipped: [], settlementPending: true, message: notice,
      };
      return { claimed: true, state: "invalid", error: detail, status };
    }
  }

  private applyItem(messageId: string, proposerId: string, item: ProfileChangeItem): ItemStep {
    const target = this.store.bot(item.targetBotId);
    // Profile and receipt share one write: an item saved before a crash only records its outcome.
    if (target?.lastProfileRequestId === item.itemId) return { outcome: { state: "applied", appliedAt: this.now() }, wrote: false };
    const refused = (reason: string, status: number): ItemStep => ({ outcome: { state: "refused", reason }, error: reason, status });
    if (!target) return { outcome: { state: "gone" }, error: NO_SUCH_BOT, status: 404 };
    if (item.targetBotId !== proposerId && this.validateTarget) {
      const refusal = this.validateTarget(proposerId, item.targetBotId);
      if (refusal) return refused(refusal, 404);
    }
    if (profileRevision(target) !== item.expectedRevision) return { outcome: { state: "stale" }, error: STALE, status: 409 };

    const { cwd, ...rest } = item.changes;
    let validated: ProfileRequestChanges;
    try {
      validated = Object.keys(rest).length ? parseChanges(rest) : {};
    } catch (error) {
      return refused(error instanceof Error ? error.message : String(error), 409);
    }
    const patch: Parameters<ProfileRequestStore["patchBotProfile"]>[1] = { ...validated, lastProfileRequestId: item.itemId };
    if (cwd !== undefined) {
      const checked = validateBotCwd(cwd || null);
      if (!checked.ok) return refused(checked.error, 409);
      patch.cwd = checked.cwd ?? undefined;
    }
    if (!this.store.patchBotProfile(target.id, patch)) return { outcome: { state: "gone" }, error: NO_SUCH_BOT, status: 404 };
    recordProfileChange(target.id, "bot", `card:${messageId}#${item.itemId}`, item.before, item.changes);
    return { outcome: { state: "applied", appliedAt: this.now() }, wrote: true };
  }
}
