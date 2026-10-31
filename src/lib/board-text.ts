import { activeLocale, t } from "@/lib/i18n";
import { plainErrorLine } from "@/lib/plain-error";
import type { LocaleKey } from "@/locales";
import type { BoardHistoryEntry, BoardMission, BoardTask, BoardTaskResponse, TaskStatus } from "../../shared/board";
import { COLUMN_LABEL, type Directory } from "./board";

const pad = (value: number) => String(value).padStart(2, "0");

export function clock(at: number): string {
  const date = new Date(at);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const calendarDay = (date: Date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());

export function daysBetween(from: number, to: number): number {
  return Math.round((calendarDay(new Date(to)) - calendarDay(new Date(from))) / 86_400_000);
}

export function whenText(at: number, now = Date.now()): string {
  const days = daysBetween(at, now);
  if (days === 0) return t("board.when.today", { time: clock(at) });
  if (days === 1) return t("board.when.yesterday");
  return t("board.when.date", { date: new Intl.DateTimeFormat(activeLocale(), { day: "numeric", month: "short" }).format(new Date(at)) });
}

export function dateTimeText(at: number): string {
  return new Intl.DateTimeFormat(activeLocale(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(at));
}

export function missionDay(at: number, since: number): number {
  return Math.max(1, daysBetween(since, at) + 1);
}

export function feedStamp(at: number, mission: Pick<BoardMission, "startedAt" | "createdAt">): string {
  return t("missions.feed.stamp", { day: missionDay(at, mission.startedAt ?? mission.createdAt), time: clock(at) });
}

const HINT: Record<TaskStatus, LocaleKey> = {
  todo: "board.hint.todo", doing: "board.hint.doing", review: "board.hint.review", done: "board.hint.done",
};

export function taskHint(task: BoardTask, now = Date.now()): string {
  const move = [...task.history].reverse().find((entry) => entry.to === task.status);
  const since = move?.at ?? (task.status === "todo" ? task.createdAt : task.updatedAt);
  return t(HINT[task.status], { when: whenText(since, now) });
}

export function historyLine(entry: BoardHistoryEntry, directory: Directory): string {
  const who = directory.actorName(entry.by);
  const name = entry.assignee ? directory.assigneeName(entry.assignee) : "";
  if (entry.event === "created") return t("board.history.created", { who });
  if (entry.event === "assigned") return name ? t("board.history.assigned", { who, name }) : t("board.history.unassigned", { who });
  if (entry.event === "unassigned") return t("board.history.unassigned", { who });
  if (entry.event === "edited") return t("board.history.edited", { who });
  if (entry.event === "sent") return t("board.history.sent", { who });
  if (entry.from && entry.to) return t("board.history.moved", { who, from: t(COLUMN_LABEL[entry.from]), to: t(COLUMN_LABEL[entry.to]) });
  if (entry.to) return t("board.history.movedTo", { who, to: t(COLUMN_LABEL[entry.to]) });
  return t("board.history.updated", { who });
}

export function dispatchLine(answer: Pick<BoardTaskResponse, "dispatch">, name: string): string | null {
  const result = answer.dispatch;
  if (!result) return null;
  if (result.status === "sent") return t("board.dispatch.sent", { name });
  if (result.status === "queued") return t("board.dispatch.queued", { name });
  return result.reason ? t("board.dispatch.skipped", { name, reason: result.reason }) : t("board.dispatch.skippedNoReason", { name });
}

export function errorText(error: unknown): string {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return raw.trim() ? plainErrorLine(raw) ?? raw : t("board.error.generic");
}

export const formatCount = (value: number) => value.toLocaleString(activeLocale());

export function formatUsd(value: number): string {
  return new Intl.NumberFormat(activeLocale(), { style: "currency", currency: "USD" }).format(value);
}
