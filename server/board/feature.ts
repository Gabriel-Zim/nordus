import type { BoardActor, BoardPerson } from "../../shared/board.ts";
import type { Notification } from "../../shared/notification.ts";
import type { ResolvedSender } from "../../shared/wire.ts";
import type { RunnerLimits } from "./decide.ts";
import { Pace } from "./pace.ts";
import { ANONYMOUS, type BoardDirectory, type PersonCaller, type Seen, type SendIdentity } from "./directory.ts";
import { BoardFrameFilter } from "./frames.ts";
import { MissionService } from "./missions.ts";
import { MissionStore } from "./missions-store.ts";
import type { UsageLine } from "./receipt.ts";
import { MissionRunner } from "./runner.ts";
import type { BoardSender } from "./send.ts";
import { TaskService } from "./service.ts";
import { BoardStore } from "./store.ts";

export interface BoardHost {
  dataDir: string;
  dir: BoardDirectory;
  sender: BoardSender;
  people(): BoardPerson[];
  broadcast(payload: Record<string, unknown>): void;
  notify(notification: Notification): void;
  createRoom(input: { name: string; memberIds: string[]; leadBotId: string; bulletin: string; section?: string }): { groupId: string; threadId: string };
  usage(from: number, to: number): UsageLine[];
  identityFor(actor: BoardActor): SendIdentity;
  spendBlock(botId: string): { code: "spend_cap" | "bot_spend_cap"; botName?: string } | null;
  seenBy(email: string | undefined): Seen;
  now?(): number;
  limits?: Partial<RunnerLimits>;
}

export interface RoomLine {
  role: string;
  text?: string;
  sendId?: string;
  sender?: ResolvedSender;
  via?: string;
  peerAsk?: unknown;
}

export interface BoardFeature {
  tasks: TaskService;
  missions: MissionService;
  runner: MissionRunner;
  frames: BoardFrameFilter;
  dir: BoardDirectory;
  memberFrame(viewerId: string | undefined, payload: Record<string, unknown>): Record<string, unknown> | undefined;
  roomLine(threadId: string, line: RoomLine): void;
  start(): void;
  stop(): void;
}

export function createBoardFeature(host: BoardHost): BoardFeature {
  const now = host.now ?? Date.now;
  const taskStore = new BoardStore(host.dataDir);
  const missionStore = new MissionStore(host.dataDir);
  const emit = (frame: Parameters<BoardHost["broadcast"]>[0]) => host.broadcast(frame);
  const pace = new Pace();
  let runner: MissionRunner | undefined;
  const poke = () => runner?.poke();

  const tasks = new TaskService({
    store: taskStore,
    dir: host.dir,
    sender: host.sender,
    pace,
    people: host.people,
    emit,
    now,
    leadOf: (missionId) => missionStore.get(missionId)?.leadBotId,
  });
  const missions = new MissionService({
    store: missionStore,
    tasks,
    dir: host.dir,
    pace,
    emit,
    notify: host.notify,
    now,
    createRoom: host.createRoom,
    usage: host.usage,
    poke,
  });
  tasks.onChange((change) => missions.taskChanged(change));
  const running = new MissionRunner({
    missions,
    dir: host.dir,
    sender: host.sender,
    identityFor: host.identityFor,
    spendBlock: host.spendBlock,
    now,
    limits: host.limits,
  });
  runner = running;

  const frames = new BoardFrameFilter({
    dir: host.dir,
    member: (viewerId): PersonCaller => {
      const id = viewerId?.trim().toLowerCase();
      const email = id?.includes("@") ? id : undefined;
      return {
        kind: "person",
        actor: { kind: "person", id: id || ANONYMOUS },
        admin: false,
        ...(email ? { email } : {}),
        seen: host.seenBy(email),
        identity: { trigger: { kind: "owner" }, personPresent: false },
      };
    },
  });

  return {
    tasks,
    missions,
    runner: running,
    frames,
    dir: host.dir,
    memberFrame: (viewerId, payload) => frames.frameFor(viewerId, payload),
    roomLine(threadId, line) {
      if (line.role !== "user" || !line.text || line.peerAsk || line.via || line.sendId?.startsWith("mission-")) return;
      const email = line.sender?.email?.trim().toLowerCase();
      const admin = line.sender?.admin === true;
      const by: BoardActor = { kind: "person", id: email ?? (admin ? "owner" : line.sender?.id ?? ANONYMOUS), ...(line.sender?.name ? { name: line.sender.name } : {}) };
      missions.answerFromRoom(threadId, by, admin, line.text);
    },
    start: () => running.start(),
    stop: () => running.stop(),
  };
}
