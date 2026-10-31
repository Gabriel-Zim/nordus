// Nordus: a team goal leaves no card in the conversation, running or ended. While it runs, the status line under the
// conversation says who is working and the round; at the end the coordinator delivers the result (or asks the person)
// as an ordinary message. Rounds and who did what stay in the goal's record, never in the chat.
import type { Message } from "@/state/store";

/** The running goal, for the status line: the round being worked now and, for a direct goal, the minutes left. */
export function runningGoal(
  messages: readonly Message[],
  now = Date.now(),
): { turn: number; max: number; minutesLeft?: number } | null {
  const run = messages.findLast((message) => message.kind === "goal.run" && message.goalRun)?.goalRun;
  if (!run || run.status !== "working") return null;
  // A direct goal counts the turn it starts; a team goal counts each round once a member claims it.
  if (run.deadlineAt !== undefined) {
    return {
      turn: Math.max(1, Math.min(run.turnCount, run.maxTurns)),
      max: run.maxTurns,
      minutesLeft: Math.max(0, Math.ceil((run.deadlineAt - now) / 60_000)),
    };
  }
  return { turn: Math.max(1, Math.min(run.turnCount + 1, run.maxTurns)), max: run.maxTurns };
}

/** The goal's receipt never shows in the transcript. */
export function placeGoalRuns<M extends Pick<Message, "kind">>(messages: readonly M[]): M[] {
  return messages.filter((message) => message.kind !== "goal.run");
}

export function GoalRunCard(_props: { message: Message }) {
  return null;
}
