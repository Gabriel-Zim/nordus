import type { BoardActor, BoardFrame, BoardMission, BoardTask, MissionFeedEntry, MissionFeedKind, MissionReceipt } from "../../shared/board.ts";
import { BOARD_LIMITS } from "../../shared/board.ts";
import type { Notification } from "../../shared/notification.ts";
import type { BotCaller, BoardBot, BoardDirectory, Caller, PersonCaller } from "./directory.ts";
import { mayDelete, personSeesMission, sameBucket } from "./directory.ts";
import { BoardError, forbidden, invalid, notFound } from "./errors.ts";
import { limitPerson, type Pace } from "./pace.ts";
import { buildReceipt, type UsageLine } from "./receipt.ts";
import type { RunnerState, StoredMission } from "./schema.ts";
import type { MissionStore } from "./missions-store.ts";
import type { TaskChange, TaskService } from "./service.ts";
import * as text from "./texts.ts";
import { MAX_PLAN_STEPS } from "./decide.ts";

export interface MissionServiceDeps {
  store: MissionStore;
  tasks: TaskService;
  dir: BoardDirectory;
  pace: Pace;
  emit(frame: BoardFrame): void;
  notify(notification: Notification): void;
  now(): number;
  createRoom(input: { name: string; memberIds: string[]; leadBotId: string; bulletin: string; section?: string }): { groupId: string; threadId: string };
  usage(from: number, to: number): UsageLine[];
  poke(): void;
}

export interface MissionDraft {
  title: string;
  goal: string;
  leadBotId: string;
  teamBotIds?: string[];
}

export interface PlanStep {
  title: string;
  description?: string;
  assignee?: string;
}

const OPEN: ReadonlySet<string> = new Set(["planning", "running", "waiting", "paused"]);
const BOT_OPEN_MISSIONS = 3;
const REVIEW = "Uma pessoa revisa as mensagens entre agentes, então você não abre nem monta missões por conta própria. Peça para ela.";

/** The mission as a screen gets it: the runner's private state never leaves, and the exact limit behind a pause is for administrators. */
export function toWire(mission: StoredMission, admin = false): BoardMission {
  const { runner: _runner, pausedDetail, ...wire } = mission;
  return admin && pausedDetail ? { ...wire, pausedDetail } : wire;
}

export class MissionService {
  private readonly deps: MissionServiceDeps;

  constructor(deps: MissionServiceDeps) {
    this.deps = deps;
  }

  all(): StoredMission[] {
    return this.deps.store.all();
  }

  peek(id: string): StoredMission | undefined {
    return this.deps.store.get(id);
  }

  list(caller: PersonCaller): BoardMission[] {
    return this.deps.store.all().filter((mission) => personSeesMission(mission, caller)).map((mission) => toWire(mission, caller.admin)).sort((a, b) => b.createdAt - a.createdAt);
  }

  get(caller: PersonCaller, id: string): StoredMission {
    const mission = this.deps.store.get(id);
    if (!mission || !personSeesMission(mission, caller)) throw notFound("mission");
    return mission;
  }

  view(caller: PersonCaller, id: string): { mission: BoardMission; receipt?: MissionReceipt } {
    const mission = this.get(caller, id);
    return { mission: toWire(mission, caller.admin), receipt: this.receipt(mission, caller.admin) };
  }

  receipt(mission: StoredMission, withMoney: boolean): MissionReceipt {
    const from = mission.startedAt ?? mission.createdAt;
    const to = mission.finishedAt ?? this.deps.now();
    return buildReceipt(mission, this.deps.usage(from, to), this.deps.now(), withMoney);
  }

  byThread(threadId: string): StoredMission | undefined {
    const room = this.deps.dir.roomOfThread(threadId);
    if (!room) return undefined;
    return this.deps.store.all().find((mission) => mission.groupId === room.id);
  }

