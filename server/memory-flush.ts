// Before a conversation is folded into a summary, its folded part goes through memory capture once, so a fact said
// there lands in MEMORY.md or a topic file instead of being lost to the summary.
import type { ReplayEntry } from "./context-rebuild.ts";
import type { CaptureTurn } from "./memory-capture.ts";

/** Capture starts at 70% of the window, ahead of compaction at 80%. */
export const MEMORY_FLUSH_SHARE = 0.7;
export const MEMORY_FLUSH_TIMEOUT_MS = 60_000;

/** The point to capture at: 70% of the window, never later than the compaction point itself. */
export function memoryFlushThreshold(window: number, compactAt: number): number {
  return Math.max(1, Math.min(compactAt, Math.floor(window * MEMORY_FLUSH_SHARE)));
}

/** Pairs each person message with the replies after it, as the capture expects. */
export function captureTurnsFrom(entries: readonly ReplayEntry[]): CaptureTurn[] {
  const turns: CaptureTurn[] = [];
  for (const entry of entries) {
    const text = entry.text.trim();
    if (!text) continue;
    const last = turns.at(-1);
    if (entry.role === "user") turns.push({ person: text, bot: "", owner: false });
    else if (last) last.bot = last.bot ? `${last.bot}\n${text}` : text;
    else turns.push({ person: "", bot: text, owner: false });
  }
  return turns;
}

/** Remembers, per conversation, which compaction a capture already ran for: once per compaction, not per turn. */
export class MemoryFlushes {
  private readonly done = new Map<string, string>();

  due(threadId: string, compactionKey: string): boolean {
    return this.done.get(threadId) !== compactionKey;
  }

  mark(threadId: string, compactionKey: string): void {
    this.done.set(threadId, compactionKey);
  }
}

/** Runs the capture, waiting at most the timeout; compaction goes on either way. */
export async function flushBeforeCompaction(
  turns: readonly CaptureTurn[],
  capture: (turns: readonly CaptureTurn[]) => Promise<unknown>,
  timeoutMs = MEMORY_FLUSH_TIMEOUT_MS,
): Promise<"captured" | "timeout" | "failed" | "empty"> {
  if (!turns.length) return "empty";
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => { timer = setTimeout(() => resolve("timeout"), timeoutMs); timer.unref?.(); });
  try {
    return await Promise.race([capture(turns).then(() => "captured" as const, () => "failed" as const), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
