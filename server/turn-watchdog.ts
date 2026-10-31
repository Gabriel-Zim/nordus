// A turn whose thread emits nothing for stallMs is wedged; waiting on a person or a computer is not a stall.
export interface WatchedTurn {
  threadId: string;
  botId: string;
  startedAt: number;
  lastEventAt: number;
  waitingOnHuman: boolean;
  waitingOnComputer: boolean;
  /** Stopped once this old whatever it is doing. */
  capMs?: number;
  /** The turn is waiting on work of its own (a render running in the foreground or background): silence is not a stall. */
  busy?: () => boolean;
  /** Set when the cap, not silence, stopped it. */
  capped?: boolean;
}

export interface WatchOptions {
  capMs?: number;
  busy?: () => boolean;
}

const parked = (turn: WatchedTurn): boolean => turn.waitingOnHuman || turn.waitingOnComputer;

export interface TurnWatchdogOptions {
  stallMs: number;
  checkMs: number;
  onStall: (turn: WatchedTurn) => void;
  now?: () => number;
}

export class TurnWatchdog {
  private turns = new Map<string, WatchedTurn>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private opts: TurnWatchdogOptions;

  // No parameter properties: Node's type-stripping cannot transform them.
  constructor(opts: TurnWatchdogOptions) {
    this.opts = opts;
  }

  private now(): number {
    return this.opts.now?.() ?? Date.now();
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.sweep(), this.opts.checkMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.turns.clear();
  }

  watch(threadId: string, botId: string, options: WatchOptions = {}): void {
    const at = this.now();
    this.turns.set(threadId, { threadId, botId, startedAt: at, lastEventAt: at, waitingOnHuman: false, waitingOnComputer: false, ...options });
  }

  touch(threadId: string): void {
    const turn = this.turns.get(threadId);
    if (turn) turn.lastEventAt = this.now();
  }

  setWaitingOnHuman(threadId: string, waiting: boolean): void {
    const turn = this.turns.get(threadId);
    if (!turn) return;
    turn.waitingOnHuman = waiting;
    turn.lastEventAt = this.now();
  }

  setWaitingOnComputer(threadId: string, waiting: boolean): void {
    const turn = this.turns.get(threadId);
    if (!turn) return;
    turn.waitingOnComputer = waiting;
    turn.lastEventAt = this.now();
  }

  settle(threadId: string): void {
    this.turns.delete(threadId);
  }

  watching(threadId: string): boolean {
    return this.turns.has(threadId);
  }

  watchingBot(botId: string): boolean {
    return [...this.turns.values()].some(turn => turn.botId === botId);
  }

  waiting(threadId: string): boolean {
    const turn = this.turns.get(threadId);
    return turn !== undefined && parked(turn);
  }

  sweep(): void {
    const at = this.now();
    for (const turn of this.turns.values()) {
      if (turn.capMs !== undefined && at - turn.startedAt >= turn.capMs) {
        this.turns.delete(turn.threadId);
        this.opts.onStall({ ...turn, capped: true });
        continue;
      }
      if (parked(turn)) continue;
      if (at - turn.lastEventAt < this.opts.stallMs) continue;
      let busy = false;
      try { busy = turn.busy?.() === true; } catch {}
      if (busy) {
        turn.lastEventAt = at;
        continue;
      }
      this.turns.delete(turn.threadId);
      this.opts.onStall(turn);
    }
  }
}
