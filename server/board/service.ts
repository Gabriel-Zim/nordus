import type { BoardActor, BoardFrame, BoardHistoryEntry, BoardLink, BoardPerson, BoardTask, BoardTaskResponse, BoardTaskSource, TaskStatus } from "../../shared/board.ts";
import { assigneeKind, BOARD_LIMITS } from "../../shared/board.ts";
import type { BoardBot, BoardDirectory, BotCaller, Caller, PersonCaller, SendIdentity } from "./directory.ts";
import { botMayChange, botSeesTask, mayDelete, personSeesTask } from "./directory.ts";
import { BoardError, forbidden, invalid, notFound } from "./errors.ts";
import { limitPerson, PERSON_PACE } from "./pace.ts";
import type { Pace } from "./pace.ts";
import { normalizeLinks } from "./schema.ts";
import type { BoardSender, SendOutcome } from "./send.ts";
import { newSendId } from "./send.ts";
import type { BoardStore } from "./store.ts";
import * as text from "./texts.ts";

export interface TaskServiceDeps {
  store: BoardStore;
  dir: BoardDirectory;
  sender: BoardSender;
  pace: Pace;
  people(): BoardPerson[];
  emit(frame: BoardFrame): void;
  now(): number;
  leadOf(missionId: string): string | undefined;
}

export interface TaskDraft {
  title: string;
  description?: string;
  status?: TaskStatus;
  assignee?: string;
  links?: BoardLink[];
  source?: BoardTaskSource;
}

export interface TaskPatch {
  title?: string;
  description?: string;
  status?: TaskStatus;
  assignee?: string | null;
  links?: BoardLink[];
  note?: string;
}

export type TaskChange = { task: BoardTask; before?: BoardTask } | { removed: BoardTask };

const BOT_TASKS_PER_HOUR = 40;
const HOUR_MS = 3_600_000;

function sameActor(a: BoardActor, b: BoardActor): boolean {
  if (a.kind === "system" || b.kind === "system") return a.kind === b.kind;
  return a.kind === b.kind && a.id === b.id;
}

export class TaskService {
  private readonly deps: TaskServiceDeps;
  private readonly listeners = new Set<(change: TaskChange) => void>();

  constructor(deps: TaskServiceDeps) {
    this.deps = deps;
  }

