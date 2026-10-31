import type { PersonCaller } from "./directory.ts";
import { BoardError } from "./errors.ts";

export const PERSON_PACE = {
  createsPerHour: 60,
  writesPerWindow: 240,
  writeWindowMs: 600_000,
  missionsPerHour: 10,
  cardsKept: 400,
} as const;

export const HOUR_MS = 3_600_000;
const MAX_KEYS = 5_000;

/** Counts recent actions per key; a key is refused once it has done too many inside its window. */
export class Pace {
  private readonly log = new Map<string, number[]>();

  hit(key: string, limit: number, windowMs: number, now: number): boolean {
    const recent = (this.log.get(key) ?? []).filter((at) => at > now - windowMs);
    if (recent.length >= limit) {
      this.log.set(key, recent);
      return false;
    }
    recent.push(now);
    this.log.delete(key);
    this.log.set(key, recent);
    if (this.log.size > MAX_KEYS) this.log.delete(this.log.keys().next().value!);
    return true;
  }
}

const slowDown = () => new BoardError(429, "Você mexeu no quadro muitas vezes em pouco tempo. Espere um pouco e tente de novo.");

/** A member's writes are counted; an administrator is trusted and left alone. */
export function limitPerson(pace: Pace, caller: PersonCaller, now: number, action: "card" | "mission" | "write"): void {
  if (caller.admin) return;
  const who = caller.actor.id;
  if (action === "card" && !pace.hit(`card:${who}`, PERSON_PACE.createsPerHour, HOUR_MS, now)) throw slowDown();
  if (action === "mission" && !pace.hit(`mission:${who}`, PERSON_PACE.missionsPerHour, HOUR_MS, now)) throw slowDown();
  if (!pace.hit(`write:${who}`, PERSON_PACE.writesPerWindow, PERSON_PACE.writeWindowMs, now)) throw slowDown();
}
