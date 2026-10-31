import {
  MAX_ROOM_TURN_TIMEOUT_MINUTES,
  MIN_ROOM_TURN_TIMEOUT_MINUTES,
} from "./config.ts";

export function roomTurnTimeoutMs(minutes: number): number {
  return minutes * 60_000;
}

export function parseConversationTurnTimeout(
  value: unknown,
): { ok: true; minutes: number | null } | { ok: false; error: string } {
  if (value === null) return { ok: true, minutes: null };
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < MIN_ROOM_TURN_TIMEOUT_MINUTES ||
    value > MAX_ROOM_TURN_TIMEOUT_MINUTES
  ) {
    return {
      ok: false,
      error: "Turn limit must be a whole number from 1 to 1,440, or null to use the group default.",
    };
  }
  return { ok: true, minutes: value };
}

export function effectiveRoomTurnTimeoutMinutes(
  globalMinutes: number,
  override: number | null | undefined,
): number {
  if (
    typeof override === "number" &&
    Number.isInteger(override) &&
    override >= MIN_ROOM_TURN_TIMEOUT_MINUTES &&
    override <= MAX_ROOM_TURN_TIMEOUT_MINUTES
  ) {
    return override;
  }
  return globalMinutes;
}

/** Nordus: the turn's ceiling by the size of the request; the safety ceiling caps it. */
export const ROOM_TURN_MINUTES_BY_SIZE = { light: 5, normal: 30, heavy: 120 } as const;
/** Without the decision model's size. */
export const ROOM_TURN_MINUTES_UNSURE = 30;
/** At the ceiling a bot that worked within this window keeps going, this much at a time, up to the safety ceiling. */
export const ROOM_TURN_ACTIVE_WINDOW_MS = 3 * 60_000;
export const ROOM_TURN_EXTENSION_MS = 5 * 60_000;

export function roomTurnCeilingMinutes(size: keyof typeof ROOM_TURN_MINUTES_BY_SIZE | null, safetyMinutes: number): number {
  return Math.min(size ? ROOM_TURN_MINUTES_BY_SIZE[size] : ROOM_TURN_MINUTES_UNSURE, safetyMinutes);
}

/** Counts work, not wall time: the clock holds while the turn waits on a card, and stray resolves clamp the count at zero. */
export class RoomTurnDeadline {
  private remainingMs: number;
  private workedMs = 0;
  private lastActivity = Date.now();
  private hardMs: number;
  private now: () => number;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private openRequests = 0;
  private stopped = false;
  private fired = false;
  private armedAt = 0;
  private fire: () => void;

  // No parameter properties: Node's type-stripping cannot transform them.
  /** `hardMinutes`: a bot still producing at `minutes` keeps going until this; absent stops at `minutes`. */
  constructor(minutes: number, fire: () => void, options: { hardMinutes?: number; now?: () => number } = {}) {
    this.remainingMs = roomTurnTimeoutMs(minutes);
    this.hardMs = roomTurnTimeoutMs(Math.max(minutes, options.hardMinutes ?? minutes));
    this.fire = fire;
    this.now = options.now ?? Date.now;
    this.lastActivity = this.now();
  }

  /** Any sign of work: a tool, text, a file. */
  touch(): void {
    this.lastActivity = this.now();
  }

  start(): void {
    this.arm();
  }

  setWaitingOnHuman(waiting: boolean): void {
    if (this.stopped || this.fired) return;
    if (waiting) {
      const wasIdle = this.openRequests === 0;
      this.openRequests += 1;
      if (wasIdle) this.hold();
    } else if (this.openRequests > 0) {
      this.openRequests -= 1;
      if (this.openRequests === 0) this.arm();
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private hold(): void {
    if (this.timer === null) return;
    this.workedMs += this.now() - this.armedAt;
    this.remainingMs -= this.now() - this.armedAt;
    clearTimeout(this.timer);
    this.timer = null;
    // A delayed event loop can deliver the card event after the deadline: a person's wait must not extend an exhausted budget.
    if (this.remainingMs <= 0) this.expired();
  }

  private arm(): void {
    if (this.stopped || this.fired || this.openRequests > 0) return;
    if (this.remainingMs <= 0) {
      this.expired();
      return;
    }
    this.armedAt = this.now();
    this.timer = setTimeout(() => {
      this.timer = null;
      this.workedMs += this.now() - this.armedAt;
      this.remainingMs = 0;
      // Still producing: never cut by time alone while under the safety ceiling.
      const left = this.hardMs - this.workedMs;
      if (left > 0 && this.now() - this.lastActivity < ROOM_TURN_ACTIVE_WINDOW_MS) {
        this.remainingMs = Math.min(ROOM_TURN_EXTENSION_MS, left);
        this.arm();
        return;
      }
      this.expired();
    }, this.remainingMs);
  }

  private expired(): void {
    if (this.stopped || this.fired) return;
    this.fired = true;
    this.fire();
  }
}

export class RoomTurnStallRegistry {
  private handlers = new Map<string, () => void>();

  register(threadId: string, handler: () => void): () => void {
    this.handlers.set(threadId, handler);
    return () => {
      if (this.handlers.get(threadId) === handler) this.handlers.delete(threadId);
    };
  }

  stall(threadId: string): boolean {
    const handler = this.handlers.get(threadId);
    if (!handler) return false;
    this.handlers.delete(threadId);
    handler();
    return true;
  }
}

export function roomTurnTimeoutMessage(botName: string, minutes: number): string {
  return `${botName} parou: passou de ${minutes} ${minutes === 1 ? "minuto" : "minutos"} sem terminar`;
}
