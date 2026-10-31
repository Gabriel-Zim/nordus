import { toolSurfaceKind } from "../../shared/tool-surface";
import { isBrowserGoalTool } from "@/lib/browser-goal";

type ToolMessage = { id: string; tool?: { name: string; ok?: boolean; input?: string } };

function browserTool(name: string, input?: string): boolean {
  return toolSurfaceKind(name) === "browser" || isBrowserGoalTool(name, input);
}

export function runningBrowserStep(messages: readonly ToolMessage[]): string | null {
  for (let index = messages.length - 1; index >= 0; index--) {
    const tool = messages[index]!.tool;
    if (tool && tool.ok === undefined && browserTool(tool.name, tool.input)) return messages[index]!.id;
  }
  return null;
}

type TurnMessage = ToolMessage & { role?: string };

/**
 * The newest browser step of the bot's current turn, whether a one-line step or a goal, or null when it has not used
 * its browser since the person last wrote, or when that step closed it.
 */
export function browserInUse(messages: readonly TurnMessage[]): string | null {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!;
    if (message.role === "user") return null;
    const tool = message.tool;
    if (!tool || !browserTool(tool.name, tool.input)) continue;
    return /(?:^|_)close$/u.test(tool.name.toLowerCase()) ? null : message.id;
  }
  return null;
}
