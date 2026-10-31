/** Durable progress receipt for one goal-driven channel run. */
export type GroupGoalRunStatus =
  | "working"
  | "completed"
  | "needs-input"
  | "blocked"
  | "limit-reached"
  /** The operator (or a guard) parked the run. */
  | "paused"
  | "stopped"
  | "failed";

export interface GroupGoalRunCardData {
  runId: string;
  goal: string;
  status: GroupGoalRunStatus;
  coordinatorBotId: string;
  coordinatorName: string;
  turnCount: number;
  maxTurns: number;
  detail?: string;
  startedAt: number;
  finishedAt?: number;
  /** A goal given in a direct conversation also has a deadline and keeps its observed steps. */
  deadlineAt?: number;
  steps?: { turn: number; at: number; detail: string }[];
}
