import type { Message } from "@/state/store";

function chainsOntoOtherBranch(messages: readonly Message[], leafId: string | null | undefined, added: Message): boolean {
  if (!added.parentId || added.kind === "screen") return false;
  const byId = new Map(messages.map((m) => [m.id, m]));
  if (!byId.has(added.parentId) || !leafId || !byId.has(leafId)) return false;
  for (let cur = byId.get(leafId); cur; cur = cur.parentId ? byId.get(cur.parentId) : undefined) {
    if (cur.id === added.parentId) return false;
  }
  return true;
}

/**
 * Whether a live message becomes the open leaf. One parented off the leaf continues it; one chained onto a branch the
 * leaf is not on means the server's leaf moved there, so the view follows it. A late mid-chain insert or a screen frame
 * leaves the leaf where it is.
 */
export function adoptsMessageLeaf(messages: readonly Message[], leafId: string | null | undefined, added: Message): boolean {
  return (added.parentId ?? null) === (leafId ?? null) || chainsOntoOtherBranch(messages, leafId, added);
}
