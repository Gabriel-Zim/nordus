import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BoardActor, BoardFrame } from "../../shared/board.ts";
import type { Notification } from "../../shared/notification.ts";
import type { BoardBot, BoardDirectory, BoardRoom, BotCaller, PersonCaller, Seen, SendIdentity } from "../board/directory.ts";
import { createBoardFeature, type BoardFeature, type BoardHost } from "../board/feature.ts";
import type { UsageLine } from "../board/receipt.ts";
import type { BoardSender, SendOutcome } from "../board/send.ts";

export interface Sent {
  to: "bot" | "room";
  botId?: string;
  groupId?: string;
  threadId?: string;
  text: string;
  sendId: string;
  identity: SendIdentity;
}

export interface Visibility {
  everything?: boolean;
  bots?: string[];
  threads?: string[];
  groups?: string[];
}

/** A conversation is visible when it is listed or when the agent or room it belongs to is, as the real visibility works. */
export function seenFrom(visibility: Visibility, dir?: BoardDirectory): Seen {
  const bots = new Set(visibility.bots);
  const threads = new Set(visibility.threads);
  const groups = new Set(visibility.groups);
  const owned = (id: string) => {
    const bot = dir?.botOfThread(id);
    const room = dir?.roomOfThread(id);
    return Boolean((bot && bots.has(bot.id)) || (room && groups.has(room.id)));
  };
  return {
    everything: visibility.everything === true,
    bot: (id) => visibility.everything === true || bots.has(id),
    thread: (id) => visibility.everything === true || threads.has(id) || owned(id),
    group: (id) => visibility.everything === true || groups.has(id),
  };
}

export function boardFixture(options: { limits?: Parameters<typeof createBoardFeature>[0]["limits"]; dataDir?: string } = {}) {
  const dataDir = options.dataDir ?? mkdtempSync(join(tmpdir(), "nordus-board-"));
  const clock = { now: 1_700_000_000_000 };
  const bots = new Map<string, BoardBot>();
  const rooms = new Map<string, BoardRoom>();
  const sent: Sent[] = [];
  const frames: Array<Record<string, unknown>> = [];
  const notices: Notification[] = [];
  const usage: UsageLine[] = [];
  const visibility = new Map<string, Visibility>();
  const script = { outcome: "sent" as SendOutcome["status"], reason: "sem motivo", busy: false, block: null as null | { code: "spend_cap" | "bot_spend_cap"; botName?: string } };
  const roomInputs: Array<Parameters<BoardHost["createRoom"]>[0]> = [];
  let roomCount = 0;

  const dir: BoardDirectory = {
    bot: (id) => bots.get(id),
    bots: () => [...bots.values()],
    room: (id) => rooms.get(id),
    roomOfThread: (threadId) => [...rooms.values()].find((room) => room.threadId === threadId),
    botOfThread: (threadId) => [...bots.values()].find((bot) => bot.threadId === threadId),
  };

  const sender: BoardSender = {
    async toBot({ botId, text, sendId, identity }) {
      sent.push({ to: "bot", botId, text, sendId, identity });
      return script.outcome === "skipped" ? { status: "skipped", reason: script.reason } : { status: script.outcome, threadId: bots.get(botId)?.threadId ?? "t-unknown" };
    },
    async toRoom({ groupId, threadId, text, sendId, identity }) {
      sent.push({ to: "room", groupId, threadId, text, sendId, identity });
      return script.outcome === "skipped" ? { status: "skipped", reason: script.reason } : { status: script.outcome, threadId };
    },
    roomBusy: () => script.busy,
  };

  const feature: BoardFeature = createBoardFeature({
    dataDir,
    dir,
    sender,
    people: () => [{ id: "rafael@zorg.com", name: "Rafael" }, { id: "nina@zorg.com", name: "Nina" }, { id: "carla@cliente.com" }],
    broadcast: (payload) => void frames.push(payload),
    notify: (notification) => void notices.push(notification),
    createRoom: (input) => {
      const { name, memberIds } = input;
      roomInputs.push(input);
      roomCount += 1;
      const id = `room${roomCount}`;
      rooms.set(id, { id, name, threadId: `th-${id}`, memberIds });
      return { groupId: id, threadId: `th-${id}` };
    },
    usage: () => usage,
    identityFor: (actor: BoardActor) => ({ trigger: actor.kind === "person" ? { kind: "user", email: actor.id } : { kind: "owner" }, personPresent: actor.kind === "person" }),
    spendBlock: () => script.block,
    seenBy: (email) => seenFrom(visibility.get(email ?? "") ?? {}, dir),
    now: () => clock.now,
    limits: options.limits,
  });

  const addBot = (id: string, bucket = "internal", extra: Partial<BoardBot> = {}): BoardBot => {
    const bot: BoardBot = { id, name: id[0]!.toUpperCase() + id.slice(1), threadId: `th-${id}`, bucket, ...extra };
    bots.set(id, bot);
    return bot;
  };

  const addRoom = (id: string, memberIds: string[]): BoardRoom => {
    const room: BoardRoom = { id, name: id, threadId: `th-${id}`, memberIds };
    rooms.set(id, room);
    return room;
  };

  const person = (email: string, options: { admin?: boolean; visible?: Visibility } = {}): PersonCaller => {
    const name = email.split("@")[0]!;
    if (options.visible) visibility.set(email, options.visible);
    return {
      kind: "person",
      actor: { kind: "person", id: email, name },
      admin: options.admin === true,
      email,
      seen: options.admin ? seenFrom({ everything: true }) : seenFrom(options.visible ?? {}, dir),
      identity: { sender: { name, ...(options.admin ? { admin: true } : {}) }, trigger: { kind: "user", email }, personPresent: true },
    };
  };

  const botCaller = (botId: string, threadId?: string, reach: string[] = [], extra: Partial<BotCaller> = {}): BotCaller => {
    const bot = bots.get(botId)!;
    return {
      kind: "bot",
      actor: { kind: "bot", id: bot.id, name: bot.name },
      bot,
      threadId: threadId ?? bot.threadId,
      reaches: (id) => reach.includes(id),
      chief: true,
      peerReview: false,
      teammate: (id) => reach.includes(id),
      claimRoom: () => true,
      ...extra,
    };
  };

  const taskFrames = () => frames.filter((frame): frame is BoardFrame & Record<string, unknown> => String(frame.kind).startsWith("board."));

  return { dataDir, feature, dir, bots, rooms, roomInputs, sent, frames, notices, usage, clock, script, visibility, addBot, addRoom, person, botCaller, taskFrames };
}

export type BoardFixture = ReturnType<typeof boardFixture>;
