import type { BoardActor, BoardMission, BoardTask } from "../../shared/board.ts";
import { assigneeKind } from "../../shared/board.ts";
import type { ResolvedSender } from "../../shared/wire.ts";
import type { UsageTrigger } from "../usage-ledger.ts";

export interface BoardBot {
  id: string;
  name: string;
  threadId: string;
  /** "internal", "client:<name>" or "open": a bot never reaches work tied to a bot of another bucket unless it is internal. */
  bucket: string;
  hidden?: boolean;
}

export interface BoardRoom {
  id: string;
  name: string;
  threadId: string;
  memberIds: readonly string[];
}

export interface BoardDirectory {
  bot(id: string): BoardBot | undefined;
  bots(): readonly BoardBot[];
  room(id: string): BoardRoom | undefined;
  roomOfThread(threadId: string): BoardRoom | undefined;
  botOfThread(threadId: string): BoardBot | undefined;
}

export interface Seen {
  readonly everything: boolean;
  bot(id: string): boolean;
  thread(id: string): boolean;
  group(id: string): boolean;
}

export interface SendIdentity {
  sender?: ResolvedSender;
  trigger: UsageTrigger;
  personPresent: boolean;
}

export type PersonActor = Extract<BoardActor, { kind: "person" }>;
export type BotActor = Extract<BoardActor, { kind: "bot" }>;

export interface PersonCaller {
  kind: "person";
  actor: PersonActor;
  admin: boolean;
  email?: string;
  seen: Seen;
  identity: SendIdentity;
}

export interface BotCaller {
  kind: "bot";
  actor: BotActor;
  bot: BoardBot;
  threadId: string;
  /** Whom the agent may act on: its team (or one opened to it), same audience, not archived. */
  reaches(botId: string): boolean;
  /** An active section Chief of Staff: the only agent that opens rooms. */
  chief: boolean;
  /** The person reviews what agents say to each other, so the agent cannot start group work on its own. */
  peerReview: boolean;
  section?: string;
  /** A teammate proper, never one that was only opened to the agent's team. */
  teammate(botId: string): boolean;
  /** Takes one of the rooms this turn may still open; false when they are used up. */
  claimRoom(): boolean;
}

export type Caller = PersonCaller | BotCaller;

/** The identity of a signed-in member whose session carries no email: it never matches the owner's. */
export const ANONYMOUS = "anonymous";

const isClientBucket = (bucket: string) => bucket !== "internal";

export function botsTiedTo(task: BoardTask, dir: BoardDirectory): Set<string> {
  const ids = new Set<string>();
  if (task.createdBy.kind === "bot") ids.add(task.createdBy.id);
  if (task.assignee && assigneeKind(task.assignee) === "bot") ids.add(task.assignee);
  const room = (groupId: string | undefined) => {
    for (const id of (groupId ? dir.room(groupId) : undefined)?.memberIds ?? []) ids.add(id);
  };
  for (const ref of [task.source, task.thread]) {
    if (!ref) continue;
    const owner = dir.botOfThread(ref.threadId);
    if (owner) ids.add(owner.id);
    room(ref.groupId ?? dir.roomOfThread(ref.threadId)?.id);
  }
  return ids;
}

function ownsThread(bot: BoardBot, threadId: string | undefined, dir: BoardDirectory): boolean {
  if (!threadId) return false;
  if (dir.botOfThread(threadId)?.id === bot.id) return true;
  return Boolean(dir.roomOfThread(threadId)?.memberIds.includes(bot.id));
}

function reachedByBot(task: BoardTask, bot: BoardBot, dir: BoardDirectory): boolean {
  if (task.assignee === bot.id || (task.createdBy.kind === "bot" && task.createdBy.id === bot.id)) return true;
  if (ownsThread(bot, task.source?.threadId, dir) || ownsThread(bot, task.thread?.threadId, dir)) return true;
  const group = task.source?.groupId ?? task.thread?.groupId;
  return Boolean(group && dir.room(group)?.memberIds.includes(bot.id));
}

export function botSeesTask(task: BoardTask, caller: BotCaller, dir: BoardDirectory): boolean {
  if (!reachedByBot(task, caller.bot, dir)) return false;
  if (!isClientBucket(caller.bot.bucket)) return true;
  for (const id of botsTiedTo(task, dir)) {
    const tied = dir.bot(id);
    if (tied && tied.bucket !== caller.bot.bucket) return false;
  }
  return true;
}

export function botMayChange(task: BoardTask, caller: BotCaller, dir: BoardDirectory, leadOf: (missionId: string) => string | undefined): boolean {
  if (!botSeesTask(task, caller, dir)) return false;
  if (task.assignee === caller.bot.id || (task.createdBy.kind === "bot" && task.createdBy.id === caller.bot.id)) return true;
  if (task.missionId && leadOf(task.missionId) === caller.bot.id) return true;
  return !task.assignee;
}

export function personSeesTask(task: BoardTask, who: PersonCaller, dir: BoardDirectory): boolean {
  if (who.admin) return true;
  if (who.email && (task.assignee === who.email || (task.createdBy.kind === "person" && task.createdBy.id === who.email))) return true;
  if (task.createdBy.kind === "person" && task.createdBy.id === who.actor.id) return true;
  const refs = [task.source, task.thread].filter((ref): ref is NonNullable<typeof ref> => Boolean(ref));
  if (refs.length) return refs.every((ref) => who.seen.thread(ref.threadId) || Boolean(ref.groupId && who.seen.group(ref.groupId)));
  if (task.assignee && assigneeKind(task.assignee) === "bot" && dir.bot(task.assignee) && who.seen.bot(task.assignee)) return true;
  return task.createdBy.kind === "bot" && Boolean(dir.bot(task.createdBy.id)) && who.seen.bot(task.createdBy.id);
}

export function personSeesMission(mission: BoardMission, who: PersonCaller): boolean {
  if (who.admin) return true;
  if (mission.createdBy.kind === "person" && mission.createdBy.id === who.actor.id) return true;
  return who.seen.group(mission.groupId) || who.seen.thread(mission.threadId);
}

export function mayDelete(createdBy: BoardActor, who: PersonCaller): boolean {
  return who.admin || (createdBy.kind === "person" && createdBy.id === who.actor.id);
}

export function sameBucket(bots: readonly BoardBot[]): boolean {
  return bots.every((bot) => bot.bucket === bots[0]?.bucket);
}

export function sameActor(a: BoardActor, b: BoardActor): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind === "system" || (b.kind !== "system" && a.id === b.id);
}
