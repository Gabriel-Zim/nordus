import type { Reply } from "./runtime/types.ts";

export function roomRequestLine(id: string, reply: Reply): { id: string; phase: "request"; awaited?: true } {
  return reply === "none" ? { id, phase: "request" } : { id, phase: "request", awaited: true };
}
