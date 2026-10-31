import type { BoardActor } from "../../shared/board.ts";
import type { BoardDirectory, SendIdentity } from "./directory.ts";
import { DEFAULT_LIMITS, dayKey, decide, type Action, type RunnerLimits } from "./decide.ts";
import type { MissionService } from "./missions.ts";
import type { StoredMission } from "./schema.ts";
import type { BoardSender } from "./send.ts";
import { BOARD_SENDER, newSendId, spendReason } from "./send.ts";
import * as text from "./texts.ts";

export interface RunnerDeps {
  missions: MissionService;
  dir: BoardDirectory;
  sender: BoardSender;
  identityFor(actor: BoardActor): SendIdentity;
  spendBlock(botId: string): { code: "spend_cap" | "bot_spend_cap"; botName?: string } | null;
  now(): number;
  limits?: Partial<RunnerLimits>;
}

export class MissionRunner {
  private readonly deps: RunnerDeps;
  private readonly limits: RunnerLimits;
  private timer: ReturnType<typeof setInterval> | undefined;
  private soon: ReturnType<typeof setTimeout> | undefined;
  private ticking = false;
  private again = false;

  constructor(deps: RunnerDeps) {
    this.deps = deps;
    this.limits = { ...DEFAULT_LIMITS, ...deps.limits };
  }

  start(): void {
    if (this.timer) return;
    for (const mission of this.deps.missions.all()) this.afterRestart(mission);
    this.timer = setInterval(() => void this.tick(), this.limits.tickMs);
    this.timer.unref?.();
    this.poke(1_000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.soon) clearTimeout(this.soon);
    this.timer = undefined;
    this.soon = undefined;
  }

  poke(delayMs = 150): void {
    if (this.soon) return;
    this.soon = setTimeout(() => {
      this.soon = undefined;
      void this.tick();
    }, delayMs);
    this.soon.unref?.();
  }

  async tick(): Promise<void> {
    if (this.ticking) {
      this.again = true;
      return;
    }
    this.ticking = true;
    try {
      do {
        this.again = false;
        for (const mission of this.deps.missions.all()) {
          try {
            await this.step(mission.id);
          } catch (error) {
            console.warn(`[missions] ${mission.id}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      } while (this.again);
    } finally {
      this.ticking = false;
    }
  }

  private afterRestart(mission: StoredMission): void {
    const inflight = mission.runner.inflight;
    if (!inflight || (mission.status !== "planning" && mission.status !== "running")) return;
    this.deps.missions.record(mission.id, (state) => inflight.kind === "close"
      ? { ...state, inflight: undefined, closing: false }
      : { ...state, inflight: { ...inflight, at: 0, attempts: Math.max(0, inflight.attempts - 1) } });
  }

  private async step(id: string): Promise<void> {
    const mission = this.deps.missions.peek(id);
    if (!mission) return;
    if (mission.status === "paused") return this.maybeResume(mission);
    if (mission.status !== "planning" && mission.status !== "running") return;
    if (!this.deps.dir.room(mission.groupId)) return this.deps.missions.fail(id, text.reasonLostRoom());
    if (!this.deps.dir.bot(mission.leadBotId)) return this.deps.missions.fail(id, text.reasonLostLead());
    const lost = mission.teamBotIds.find((botId) => !this.deps.dir.bot(botId));
    if (lost && mission.status === "planning") return this.deps.missions.fail(id, text.reasonLostAgent(lost));
    const now = this.deps.now();
    const action = decide({
      mission,
      steps: this.deps.missions.stepTasks(mission),
      now,
      busy: this.deps.sender.roomBusy(mission.groupId, mission.threadId, mission.runner.inflight?.sendId),
      day: dayKey(now),
      limits: this.limits,
      nameOf: (botId) => this.deps.dir.bot(botId)?.name ?? botId,
      teamOf: (botIds) => botIds.flatMap((botId) => {
        const bot = this.deps.dir.bot(botId);
        return bot ? [{ id: bot.id, name: bot.name }] : [];
      }),
    });
    await this.run(mission, action, now);
  }

  private async run(mission: StoredMission, action: Action, now: number): Promise<void> {
    if (action.kind === "wait") return;
    if (action.kind === "pause") return this.deps.missions.pauseBySystem(mission.id, action.cause, action.reason);
    if (action.kind === "finish") {
      this.deps.missions.finish(mission.id, { kind: "bot", id: mission.leadBotId });
      return;
    }
    const block = this.deps.spendBlock(action.botId);
    if (block) {
      this.deps.missions.pauseBySystem(mission.id, block.code === "bot_spend_cap" ? "bot-spend" : "spend", text.reasonLimit(), spendReason(block));
      return;
    }
    const sendId = newSendId("mission");
    const day = dayKey(now);
    this.deps.missions.record(mission.id, (state) => ({
      ...state,
      inflight: { kind: action.as, sendId, at: now, attempts: action.attempts, ...(action.taskId !== undefined ? { taskId: action.taskId } : {}) },
      answer: action.as === "answer" ? undefined : state.answer,
      closing: action.as === "close" ? true : state.closing,
      daily: { day, turns: (state.daily?.day === day ? state.daily.turns : 0) + 1 },
    }));
    const outcome = await this.deps.sender.toRoom({
      groupId: mission.groupId,
      threadId: mission.threadId,
      text: action.text,
      sendId,
      identity: { ...this.deps.identityFor(mission.createdBy), sender: BOARD_SENDER },
    });
    if (outcome.status === "skipped") this.deps.missions.pauseBySystem(mission.id, "steps", text.reasonRoomUnreachable(), text.detailRoomUnreachable(outcome.reason));
  }

  private maybeResume(mission: StoredMission): void {
    if (mission.pausedBy !== "system") return;
    const cause = mission.runner.cause;
    const now = this.deps.now();
    if (cause === "daily") {
      if (mission.runner.daily?.day !== dayKey(now)) this.deps.missions.resumeBySystem(mission.id);
      return;
    }
    if (cause !== "spend" && cause !== "bot-spend") return;
    const blocked = mission.teamBotIds.some((botId) => this.deps.spendBlock(botId));
    if (!blocked) this.deps.missions.resumeBySystem(mission.id);
  }
}
