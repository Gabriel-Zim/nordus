import { randomUUID } from "node:crypto";

export interface LiveStreamStorage {
  load(): { id: string; reserved: number } | null;
  save(state: { id: string; reserved: number }): void;
}

export interface ReplayEntry {
  seq: number;
  kind: string;
  frame: string | null;
  clientFrame: string | null;
  payload: Record<string, unknown> | null;
}

/** Seqs handed out per write of the reservation: a crash loses at most this many numbers, never reuses one. */
export const SEQ_BLOCK = 10_000;
/** Past this a delta snapshot (the thin bot list and the changed conversations, about 100 KB compressed) costs a device less
 * than replaying every frame through its reducer. */
export const REPLAY_MAX_FRAMES = 5_000;
export const REPLAY_MAX_CHARS = 2 * 1024 * 1024;

export interface LiveStream {
  readonly id: string;
  /** Every seq at or below this was handed out by an earlier process, whose in-memory state no frame replays. */
  readonly boot: number;
  last(): number;
  next(): number;
  cursor(seq?: number): string;
  /** A seq this stream issued, or null for another stream's cursor, a malformed one, or one from the future. */
  parse(raw: string | string[] | null | undefined): number | null;
  remember(entry: ReplayEntry): void;
  /** Everything after `since`, or null when the ring no longer holds all of it. */
  replayAfter(since: number): ReplayEntry[] | null;
}

export function openLiveStream(
  storage: LiveStreamStorage,
  options: { now?: () => number; newId?: () => string; maxFrames?: number; maxChars?: number } = {},
): LiveStream {
  const saved = storage.load();
  const id = saved?.id ?? (options.newId ?? (() => randomUUID().slice(0, 8)))();
  // The clock floor keeps seqs rising when a restored backup brings back an older reservation.
  const boot = Math.max(saved?.reserved ?? 0, (options.now ?? Date.now)()) + 1;
  let last = boot;
  let reserved = boot + SEQ_BLOCK;
  storage.save({ id, reserved });

  const maxFrames = options.maxFrames ?? REPLAY_MAX_FRAMES;
  const maxChars = options.maxChars ?? REPLAY_MAX_CHARS;
  const ring: ReplayEntry[] = [];
  let head = 0;
  let chars = 0;
  let floor = boot;
  const size = (entry: ReplayEntry) => (entry.frame?.length ?? 0) + (entry.clientFrame !== entry.frame ? entry.clientFrame?.length ?? 0 : 0);

  return {
    id,
    boot,
    last: () => last,
    next() {
      last += 1;
      if (last > reserved) {
        reserved = last + SEQ_BLOCK;
        storage.save({ id, reserved });
      }
      return last;
    },
    cursor: (seq = last) => `${id}:${seq}`,
    parse(raw) {
      const value = Array.isArray(raw) ? raw[0] : raw;
      if (!value) return null;
      const [stream, seq] = value.split(":");
      if (stream !== id) return null;
      const parsed = Number(seq);
      return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= last ? parsed : null;
    },
    remember(entry) {
      ring.push(entry);
      chars += size(entry);
      while (ring.length - head > maxFrames || (chars > maxChars && ring.length - head > 1)) {
        const evicted = ring[head]!;
        chars -= size(evicted);
        floor = evicted.seq;
        head += 1;
      }
      if (head > 1024 && head * 2 > ring.length) {
        ring.splice(0, head);
        head = 0;
      }
    },
    replayAfter(since) {
      if (since < floor || since > last) return null;
      const out: ReplayEntry[] = [];
      for (let index = head; index < ring.length; index += 1) {
        if (ring[index]!.seq > since) out.push(ring[index]!);
      }
      return out;
    },
  };
}
