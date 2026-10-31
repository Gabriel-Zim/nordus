import { sameAudience } from "../bot-visibility.ts";
import type { HandoffView } from "../coordinator.ts";
import { canAccessTeam, coordinatorSupervises } from "../peer-roster.ts";
import type { BotRecord, GroupRecord, Store } from "../store.ts";

export interface RoomAccessDeps {
  store: Store;
}

/** The one copy of "may this bot speak into this room". Every caller — the bot's post_to_room tool, a
 *  webhook's room delivery — maps these problems to its own audience's wording; none adds a rule. */
export type RoomTalksVerdict =
  | { ok: true }
  | { ok: false; problem: "dm" }
  | { ok: false; problem: "not-member" }
  | { ok: false; problem: "outsider"; name: string }
  | { ok: false; problem: "setup" };

export function createRoomAccess({ store }: RoomAccessDeps) {
  function roomRootProblem(node: Pick<HandoffView, "groupId" | "threadId" | "botId">): string | undefined {
    const group = node.groupId ? store.group(node.groupId) : undefined;
    const bot = store.bot(node.botId);
    if (!bot || bot.hidden) return "The addressed agent no longer exists";
    if (!group || !(group.dm ? group.threadId === node.threadId : store.groupTaskByThread(group.id, node.threadId))) return "Destination room task no longer exists";
    if (!group.memberIds.includes(bot.id)) return "The addressed agent is no longer a member of this room";
    return undefined;
  }
  function roomHandoffProblem(node: Pick<HandoffView, "groupId" | "threadId" | "botId"> & Partial<Pick<HandoffView, "kind">>, parent?: Pick<HandoffView, "groupId" | "threadId" | "botId">): string | undefined {
    const group = node.groupId ? store.group(node.groupId) : undefined;
    const bot = store.bot(node.botId);
    if (!bot) return "The addressed agent no longer exists";
    if (node.groupId && (!group || group.dm || !store.groupTaskByThread(group.id, node.threadId))) return "Destination room task no longer exists";
    if (!node.groupId && !store.taskByThread(bot.id, node.threadId)) return "Destination bot task no longer exists";
    if (group && !group.memberIds.includes(bot.id)) return "The addressed agent is no longer a member of this room";
    // A room job in a thread of its own still answers to its room: a member who left it stops.
    const laneThread = laneRoomThread(node);
    const laneRoom = laneThread ? store.groupByThread(laneThread) : undefined;
    if (laneRoom && !laneRoom.dm && !laneRoom.memberIds.includes(bot.id)) return "The addressed agent is no longer a member of this room";
    if (group && roomSetupPending(group)) return "Destination room setup is unfinished";
    if (parent) {
      const from = store.bot(parent.botId);
      const source = parent.groupId ? store.group(parent.groupId) : undefined;
      if (!from || (parent.groupId ? !source || !source.memberIds.includes(from.id) || !store.groupTaskByThread(source.id, parent.threadId) : !store.taskByThread(from.id, parent.threadId))) return "Source membership or task was removed";
      if (!sameAudience(from.visibility, bot.visibility)) return "The recipient is not an allowed peer of the sender";
      // Members of one room work together in it whatever their teams. Talking to a bot is open to everyone, but work that
      // leaves a room still keeps the section boundary of the rooms involved, so one team's room history never reaches another team.
      const sameRoom = Boolean(source && group && source.id === group.id && parent.threadId === node.threadId);
      const outsideSection = (room: GroupRecord, speaker: BotRecord) => room.memberIds.some(id => {
        const member = store.bot(id);
        return member && !canAccessTeam(speaker, member.section) && !coordinatorSupervises(member, speaker);
      });
      if (!sameRoom && ((source && outsideSection(source, from)) || (group && outsideSection(group, from)))) {
        return "Room work cannot cross the sender's section boundary";
      }
      if (source && group && source.id === group.id && parent.threadId !== node.threadId) return "Same-room work must stay in the originating conversation";
    }
  }

  function laneRoomThread(n: Pick<HandoffView, "botId" | "threadId" | "groupId">): string | undefined {
    if (n.groupId) return undefined;
    const opener = store.taskByThread(n.botId, n.threadId)?.openedBy;
    return opener?.kind === "work" && opener.roomLane && opener.threadId && store.groupByThread(opener.threadId) ? opener.threadId : undefined;
  }

  function roomTalks(bot: BotRecord, group: GroupRecord): RoomTalksVerdict {
    if (group.dm) return { ok: false, problem: "dm" };
    if (!group.memberIds.includes(bot.id)) return { ok: false, problem: "not-member" };
    const outsider = group.memberIds
      .map((id) => store.bot(id))
      .find((member) => member && !canAccessTeam(bot, member.section) && !coordinatorSupervises(member, bot));
    if (outsider) return { ok: false, problem: "outsider", name: outsider.name };
    if (roomSetupPending(group)) return { ok: false, problem: "setup" };
    return { ok: true };
  }

  function roomSetupPending(group: GroupRecord): boolean {
    const hasMarker =
      Object.prototype.hasOwnProperty.call(group, "setupCompletedAt") ||
      Object.prototype.hasOwnProperty.call(group, "setupSkippedAt");
    return (
      !group.dm &&
      hasMarker &&
      group.setupCompletedAt == null &&
      group.setupSkippedAt == null &&
      store.messagesFor(group.threadId).length === 0
    );
  }

  return { roomRootProblem, roomHandoffProblem, roomSetupPending, roomTalks, laneRoomThread };
}
