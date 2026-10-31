import type { Bot } from "@/state/store";
import { t } from "@/lib/i18n";
import { api } from "@/state/api";
import type { LocaleKey } from "@/locales";
import { assigneeKind } from "../../shared/board";
import type {
  BoardActor, BoardAssignee, BoardLink, BoardMission, BoardPeopleResponse, BoardPerson, BoardTask, BoardTaskResponse, BoardTasksResponse,
  BoardTaskSource, MissionResponse, MissionsResponse, MissionStatus, TaskStatus,
} from "../../shared/board";

export const COLUMN_LABEL: Record<TaskStatus, LocaleKey> = {
  todo: "board.column.todo", doing: "board.column.doing", review: "board.column.review", done: "board.column.done",
};

export const MISSION_STATUS_LABEL: Record<MissionStatus, LocaleKey> = {
  planning: "missions.status.planning", running: "missions.status.running", waiting: "missions.status.waiting",
  paused: "missions.status.paused", done: "missions.status.done", failed: "missions.status.failed",
};

export interface NewTaskBody {
  title: string;
  description?: string;
  status?: TaskStatus;
  assignee?: BoardAssignee;
  links?: BoardLink[];
  source?: BoardTaskSource;
}

export interface TaskPatch {
  title?: string;
  description?: string;
  status?: TaskStatus;
  assignee?: BoardAssignee | null;
  links?: BoardLink[];
  note?: string;
}

export interface NewMissionBody {
  title: string;
  goal: string;
  leadBotId: string;
  teamBotIds?: string[];
}