  onChange(listener: (change: TaskChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  list(caller: Caller): BoardTask[] {
    return this.deps.store.all().filter((task) => this.sees(caller, task)).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  get(caller: Caller, id: number): BoardTask {
    const task = this.deps.store.get(id);
    if (!task || !this.sees(caller, task)) throw notFound();
    return task;
  }

  peek(id: number): BoardTask | undefined {
    return this.deps.store.get(id);
  }

  sees(caller: Caller, task: BoardTask): boolean {
    return caller.kind === "person" ? personSeesTask(task, caller, this.deps.dir) : botSeesTask(task, caller, this.deps.dir);
  }

  people(caller: PersonCaller): BoardPerson[] {
    const known = new Map<string, BoardPerson>();
    const add = (person: BoardPerson) => {
      if (!known.has(person.id)) known.set(person.id, person);
    };
    const names = new Map(this.deps.people().map((person) => [person.id, person]));
    const named = (id: string): BoardPerson => names.get(id) ?? { id };
    if (caller.admin) {
      for (const person of names.values()) add(person);
      for (const task of this.deps.store.all()) {
        if (task.assignee && assigneeKind(task.assignee) === "person") add(named(task.assignee));
      }
      return [...known.values()];
    }
    if (caller.email) add(named(caller.email));
    for (const task of this.list(caller)) {
      if (task.assignee && assigneeKind(task.assignee) === "person") add(named(task.assignee));
      if (task.createdBy.kind === "person" && task.createdBy.id.includes("@")) add(named(task.createdBy.id));
    }
    return [...known.values()];
  }

  async create(caller: Caller, draft: TaskDraft): Promise<BoardTaskResponse> {
    if (caller.kind === "person") {
      limitPerson(this.deps.pace, caller, this.deps.now(), "card");
      this.assertQuota(caller);
    }
    const assignee = this.assignee(caller, draft.assignee);
    const source = caller.kind === "bot" ? this.botSource(caller) : this.personSource(caller, draft.source);
    if (caller.kind === "bot") this.assertBotPace(caller);
    const task = this.insert({ ...draft, assignee, source, createdBy: caller.actor });
    if (caller.kind !== "person" || !task.assignee || assigneeKind(task.assignee) !== "bot") return { task };
    const dispatch = await this.dispatch(task.id, caller);
    return { task: this.deps.store.get(task.id) ?? task, dispatch };
  }

  insert(input: TaskDraft & { createdBy: BoardActor; missionId?: string; thread?: BoardTask["thread"] }): BoardTask {
    const now = this.deps.now();
    const status = input.status ?? "todo";
    const links = normalizeLinks(input.links);
    const description = input.description?.trim();
    const task = this.deps.store.insert((id) => ({
      id,
      title: cleanTitle(input.title),
      ...(description ? { description: description.slice(0, BOARD_LIMITS.description) } : {}),
      status,
      ...(input.assignee ? { assignee: input.assignee } : {}),
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
      ...(input.source ? { source: input.source } : {}),
      ...(input.thread ? { thread: input.thread } : {}),
      ...(links ? { links } : {}),
      ...(input.missionId ? { missionId: input.missionId } : {}),
      history: [
        { at: now, by: input.createdBy, event: "created", to: status },
        ...(input.assignee ? [{ at: now, by: input.createdBy, event: "assigned" as const, assignee: input.assignee }] : []),
      ],
    }), (candidate) => Boolean(candidate.missionId) || !sameActor(candidate.createdBy, input.createdBy));
    this.publish({ task });
    return task;
  }

  async update(caller: PersonCaller, id: number, patch: TaskPatch): Promise<BoardTaskResponse> {
    limitPerson(this.deps.pace, caller, this.deps.now(), "write");
    const before = this.get(caller, id);
    const now = this.deps.now();
    const history: BoardHistoryEntry[] = [];
    const next: BoardTask = { ...before };
    let edited = false;
    if (patch.title !== undefined && cleanTitle(patch.title) !== before.title) {
      next.title = cleanTitle(patch.title);
      edited = true;
    }
    if (patch.description !== undefined) {
      const description = patch.description.trim();
      if (description !== (before.description ?? "")) {
        if (description) next.description = description;
        else delete next.description;
        edited = true;
      }
    }
    if (patch.links !== undefined) {
      const links = normalizeLinks(patch.links);
      if (JSON.stringify(links ?? []) !== JSON.stringify(before.links ?? [])) {
        if (links) next.links = links;
        else delete next.links;
        edited = true;
      }
    }
    if (edited) history.push({ at: now, by: caller.actor, event: "edited" });
    let assigned: string | undefined;
    if (patch.assignee !== undefined) {
      const target = patch.assignee === null || patch.assignee === "" ? undefined : this.assignee(caller, patch.assignee);
      if (target !== before.assignee) {
        if (target) {
          next.assignee = target;
          assigned = target;
          history.push({ at: now, by: caller.actor, event: "assigned", assignee: target });
        } else {
          delete next.assignee;
          history.push({ at: now, by: caller.actor, event: "unassigned" });
        }
      }
    }
    const note = patch.note?.trim() || undefined;
    if (patch.status !== undefined && patch.status !== before.status) {
      next.status = patch.status;
      history.push({ at: now, by: caller.actor, from: before.status, to: patch.status, ...(note ? { note } : {}) });
    } else if (note) {
      history.push({ at: now, by: caller.actor, note });
    }
    if (!history.length) return { task: before };
    const saved = this.commit(before, next, history, now);
    const dispatching = assigned && assigneeKind(assigned) === "bot" && saved.status !== "done";
    if (!dispatching) return { task: saved };
    const dispatch = await this.dispatch(id, caller);
    return { task: this.deps.store.get(id) ?? saved, dispatch };
  }

  botUpdate(caller: BotCaller, id: number, patch: { status?: TaskStatus; note?: string; link?: BoardLink }): BoardTask {
    const before = this.deps.store.get(id);
    if (!before || !botSeesTask(before, caller, this.deps.dir)) throw notFound();
    if (!botMayChange(before, caller, this.deps.dir, this.deps.leadOf)) throw forbidden("Essa tarefa é de outro agente.");
    const now = this.deps.now();
    const next: BoardTask = { ...before };
    const history: BoardHistoryEntry[] = [];
    const note = patch.note?.trim() || undefined;
    if (patch.link) {
      const links = normalizeLinks([...(before.links ?? []), patch.link]);
      if (JSON.stringify(links ?? []) !== JSON.stringify(before.links ?? [])) {
        if (links) next.links = links;
        history.push({ at: now, by: caller.actor, event: "edited" });
      }
    }
    if (patch.status !== undefined && patch.status !== before.status) {
      next.status = patch.status;
      history.push({ at: now, by: caller.actor, from: before.status, to: patch.status, ...(note ? { note } : {}) });
    } else if (note) {
      history.push({ at: now, by: caller.actor, note });
    }
    return history.length ? this.commit(before, next, history, now) : before;
  }

  remove(caller: PersonCaller, id: number): void {
    limitPerson(this.deps.pace, caller, this.deps.now(), "write");
    const task = this.get(caller, id);
    if (!mayDelete(task.createdBy, caller)) throw forbidden("Só quem criou a tarefa, ou um administrador, pode apagá-la.");
    this.removeTask(task);
  }

  removeTask(task: BoardTask): void {
    const removed = this.deps.store.remove(task.id);
    if (!removed) return;
    this.deps.emit({ kind: "board.task.deleted", id: removed.id });
    for (const listener of this.listeners) listener({ removed });
  }

  setStatus(id: number, status: TaskStatus, by: BoardActor, note?: string): BoardTask | undefined {
    const before = this.deps.store.get(id);
    if (!before || before.status === status) return before;
    const now = this.deps.now();
    return this.commit(before, { ...before, status }, [{ at: now, by, from: before.status, to: status, ...(note ? { note } : {}) }], now);
  }

  forMission(missionId: string): BoardTask[] {
    return this.deps.store.all().filter((task) => task.missionId === missionId);
  }

  private commit(before: BoardTask, next: BoardTask, history: BoardHistoryEntry[], now: number): BoardTask {
    const trimmed = trimHistory([...before.history, ...history]);
    const saved = this.deps.store.save({ ...next, history: trimmed, updatedAt: now });
    this.publish({ task: saved, before });
    return saved;
  }

  private publish(change: TaskChange): void {
    if ("task" in change) this.deps.emit({ kind: "board.task", task: change.task });
    for (const listener of this.listeners) listener(change);
  }

  private async dispatch(id: number, caller: PersonCaller): Promise<NonNullable<BoardTaskResponse["dispatch"]>> {
    const task = this.deps.store.get(id);
    const bot = task?.assignee ? this.deps.dir.bot(task.assignee) : undefined;
    if (!task || !bot) return { status: "skipped", reason: "O agente não existe mais." };
    if (bot.hidden) return { status: "skipped", reason: `${bot.name} está arquivado.` };
    const room = task.source?.groupId ? this.deps.dir.room(task.source.groupId) : undefined;
    const inRoom = room && task.source && room.memberIds.includes(bot.id) ? { room, threadId: task.source.threadId } : undefined;
    const outcome = await this.send(task, bot, inRoom, caller);
    const latest = this.deps.store.get(id);
    if (!latest) return { status: "skipped", reason: "A tarefa foi apagada." };
    const now = this.deps.now();
    const by = caller.actor;
    if (outcome.status === "skipped") {
      this.commit(latest, latest, [{ at: now, by, event: "sent", note: `Não foi possível avisar ${bot.name}: ${outcome.reason}` }], now);
      return { status: "skipped", reason: outcome.reason };
    }
    const thread = { threadId: outcome.threadId, ...(inRoom ? { groupId: inRoom.room.id } : {}), botId: bot.id };
    this.commit(latest, { ...latest, thread }, [{ at: now, by, event: "sent", assignee: bot.id }], now);
    return { status: outcome.status };
  }

  private async send(task: BoardTask, bot: BoardBot, inRoom: { room: { id: string }; threadId: string } | undefined, caller: PersonCaller): Promise<SendOutcome> {
    if (inRoom && !caller.admin && !caller.seen.thread(inRoom.threadId) && !caller.seen.group(inRoom.room.id)) {
      return { status: "skipped", reason: text.reasonRoomHidden() };
    }
    const nameOf = (id: string) => this.deps.dir.bot(id)?.name;
    const editor = lastEditor(task);
    const body = text.taskMessage(task, {
      writtenBy: text.whoIs(task.createdBy, nameOf),
      ...(editor && !sameActor(editor, task.createdBy) ? { editedBy: text.whoIs(editor, nameOf) } : {}),
      passedBy: text.whoIs(caller.actor, nameOf),
    });
    const sendId = newSendId("task");
    const identity: SendIdentity = caller.identity;
    return inRoom
      ? this.deps.sender.toRoom({ groupId: inRoom.room.id, threadId: inRoom.threadId, text: `@${bot.name} ${body}`, sendId, identity })
      : this.deps.sender.toBot({ botId: bot.id, text: body, sendId, identity });
  }

  private assignee(caller: Caller, raw: string | undefined): string | undefined {
    const value = raw?.trim();
    if (!value) return caller.kind === "bot" ? caller.bot.id : undefined;
    if (assigneeKind(value) === "person") return this.personAssignee(caller, value.toLowerCase());
    const bot = this.deps.dir.bot(value);
    if (!bot || bot.hidden) throw invalid("Esse agente não existe.");
    if (caller.kind === "person") {
      if (!caller.admin && !caller.seen.bot(bot.id)) throw invalid("Esse agente não existe.");
      return bot.id;
    }
    if (bot.id !== caller.bot.id && (!caller.reaches(bot.id) || bot.bucket !== caller.bot.bucket)) {
      throw forbidden("Você não alcança esse agente.");
    }
    return bot.id;
  }

  private personAssignee(caller: Caller, email: string): string {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw invalid("Essa pessoa não é um e-mail válido.");
    if (caller.kind === "bot") {
      if (caller.bot.bucket !== "internal") throw forbidden("Você não pode atribuir tarefas a pessoas.");
      if (!this.deps.people().some((person) => person.id === email)) throw invalid("Essa pessoa não está neste espaço.");
      return email;
    }
    if (!caller.admin && !this.people(caller).some((person) => person.id === email)) throw invalid("Essa pessoa não está neste espaço.");
    return email;
  }

  private personSource(caller: PersonCaller, source: BoardTaskSource | undefined): BoardTaskSource | undefined {
    if (!source) return undefined;
    if (!caller.admin && !caller.seen.thread(source.threadId)) throw invalid("Essa conversa não existe.");
    const room = this.deps.dir.roomOfThread(source.threadId);
    return { threadId: source.threadId, ...(room ? { groupId: room.id } : {}), ...(source.messageId ? { messageId: source.messageId } : {}) };
  }

  private botSource(caller: BotCaller): BoardTaskSource {
    const room = this.deps.dir.roomOfThread(caller.threadId);
    return { threadId: caller.threadId, ...(room ? { groupId: room.id } : {}) };
  }

  private assertQuota(caller: PersonCaller): void {
    if (caller.admin) return;
    const kept = this.deps.store.all().filter((task) => sameActor(task.createdBy, caller.actor)).length;
    if (kept >= PERSON_PACE.cardsKept) throw new BoardError(409, `Você já tem ${kept} cartões no quadro. Apague os que já terminaram para criar outros.`);
  }

  private assertBotPace(caller: BotCaller): void {
    const since = this.deps.now() - HOUR_MS;
    const recent = this.deps.store.all().filter((task) => task.createdBy.kind === "bot" && task.createdBy.id === caller.bot.id && task.createdAt >= since).length;
    if (recent >= BOT_TASKS_PER_HOUR) throw new BoardError(429, "Você criou tarefas demais na última hora. Atualize as que já existem.");
  }
}

function lastEditor(task: BoardTask): BoardActor | undefined {
  for (let i = task.history.length - 1; i >= 0; i -= 1) if (task.history[i]!.event === "edited") return task.history[i]!.by;
  return undefined;
}

/** Keeps the first entry, the newest ones, and the last edit, so the card never forgets who wrote what it says. */
function trimHistory(all: BoardHistoryEntry[]): BoardHistoryEntry[] {
  if (all.length <= BOARD_LIMITS.history) return all;
  const tail = all.slice(all.length - (BOARD_LIMITS.history - 1));
  const edit = [...all].reverse().find((entry) => entry.event === "edited");
  if (!edit || edit === all[0] || tail.includes(edit)) return [all[0]!, ...tail];
  return [all[0]!, edit, ...tail.slice(1)];
}

function cleanTitle(title: string): string {
  const clean = title.replace(/\s+/g, " ").trim().slice(0, BOARD_LIMITS.title);
  if (!clean) throw invalid("A tarefa precisa de um título.");
  return clean;
}
