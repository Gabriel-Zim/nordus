// Nordus: news the decision model rated normal waits here for one summary banner a day.
import { join } from "node:path";

import type { Notification, NotifyKind } from "../shared/notification.ts";
import { writeFileAtomic } from "./atomic.ts";
import { isJsonObject, readJsonState } from "./state-file.ts";

/** Kinds that wait on the person: always a banner, never asked. */
export const JEV_ALWAYS_URGENT: ReadonlySet<NotifyKind> = new Set<NotifyKind>(["approval", "question", "sign-in", "spend", "incident", "daily-digest"]);
/** Local hour the summary goes out. */
export const DAILY_DIGEST_HOUR = 18;
const HELD_MAX = 200;
const FILE = "notify-digest.json";

interface Held { at: number; botId: string; botName: string; threadId: string; title: string }
interface State { day: string; sentDay?: string; held: Held[] }
const isState = (value: unknown): value is State => isJsonObject(value) && Array.isArray(value.held);

export function localDay(at: number, timeZone: string): { day: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(at);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return { day: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) };
}

export function digestText(held: readonly Held[]): { title: string; body: string } {
  const count = held.length;
  const lines = held.slice(-4).map((item) => `${item.botName}: ${item.title}`);
  return { title: `Resumo do dia: ${count} ${count === 1 ? "novidade" : "novidades"}`, body: lines.join(" · ").slice(0, 300) };
}

/** `send` takes the audience with the summary: its lines name the bots and rooms of every client, so it goes to administrators only. */
export function createDailyDigest(deps: { dataDir: string; timeZone(): string; send(summary: Notification, audience: { adminOnly: true }): void; now?: () => number }) {
  const now = deps.now ?? Date.now;
  const path = join(deps.dataDir, FILE);
  const saved = readJsonState(path, isState);
  let state: State = saved.status === "ok" ? saved.value : { day: localDay(now(), deps.timeZone()).day, held: [] };
  const save = () => {
    try { writeFileAtomic(path, JSON.stringify(state), { mode: 0o600 }); } catch { /* a full disk loses the summary, never a turn */ }
  };
  return {
    /** Only news meant for everyone: what was for named people is not theirs to hand to the admins' summary, which names a conversation. */
    hold(entry: Notification & { at?: number }): void {
      if (entry.toPersons?.length) return;
      state.held.push({ at: entry.at ?? now(), botId: entry.botId, botName: entry.botName, threadId: entry.threadId, title: entry.title });
      if (state.held.length > HELD_MAX) state.held.splice(0, state.held.length - HELD_MAX);
      save();
    },
    held(): readonly Held[] {
      return state.held;
    },
    /** Sends once a day, at or after the hour, when something was held. */
    tick(): boolean {
      const { day, hour } = localDay(now(), deps.timeZone());
      if (hour < DAILY_DIGEST_HOUR || state.sentDay === day || !state.held.length) return false;
      const last = state.held[state.held.length - 1]!;
      const text = digestText(state.held);
      deps.send({ kind: "daily-digest", botId: last.botId, botName: last.botName, threadId: last.threadId, title: text.title, body: text.body }, { adminOnly: true });
      state = { day, sentDay: day, held: [] };
      save();
      return true;
    },
  };
}