const READ_TIMEOUT_MS = 20_000;
const WRITE_TIMEOUT_MS = 30_000;
const write = (method: string, body?: unknown) => ({
  method, timeoutMs: WRITE_TIMEOUT_MS, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

export const boardApi = {
  tasks: () => api<BoardTasksResponse>("/api/board/tasks", { timeoutMs: READ_TIMEOUT_MS }),
  people: () => api<BoardPeopleResponse>("/api/board/people", { timeoutMs: READ_TIMEOUT_MS }),
  createTask: (body: NewTaskBody) => api<BoardTaskResponse>("/api/board/tasks", write("POST", body)),
  patchTask: (id: number, patch: TaskPatch) => api<BoardTaskResponse>(`/api/board/tasks/${id}`, write("PATCH", patch)),
  deleteTask: (id: number) => api<{ ok: true }>(`/api/board/tasks/${id}`, write("DELETE")),
  missions: () => api<MissionsResponse>("/api/missions", { timeoutMs: READ_TIMEOUT_MS }),
  mission: (id: string) => api<MissionResponse>(`/api/missions/${encodeURIComponent(id)}`, { timeoutMs: READ_TIMEOUT_MS }),
  createMission: (body: NewMissionBody) => api<MissionResponse>("/api/missions", write("POST", body)),
  pauseMission: (id: string) => api<MissionResponse>(`/api/missions/${encodeURIComponent(id)}/pause`, write("POST")),
  resumeMission: (id: string) => api<MissionResponse>(`/api/missions/${encodeURIComponent(id)}/resume`, write("POST")),
  answerMission: (id: string, answer: string) => api<MissionResponse>(`/api/missions/${encodeURIComponent(id)}/answer`, write("POST", { answer })),
  deleteMission: (id: string) => api<{ ok: true }>(`/api/missions/${encodeURIComponent(id)}`, write("DELETE")),
};

export function normalizeTask(task: BoardTask): BoardTask {
  return Array.isArray(task.history) ? task : { ...task, history: [] };
}

export function normalizeMission(mission: BoardMission): BoardMission {
  if (Array.isArray(mission.feed) && Array.isArray(mission.stepIds) && Array.isArray(mission.teamBotIds)) return mission;
  return { ...mission, feed: mission.feed ?? [], stepIds: mission.stepIds ?? [], teamBotIds: mission.teamBotIds ?? [] };
}

export function sortTasks(tasks: readonly BoardTask[]): BoardTask[] {
  return [...tasks].sort((a, b) => b.updatedAt - a.updatedAt || b.id - a.id);
}

export const FILTER_ALL = "all";
export const FILTER_NONE = "none";
export const filterFor = (assignee: BoardAssignee) => `who:${assignee}`;

export function matchesFilter(task: BoardTask, filter: string): boolean {
  if (filter === FILTER_ALL) return true;
  if (filter === FILTER_NONE) return !task.assignee;
  return Boolean(task.assignee) && filter === filterFor(task.assignee!);
}

export function groupByColumn(tasks: readonly BoardTask[], filter = FILTER_ALL): Record<TaskStatus, BoardTask[]> {
  const columns: Record<TaskStatus, BoardTask[]> = { todo: [], doing: [], review: [], done: [] };
  for (const task of sortTasks(tasks)) if (matchesFilter(task, filter)) columns[task.status]?.push(task);
  return columns;
}

export function mergeTask(tasks: readonly BoardTask[], incoming: BoardTask): BoardTask[] {
  const task = normalizeTask(incoming);
  const index = tasks.findIndex((candidate) => candidate.id === task.id);
  if (index < 0) return [...tasks, task];
  if (tasks[index]!.updatedAt > task.updatedAt) return tasks as BoardTask[];
  const next = tasks.slice();
  next[index] = task;
  return next;
}

export function missionStamp(mission: BoardMission): number {
  const decision = mission.pendingDecision;
  return Math.max(
    mission.createdAt, mission.startedAt ?? 0, mission.finishedAt ?? 0, decision?.askedAt ?? 0, decision?.answeredAt ?? 0,
    ...mission.feed.map((entry) => entry.at),
  );
}

export function mergeMission(missions: readonly BoardMission[], incoming: BoardMission): BoardMission[] {
  const mission = normalizeMission(incoming);
  const index = missions.findIndex((candidate) => candidate.id === mission.id);
  if (index < 0) return [...missions, mission];
  if (missionStamp(missions[index]!) > missionStamp(mission)) return missions as BoardMission[];
  const next = missions.slice();
  next[index] = mission;
  return next;
}

const MISSION_RANK: Record<MissionStatus, number> = { waiting: 0, running: 1, planning: 1, paused: 2, failed: 3, done: 4 };

export function sortMissions(missions: readonly BoardMission[]): BoardMission[] {
  return [...missions].sort((a, b) => MISSION_RANK[a.status] - MISSION_RANK[b.status] || b.createdAt - a.createdAt);
}

export type StepState = "done" | "active" | "todo";

export interface MissionStep {
  id: number;
  task?: BoardTask;
  state: StepState;
}

export function missionSteps(mission: BoardMission, tasks: readonly BoardTask[]): MissionStep[] {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  return mission.stepIds.map((id) => {
    const task = byId.get(id);
    const state: StepState = task?.status === "done" ? "done" : task?.status === "doing" || task?.status === "review" ? "active" : "todo";
    return { id, task, state };
  });
}

export const openMissionStatuses: readonly MissionStatus[] = ["planning", "running", "waiting"];

export interface Directory {
  bot(id: string): Bot | undefined;
  assigneeName(assignee: BoardAssignee): string;
  actorName(actor: BoardActor): string;
  isMe(actor: BoardActor): boolean;
}

const emailName = (email: string) => (email.includes("@") ? email.slice(0, email.indexOf("@")) : email);

export function makeDirectory({ bots, people, me }: {
  bots: readonly Bot[];
  people: readonly BoardPerson[];
  me: { email?: string; name?: string };
}): Directory {
  const myEmail = me.email?.trim().toLowerCase();
  const personName = (email: string) => {
    const known = people.find((person) => person.id === email)?.name?.trim();
    if (known) return known;
    return myEmail === email && me.name?.trim() ? me.name.trim() : emailName(email);
  };
  const bot = (id: string) => bots.find((candidate) => candidate.id === id);
  const isMe = (actor: BoardActor) => actor.kind === "person" && (actor.id === myEmail || (actor.id === "owner" && !myEmail));
  return {
    bot,
    isMe,
    assigneeName: (assignee) => assigneeKind(assignee) === "bot" ? bot(assignee)?.name ?? t("board.actor.agent") : personName(assignee),
    actorName: (actor) => {
      if (actor.kind === "system") return actor.name?.trim() || t("board.actor.system");
      if (actor.kind === "bot") return actor.name?.trim() || bot(actor.id)?.name || t("board.actor.agent");
      if (isMe(actor)) return t("board.actor.you");
      if (actor.name?.trim()) return actor.name.trim();
      return actor.id === "owner" ? t("board.actor.owner") : personName(actor.id);
    },
  };
}
