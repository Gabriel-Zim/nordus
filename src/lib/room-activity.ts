import type { Message } from "@/state/store";
import { isStatusActivity } from "@/lib/activity-runs";
import { isBrowserGoalTool } from "@/lib/browser-goal";
import { failedTurnCause } from "../../shared/failed-turn";

export function roomActivityVisible(message: Message, showToolCalls: boolean): boolean {
  const tool = message.tool;
  if (message.kind !== "activity" || !tool) return false;
  if (message.comm || message.threadRef || message.dataResult || isStatusActivity(message)) return true;
  if (isBrowserGoalTool(tool.name, tool.input)) return true;
  // Nordus: a step that failed and the bot works around stays out of the room; only a turn that failed outright shows.
  return failedTurnCause(tool.name) !== null || showToolCalls;
}
