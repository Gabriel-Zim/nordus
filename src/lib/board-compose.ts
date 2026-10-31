import { useSyncExternalStore } from "react";
import { BOARD_LIMITS } from "../../shared/board";
import type { BoardTaskSource } from "../../shared/board";

export const TITLE_FROM_MESSAGE_CHARS = 120;

export interface MessageTask {
  threadId: string;
  groupId?: string;
  messageId: string;
  text: string;
}

export interface TaskDraft {
  title: string;
  description: string;
  source: BoardTaskSource;
}

const LEADING_MARKUP = /^(?:#{1,6}\s+|[-*+]\s+|>\s+|\d+[.)]\s+)/;

function plainLine(line: string): string {
  return line.trim().replace(LEADING_MARKUP, "").replace(/\*\*|__/g, "").replace(/\s+/g, " ").trim();
}

export function draftFromMessage(message: MessageTask): TaskDraft {
  const lines = message.text.replace(/\r\n?/g, "\n").split("\n");
  const start = lines.findIndex((line) => plainLine(line));
  const first = start < 0 ? "" : plainLine(lines[start]!);
  let title = first;
  let spill = "";
  if (first.length > TITLE_FROM_MESSAGE_CHARS) {
    const space = first.lastIndexOf(" ", TITLE_FROM_MESSAGE_CHARS);
    const at = space > TITLE_FROM_MESSAGE_CHARS / 2 ? space : TITLE_FROM_MESSAGE_CHARS;
    title = `${first.slice(0, at).trimEnd()}…`;
    spill = first.slice(at).trim();
  }
  const description = [spill, ...(start < 0 ? [] : lines.slice(start + 1))].join("\n").trim().slice(0, BOARD_LIMITS.description);
  const { threadId, groupId, messageId } = message;
  return { title, description, source: { threadId, ...(groupId ? { groupId } : {}), messageId } };
}

let draft: TaskDraft | null = null;
const listeners = new Set<() => void>();

function publish(next: TaskDraft | null): void {
  draft = next;
  for (const listener of listeners) listener();
}

export function openTaskFromMessage(message: MessageTask): void {
  publish(draftFromMessage(message));
}

export function closeTaskDraft(): void {
  if (draft) publish(null);
}

export function useTaskDraft(): TaskDraft | null {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, () => draft, () => null);
}

export interface BoardFocus {
  taskId?: number;
  missionId?: string;
}

let focus: BoardFocus | null = null;

export function requestBoardFocus(next: BoardFocus): void {
  focus = next;
}

export function takeBoardFocus(): BoardFocus | null {
  const taken = focus;
  focus = null;
  return taken;
}
