import type { Message } from "./store.ts";

/** Tool calls the turn that just failed had started, finished or not (a call cut off mid-run may still have
 * acted): the rows of `turnId` when known, else every row since the last thing the person said.
 * A positive count means retrying from scratch could do the work twice. */
export function turnDoneCount(rows: readonly Message[], turnId?: string): number {
  let count = 0;
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index]!;
    if (turnId === undefined && row.role === "user") break;
    if (turnId !== undefined && row.turnId !== turnId) continue;
    if (row.kind === "activity" && row.tool?.itemId) count += 1;
  }
  return count;
}
