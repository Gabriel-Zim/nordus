import { replaceUnsafe } from "../../shared/knowledge-path.ts";
import type { WireKnowledgeActor } from "../../shared/knowledge.ts";

/** Who saved something: an agent, or a person. A bot keeps the audience it had then, so what it wrote stays hidden from the same people after it is deleted. */
export type KnowledgeActor =
  | { kind: "bot"; id: string; name: string; visibility?: unknown }
  | { kind: "person"; name: string; key?: string; email?: string };

export function toWireActor(actor: KnowledgeActor): WireKnowledgeActor {
  return actor.kind === "bot" ? { kind: "bot", id: actor.id, name: actor.name } : { kind: "person", name: actor.name };
}

export function sameActor(a: KnowledgeActor, b: KnowledgeActor): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "bot" && b.kind === "bot") return a.id === b.id;
  if (a.kind !== "person" || b.kind !== "person") return false;
  if (a.key && b.key) return a.key === b.key;
  return Boolean(a.email && b.email && a.email.toLowerCase() === b.email.toLowerCase());
}

export function actorKey(actor: KnowledgeActor): string {
  return actor.kind === "bot" ? `bot:${actor.id}` : `person:${actor.key ?? actor.email?.toLowerCase() ?? actor.name}`;
}

const NAME_MAX = 120;

/** What gets stored: only fields this module reads, bounded, so an index never grows from a caller's extra fields. */
export function storableActor(actor: KnowledgeActor): KnowledgeActor {
  const name = replaceUnsafe(actor.name.normalize("NFC"), " ").trim().slice(0, NAME_MAX) || "?";
  if (actor.kind === "bot") {
    const visible = actor.visibility !== undefined && actor.visibility !== null && actor.visibility !== "everyone";
    return { kind: "bot", id: actor.id.slice(0, 128), name, ...(visible ? { visibility: structuredClone(actor.visibility) } : {}) };
  }
  return { kind: "person", name, ...(actor.key ? { key: actor.key.slice(0, 128) } : {}), ...(actor.email ? { email: actor.email.slice(0, 320) } : {}) };
}

/** Whether the asker may see what this author wrote. */
export type Sees = (actor: KnowledgeActor) => boolean;

export const SEES_ALL: Sees = () => true;

/** Something shown to the asker only when every author who ever touched it is shown to them too. */
export function visibleHistory(record: { createdBy: KnowledgeActor; versions: ReadonlyArray<{ by: KnowledgeActor }> }, sees: Sees): boolean {
  return sees(record.createdBy) && record.versions.every((version) => sees(version.by));
}
