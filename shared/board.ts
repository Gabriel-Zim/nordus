// The task board and the missions on top of it: what /api/board, /api/missions and the live frames carry.

export const TASK_STATUSES = ["todo", "doing", "review", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const MISSION_STATUSES = ["planning", "running", "waiting", "paused", "done", "failed"] as const;
export type MissionStatus = (typeof MISSION_STATUSES)[number];

export const MISSION_FEED_KINDS = ["plan", "progress", "decision", "done", "error"] as const;
export type MissionFeedKind = (typeof MISSION_FEED_KINDS)[number];

export const BOARD_LIMITS = {
  title: 200,
  description: 8_000,
  note: 1_000,
  links: 20,
  linkUrl: 2_000,
  linkLabel: 100,
  history: 100,
  tasks: 2_000,
  missionTitle: 160,
  missionGoal: 4_000,
  missionTeam: 12,
  missionSteps: 20,
  missionFeed: 500,
  question: 500,
  options: 6,
  option: 120,
  answer: 2_000,
  runnerText: 4_000,
} as const;

/** `person`'s id is the person's lowercased email, or "owner" for the machine's owner when no email is known. */
export type BoardActor =
  | { kind: "person"; id: string; name?: string }
  | { kind: "bot"; id: string; name?: string }
  | { kind: "system"; name?: string };

/** A bot id, or a person's lowercased email: an "@" tells them apart. */
export type BoardAssignee = string;

export function assigneeKind(assignee: BoardAssignee): "person" | "bot" {
  return assignee.includes("@") ? "person" : "bot";
}

export interface BoardLink {
  url: string;
  label?: string;
}

/** Where the task came from: the conversation (a bot's thread or a room's) and, when known, the message. */
export interface BoardTaskSource {
  threadId: string;
  groupId?: string;
  messageId?: string;
}

/** The conversation a bot was sent to when the task was assigned to it. */
export interface BoardTaskThread {
  threadId: string;
  groupId?: string;
  botId?: string;
}

export type BoardHistoryEvent = "created" | "assigned" | "unassigned" | "edited" | "sent";

export interface BoardHistoryEntry {
  at: number;
  by: BoardActor;
  from?: TaskStatus;
  to?: TaskStatus;
  note?: string;
  event?: BoardHistoryEvent;
  /** The new assignee, on an "assigned" entry. */
  assignee?: BoardAssignee;
}

export interface BoardTask {
  /** Workspace-wide, increasing, never reused: shown as #id. */
  id: number;
  title: string;
  description?: string;
  status: TaskStatus;
  assignee?: BoardAssignee;
  createdBy: BoardActor;
  createdAt: number;
  updatedAt: number;
  source?: BoardTaskSource;
  thread?: BoardTaskThread;
  links?: BoardLink[];
  missionId?: string;
  history: BoardHistoryEntry[];
}

export interface BoardPerson {
  /** Lowercased email. */
  id: string;
  name?: string;
}

export interface MissionFeedEntry {
  at: number;
  author: BoardActor;
  kind: MissionFeedKind;
  text: string;
}

export interface MissionDecision {
  question: string;
  options?: string[];
  askedAt: number;
  askedBy: string;
  answer?: string;
  answeredAt?: number;
  answeredBy?: BoardActor;
}

export interface BoardMission {
  id: string;
  title: string;
  goal: string;
  createdBy: BoardActor;
  createdAt: number;
  status: MissionStatus;
  leadBotId: string;
  /** Every agent in the mission room, the lead included. */
  teamBotIds: string[];
  groupId: string;
  /** The room's conversation. */
  threadId: string;
  /** Ordered ids of the step tasks. */
  stepIds: number[];
  feed: MissionFeedEntry[];
  pendingDecision?: MissionDecision;
  startedAt?: number;
  finishedAt?: number;
  /** Why the mission stopped by itself or was stopped, in plain words. */
  pausedReason?: string;
  /** Admins only: the exact limit or refusal behind a pause that pausedReason names in general terms. */
  pausedDetail?: string;
  /** "system": the mission resumes by itself when the cause clears; "person": only Retomar resumes it. */
  pausedBy?: "person" | "system";
}

export interface MissionReceiptAgent {
  botId: string;
  name: string;
  turns: number;
  input: number;
  output: number;
  /** Admins only. */
  costUsd?: number | null;
}

export interface MissionReceipt {
  from: number;
  to: number;
  agents: MissionReceiptAgent[];
  total: { turns: number; input: number; output: number; costUsd?: number | null };
}

export interface BoardTasksResponse {
  tasks: BoardTask[];
}

export interface BoardTaskResponse {
  task: BoardTask;
  /** Set when assigning started work: whether the agent was reached, and why not when it was not. */
  dispatch?: { status: "sent" | "queued" | "skipped"; reason?: string };
}

export interface BoardPeopleResponse {
  people: BoardPerson[];
}

export interface MissionsResponse {
  missions: BoardMission[];
}

export interface MissionResponse {
  mission: BoardMission;
  receipt?: MissionReceipt;
}

/** The live frames. A member only receives a frame for what the member may see. */
export type BoardFrame =
  | { kind: "board.task"; task: BoardTask }
  | { kind: "board.task.deleted"; id: number }
  | { kind: "board.mission"; mission: BoardMission }
  | { kind: "board.mission.deleted"; id: string };

export function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === "string" && (TASK_STATUSES as readonly string[]).includes(value);
}

export function isBoardFrameKind(kind: unknown): kind is BoardFrame["kind"] {
  return kind === "board.task" || kind === "board.task.deleted" || kind === "board.mission" || kind === "board.mission.deleted";
}
