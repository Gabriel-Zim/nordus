import type { Message } from "./store.ts";

export const DELIVERED_ATTACHMENTS_MAX = 12;

/** What a teammate attached to its own text lines in its conversation from the request line on, for the one who asked. */
export function deliveredAttachments(rows: readonly Message[], requestId: string, max = DELIVERED_ATTACHMENTS_MAX): NonNullable<Message["attachments"]> {
  const start = rows.findIndex(m => m.roomRequest?.id === requestId && m.roomRequest.phase === "request");
  if (start < 0) return [];
  const seen = new Set<string>();
  const out: NonNullable<Message["attachments"]> = [];
  for (const m of rows.slice(start + 1)) {
    if (m.role !== "bot" || m.kind !== "text" || !m.attachments?.length) continue;
    for (const a of m.attachments) {
      if (a.kind === "audio" || seen.has(a.path)) continue;
      seen.add(a.path);
      out.push(a);
      if (out.length >= max) return out;
    }
  }
  return out;
}
