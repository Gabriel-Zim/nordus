// Copyright 2026 Hodle Tecnologia Ltda and touri contributors
// Licensed under the Apache License, Version 2.0 (http://www.apache.org/licenses/LICENSE-2.0).
// Adapted from packages/contracts/src/notification-preferences.ts (isQuietHour, canDeliverNotification); modified for Nordus.
import type { NotifyKind } from "./notification.ts";

/** Hours when a push stays silent. Times are "HH:MM" in `timeZone` (the server's own when absent); start after end
 * wraps past midnight. */
export interface QuietHours {
  enabled: boolean;
  start: string;
  end: string;
  /** IANA zone of the device that set the hours. */
  timeZone?: string;
}

export const DEFAULT_QUIET_HOURS: QuietHours = { enabled: false, start: "22:00", end: "08:00" };

/** Kinds that wait on the person, and the spend alert: they ring even in quiet hours. */
export const RINGS_IN_QUIET_HOURS: ReadonlySet<NotifyKind> = new Set<NotifyKind>(["approval", "question", "sign-in", "spend"]);

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

function knownTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function parseQuietHours(value: unknown): QuietHours | null {
  if (!value || typeof value !== "object") return null;
  const { enabled, start, end, timeZone } = value as Record<string, unknown>;
  if (typeof enabled !== "boolean" || typeof start !== "string" || typeof end !== "string") return null;
  if (!CLOCK.test(start) || !CLOCK.test(end)) return null;
  if (timeZone !== undefined && !knownTimeZone(timeZone)) return null;
  return { enabled, start, end, ...(timeZone ? { timeZone } : {}) };
}

/** Minutes past midnight at `at`, in `timeZone`. */
export function clockMinutes(at: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
  const part = (type: string) => Number(parts.find((candidate) => candidate.type === type)?.value ?? 0);
  return part("hour") * 60 + part("minute");
}

export function isQuietHour(quiet: QuietHours, minutes: number): boolean {
  if (!quiet.enabled) return false;
  const start = minutesOf(quiet.start);
  const end = minutesOf(quiet.end);
  if (start === end) return true;
  return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}

/** Whether a push may sound now. A silent one is still saved to the feed and counted. */
export function notificationRings(kind: NotifyKind, quiet: QuietHours, minutes: number): boolean {
  return RINGS_IN_QUIET_HOURS.has(kind) || !isQuietHour(quiet, minutes);
}
