import type { Status } from "./types.ts";

export interface WaitNode {
  id: string;
  parentId?: string;
  status: Status;
  awaited: boolean;
  lastActivityAt: number;
  turnAlive: boolean;
  continuation: boolean;
}

export interface WaitVerdict {
  cancel: { id: string; reason: string }[];
  wake: string[];
}

export const ORPHAN_REASON = "the colleague was interrupted and did not resume";

const ended = (n: WaitNode): boolean => n.status === "completed" || n.status === "failed" || n.status === "cancelled";

export function judgeWaits(nodes: readonly WaitNode[], now: number, windowMs: number): WaitVerdict {
  const children = new Map<string, WaitNode[]>();
  for (const n of nodes) if (n.parentId !== undefined) children.set(n.parentId, [...children.get(n.parentId) ?? [], n]);
  const open = (id: string): WaitNode[] => (children.get(id) ?? []).filter(c => c.awaited && !ended(c));

  const memo = new Map<string, boolean>();
  const alive = (n: WaitNode): boolean => {
    const known = memo.get(n.id);
    if (known !== undefined) return known;
    memo.set(n.id, false);
    const below = open(n.id).some(alive);
    const own = n.status === "needs_input" || n.continuation || n.turnAlive || now - n.lastActivityAt <= windowMs;
    const result = n.status === "waiting" ? below : below || own;
    memo.set(n.id, result);
    return result;
  };

  const verdict: WaitVerdict = { cancel: [], wake: [] };
  const judged = new Set<string>();
  const walk = (n: WaitNode, parentOrphan: boolean): void => {
    const orphan = n.status !== "waiting" && !alive(n);
    if (orphan && !parentOrphan) verdict.cancel.push({ id: n.id, reason: ORPHAN_REASON });
    for (const child of open(n.id)) {
      if (judged.has(child.id)) continue;
      judged.add(child.id);
      walk(child, parentOrphan || orphan);
    }
  };
  for (const n of nodes) {
    if (n.status !== "waiting") continue;
    if ((children.get(n.id) ?? []).every(c => !c.awaited)) { verdict.wake.push(n.id); continue; }
    for (const child of open(n.id)) {
      if (judged.has(child.id)) continue;
      judged.add(child.id);
      walk(child, false);
    }
  }
  return verdict;
}