  create(caller: Caller, draft: MissionDraft): StoredMission {
    if (caller.kind === "person") limitPerson(this.deps.pace, caller, this.deps.now(), "mission");
    else this.assertMayOpenRooms(caller);
    const team = this.team(caller, draft);
    if (caller.kind === "bot") {
      this.assertBotPace(caller);
      if (!caller.claimRoom()) throw new BoardError(429, "Você já abriu 4 salas neste turno.");
    }
    const { groupId, threadId } = this.createRoom(draft, team, caller.kind === "bot" ? caller.section : undefined);
    const now = this.deps.now();
    const id = `m${now.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const mission: StoredMission = {
      id,
      title: draft.title.replace(/\s+/g, " ").trim().slice(0, BOARD_LIMITS.missionTitle),
      goal: draft.goal.trim().slice(0, BOARD_LIMITS.missionGoal),
      createdBy: caller.actor,
      createdAt: now,
      status: "planning",
      leadBotId: draft.leadBotId,
      teamBotIds: team.map((bot) => bot.id),
      groupId,
      threadId,
      stepIds: [],
      feed: [],
      startedAt: now,
      runner: {},
    };
    this.deps.store.insert(mission);
    this.publish(mission);
    this.deps.poke();
    return mission;
  }

  plan(caller: BotCaller, steps: readonly PlanStep[]): StoredMission {
    if (caller.peerReview) throw forbidden(REVIEW);
    const mission = this.ownMission(caller, true);
    if (mission.status !== "planning" || mission.stepIds.length > 0) throw invalid("Esta missão já tem plano.");
    if (!steps.length || steps.length > MAX_PLAN_STEPS) throw invalid(`O plano precisa de 1 a ${MAX_PLAN_STEPS} passos.`);
    const source = { threadId: mission.threadId, groupId: mission.groupId };
    const resolved = steps.map((step) => {
      const assignee = step.assignee?.trim() || mission.leadBotId;
      if (!mission.teamBotIds.includes(assignee)) throw invalid(`O agente ${assignee} não está na equipe desta missão.`);
      return { ...step, assignee };
    });
    const ids = resolved.map((step) => this.deps.tasks.insert({
      title: step.title,
      description: step.description,
      assignee: step.assignee,
      createdBy: caller.actor,
      source,
      missionId: mission.id,
    }).id);
    const agents = new Set(resolved.map((step) => step.assignee)).size;
    return this.change(mission.id, (draft) => {
      draft.stepIds = ids;
      draft.status = "running";
      this.pushFeed(draft, caller.actor, "plan", text.planMade(ids.length, agents));
      draft.runner = { ...draft.runner, inflight: undefined };
    });
  }

  note(caller: BotCaller, body: string): StoredMission {
    const mission = this.ownMission(caller, false);
    const summary = body.trim().slice(0, BOARD_LIMITS.description);
    if (!summary) throw invalid("A nota está vazia.");
    const closing = mission.runner.closing === true && caller.bot.id === mission.leadBotId && mission.status === "running";
    if (!closing) return this.change(mission.id, (draft) => this.pushFeed(draft, caller.actor, "progress", summary));
    return this.finish(mission.id, caller.actor, summary);
  }

  ask(caller: BotCaller, question: string, options: readonly string[] | undefined): StoredMission {
    const mission = this.ownMission(caller, false);
    if (mission.pendingDecision && mission.pendingDecision.answer === undefined) throw invalid("Já existe uma pergunta esperando resposta.");
    if (mission.status !== "planning" && mission.status !== "running") throw invalid("A missão não está andando agora.");
    const choices = options?.map((option) => option.trim()).filter(Boolean).slice(0, BOARD_LIMITS.options);
    const asked = this.change(mission.id, (draft) => {
      draft.status = "waiting";
      draft.pendingDecision = {
        question: question.trim().slice(0, BOARD_LIMITS.question),
        ...(choices?.length ? { options: choices } : {}),
        askedAt: this.deps.now(),
        askedBy: caller.bot.id,
      };
      this.pushFeed(draft, caller.actor, "decision", draft.pendingDecision.question);
    });
    this.announce(asked, "question", text.decisionNotice(asked.title), question.trim(), caller.bot);
    return asked;
  }

  answer(caller: PersonCaller, id: string, answer: string): StoredMission {
    limitPerson(this.deps.pace, caller, this.deps.now(), "write");
    const mission = this.get(caller, id);
    const mayAnswer = caller.admin || (mission.createdBy.kind === "person" && mission.createdBy.id === caller.actor.id);
    if (!mayAnswer) throw forbidden("Só quem abriu a missão, ou um administrador, responde.");
    return this.settleDecision(mission, caller.actor, answer, true);
  }

  answerFromRoom(threadId: string, by: BoardActor, isAdmin: boolean, body: string): void {
    const mission = this.byThread(threadId);
    if (!mission || mission.status !== "waiting" || !mission.pendingDecision || mission.threadId !== threadId) return;
    const creator = mission.createdBy;
    if (!isAdmin && !(creator.kind === "person" && by.kind === "person" && creator.id === by.id)) return;
    const answer = body.trim();
    if (answer) this.settleDecision(mission, by, answer, false);
  }

  pause(caller: PersonCaller, id: string): StoredMission {
    limitPerson(this.deps.pace, caller, this.deps.now(), "write");
    const mission = this.get(caller, id);
    if (mission.status === "done" || mission.status === "failed") throw invalid("Esta missão já terminou.");
    if (mission.status === "paused") return mission;
    return this.change(mission.id, (draft) => {
      draft.status = "paused";
      draft.pausedBy = "person";
      draft.pausedReason = text.pausedByPerson(caller.actor.name ?? "uma pessoa");
      draft.runner = { ...draft.runner, cause: "person" };
      this.pushFeed(draft, caller.actor, "progress", draft.pausedReason);
    });
  }

  resume(caller: PersonCaller, id: string): StoredMission {
    limitPerson(this.deps.pace, caller, this.deps.now(), "write");
    const mission = this.get(caller, id);
    if (mission.status !== "paused") throw invalid("Esta missão não está pausada.");
    const resumed = this.change(mission.id, (draft) => {
      this.reopen(draft);
      draft.runner = { ...draft.runner, inflight: undefined, cause: undefined };
      this.pushFeed(draft, caller.actor, "progress", text.resumed(caller.actor.name ?? "uma pessoa"));
    });
    this.deps.poke();
    return resumed;
  }

  remove(caller: PersonCaller, id: string): void {
    limitPerson(this.deps.pace, caller, this.deps.now(), "write");
    const mission = this.get(caller, id);
    if (!mayDelete(mission.createdBy, caller)) throw forbidden("Só quem abriu a missão, ou um administrador, pode apagá-la.");
    for (const task of this.deps.tasks.forMission(mission.id)) this.deps.tasks.removeTask(task);
    this.deps.store.remove(mission.id);
    this.deps.emit({ kind: "board.mission.deleted", id: mission.id });
  }

  pauseBySystem(id: string, cause: NonNullable<RunnerState["cause"]>, reason: string, detail?: string): void {
    const mission = this.deps.store.get(id);
    if (!mission || (mission.status !== "planning" && mission.status !== "running")) return;
    const paused = this.change(id, (draft) => {
      draft.status = "paused";
      draft.pausedBy = cause === "steps" ? "person" : "system";
      draft.pausedReason = reason;
      if (detail) draft.pausedDetail = detail;
      else delete draft.pausedDetail;
      draft.runner = { ...draft.runner, cause };
      this.pushFeed(draft, { kind: "system", name: "Nordus" }, "error", text.pausedBySystem(reason));
    });
    this.announce(paused, "incident", text.pausedNotice(paused.title), reason);
  }

  resumeBySystem(id: string): void {
    const mission = this.deps.store.get(id);
    if (!mission || mission.status !== "paused" || mission.pausedBy !== "system") return;
    this.change(id, (draft) => {
      this.reopen(draft);
      draft.runner = { ...draft.runner, cause: undefined };
      this.pushFeed(draft, { kind: "system", name: "Nordus" }, "progress", text.resumedBySystem());
    });
    this.deps.poke();
  }

  fail(id: string, reason: string): void {
    const mission = this.deps.store.get(id);
    if (!mission || mission.status === "done" || mission.status === "failed") return;
    const failed = this.change(id, (draft) => {
      draft.status = "failed";
      draft.finishedAt = this.deps.now();
      draft.runner = {};
      delete draft.pendingDecision;
      this.pushFeed(draft, { kind: "system", name: "Nordus" }, "error", text.missionFailed(reason));
    });
    this.announce(failed, "incident", text.failedNotice(failed.title), reason);
  }

  finish(id: string, by: BoardActor, summary?: string): StoredMission {
    const finished = this.change(id, (draft) => {
      draft.status = "done";
      draft.finishedAt = this.deps.now();
      draft.runner = {};
      this.pushFeed(draft, by, "done", text.missionDone(summary));
    });
    this.announce(finished, "done", text.doneNotice(finished.title), text.missionDone(summary));
    return finished;
  }

  record(id: string, mutate: (state: RunnerState) => RunnerState): StoredMission | undefined {
    const mission = this.deps.store.get(id);
    if (!mission) return undefined;
    return this.deps.store.save({ ...mission, runner: mutate(mission.runner) });
  }

  taskChanged(change: TaskChange): void {
    if ("removed" in change) {
      const missionId = change.removed.missionId;
      const mission = missionId ? this.deps.store.get(missionId) : undefined;
      if (mission?.stepIds.includes(change.removed.id)) this.change(mission.id, (draft) => {
        draft.stepIds = draft.stepIds.filter((stepId) => stepId !== change.removed.id);
      });
      return;
    }
    const { task, before } = change;
    const mission = task.missionId ? this.deps.store.get(task.missionId) : undefined;
    if (!mission) return;
    if (before && before.status !== task.status && task.status === "done" && mission.stepIds.includes(task.id)) {
      const index = mission.stepIds.indexOf(task.id) + 1;
      const author = this.authorOf(task);
      this.change(mission.id, (draft) => this.pushFeed(draft, author, "progress", text.stepFinished(index, draft.stepIds.length, task.title)));
    }
    if (mission.status === "running" || mission.status === "planning") this.deps.poke();
  }

  stepTasks(mission: StoredMission): BoardTask[] {
    return mission.stepIds.flatMap((id) => this.deps.tasks.peek(id) ?? []);
  }

  private settleDecision(mission: StoredMission, by: BoardActor, answer: string, deliver: boolean): StoredMission {
    const pending = mission.pendingDecision;
    if (mission.status !== "waiting" || !pending || pending.answer !== undefined) throw invalid("Esta missão não está esperando uma resposta.");
    const reply = answer.trim().slice(0, BOARD_LIMITS.answer);
    if (!reply) throw invalid("A resposta está vazia.");
    const resumed = this.change(mission.id, (draft) => {
      draft.pendingDecision = { ...pending, answer: reply, answeredAt: this.deps.now(), answeredBy: by };
      this.reopen(draft);
      this.pushFeed(draft, by, "decision", text.decisionAnswered(reply));
      if (deliver) {
        draft.runner = {
          ...draft.runner,
          answer: { botId: pending.askedBy, text: text.answerRequest({ bot: this.deps.dir.bot(pending.askedBy)?.name ?? "Agente", person: text.whoIs(by, (botId) => this.deps.dir.bot(botId)?.name), question: pending.question, answer: reply }) },
        };
      }
    });
    this.deps.poke();
    return resumed;
  }

  private reopen(draft: StoredMission): void {
    delete draft.pausedBy;
    delete draft.pausedReason;
    delete draft.pausedDetail;
    const waiting = draft.pendingDecision && draft.pendingDecision.answer === undefined;
    draft.status = waiting ? "waiting" : draft.stepIds.length ? "running" : "planning";
  }

  private ownMission(caller: BotCaller, leadOnly: boolean): StoredMission {
    const mission = this.byThread(caller.threadId);
    if (!mission) throw invalid("Esta conversa não é a sala de uma missão.");
    if (!mission.teamBotIds.includes(caller.bot.id)) throw forbidden("Você não está na equipe desta missão.");
    if (leadOnly && mission.leadBotId !== caller.bot.id) throw forbidden("Só o líder monta o plano.");
    if (mission.status === "done" || mission.status === "failed") throw invalid("Esta missão já terminou.");
    return mission;
  }

  private assertMayOpenRooms(caller: BotCaller): void {
    if (!caller.chief) throw forbidden("Só um Chief of Staff ativo abre salas, e uma missão abre uma sala.");
    if (caller.peerReview) throw forbidden(REVIEW);
  }

  private team(caller: Caller, draft: MissionDraft): BoardBot[] {
    const ids = [...new Set([draft.leadBotId, ...(draft.teamBotIds ?? [])])];
    if (ids.length > BOARD_LIMITS.missionTeam) throw invalid(`A equipe pode ter até ${BOARD_LIMITS.missionTeam} agentes.`);
    const bots = ids.map((id) => {
      const bot = this.deps.dir.bot(id);
      if (!bot || bot.hidden) throw invalid("Um dos agentes não existe.");
      if (caller.kind === "person" && !caller.admin && !caller.seen.bot(id)) throw invalid("Um dos agentes não existe.");
      if (caller.kind === "bot" && id !== caller.bot.id && !caller.reaches(id)) throw forbidden("Você não alcança um dos agentes.");
      if (caller.kind === "bot" && id !== caller.bot.id && !caller.teammate(id)) throw forbidden("Você só junta colegas do seu time.");
      return bot;
    });
    if (caller.kind === "bot" && draft.leadBotId !== caller.bot.id) throw forbidden("Quem abre a missão é o próprio líder.");
    if (!sameBucket(bots)) throw invalid("Uma missão não pode juntar agentes de clientes diferentes, a casa com um cliente, nem agentes que ninguém marcou como da casa ou de um cliente.");
    return bots;
  }

  private createRoom(draft: MissionDraft, team: readonly BoardBot[], section: string | undefined): { groupId: string; threadId: string } {
    try {
      return this.deps.createRoom({
        name: text.missionRoomName(draft.title),
        memberIds: team.map((bot) => bot.id),
        leadBotId: draft.leadBotId,
        bulletin: text.missionBulletin(draft.goal),
        ...(section ? { section } : {}),
      });
    } catch (error) {
      const status = (error as { status?: unknown }).status;
      throw new BoardError(typeof status === "number" ? status : 400, error instanceof Error ? error.message : "Não foi possível criar a sala da missão.");
    }
  }

  private assertBotPace(caller: BotCaller): void {
    const open = this.deps.store.all().filter((mission) => OPEN.has(mission.status) && mission.createdBy.kind === "bot" && mission.createdBy.id === caller.bot.id).length;
    if (open >= BOT_OPEN_MISSIONS) throw new BoardError(429, `Você já tem ${BOT_OPEN_MISSIONS} missões abertas. Termine uma antes de abrir outra.`);
  }

  private authorOf(task: BoardTask): BoardActor {
    const bot = task.assignee && !task.assignee.includes("@") ? this.deps.dir.bot(task.assignee) : undefined;
    return bot ? { kind: "bot", id: bot.id, name: bot.name } : { kind: "system", name: "Nordus" };
  }

  private change(id: string, mutate: (draft: StoredMission) => void): StoredMission {
    const current = this.deps.store.get(id);
    if (!current) throw notFound("mission");
    const draft: StoredMission = { ...current, feed: [...current.feed], stepIds: [...current.stepIds], runner: { ...current.runner } };
    mutate(draft);
    const saved = this.deps.store.save(draft);
    this.publish(saved);
    return saved;
  }

  private pushFeed(draft: StoredMission, author: BoardActor, kind: MissionFeedKind, body: string): void {
    const entry: MissionFeedEntry = { at: this.deps.now(), author: this.named(author), kind, text: body.slice(0, BOARD_LIMITS.description) };
    draft.feed.push(entry);
    if (draft.feed.length > BOARD_LIMITS.missionFeed) {
      const keep = draft.feed.findIndex((item) => item.kind === "plan");
      const drop = draft.feed.findIndex((item, index) => index !== keep && item.kind === "progress");
      draft.feed.splice(drop >= 0 ? drop : 0, 1);
    }
  }

  private named(author: BoardActor): BoardActor {
    if (author.kind !== "bot" || author.name) return author;
    const bot = this.deps.dir.bot(author.id);
    return bot ? { ...author, name: bot.name } : author;
  }

  private publish(mission: StoredMission): void {
    this.deps.emit({ kind: "board.mission", mission: toWire(mission, true) });
  }

  private announce(mission: StoredMission, kind: Notification["kind"], title: string, body: string, bot?: BoardBot): void {
    const speaker = bot ?? this.deps.dir.bot(mission.leadBotId);
    if (!speaker) return;
    const person = mission.createdBy.kind === "person" && mission.createdBy.id.includes("@") ? [mission.createdBy.id] : undefined;
    this.deps.notify({
      kind,
      botId: speaker.id,
      botName: speaker.name,
      threadId: mission.threadId,
      groupId: mission.groupId,
      title,
      body: body.slice(0, 300),
      ...(person ? { toPersons: person } : {}),
    });
  }
}

