import { nameOf } from "../../shared/knowledge-path.ts";
import {
  previewKindFor,
  type DriveFileItem,
  type DriveTrashItem,
  type DriveVersionItem,
  type WikiBacklink,
  type WikiPageSummary,
  type WikiTrashItem,
  type WikiVersionItem,
} from "../../shared/knowledge.ts";
import { sameActor, toWireActor, type KnowledgeActor } from "./actors.ts";
import type { KnowledgeAccess } from "./audience.ts";
import { current, type DriveEntryRecord, type DriveVersionRecord } from "./drive-store.ts";
import { mimeForName } from "./content-types.ts";
import { currentVersion, type WikiPageRecord, type WikiVersionRecord } from "./wiki-store.ts";

export interface Requester {
  access: KnowledgeAccess;
  actor: KnowledgeActor;
}

/** An admin may delete anything; anyone else only what they first saved themselves. What an agent made, or what someone else made, stays unless an admin removes it. */
export function mayDelete(who: Requester, createdBy: KnowledgeActor): boolean {
  if (who.access.admin) return true;
  return who.actor.kind === "person" && sameActor(who.actor, createdBy);
}

export const mayDeleteFile = (who: Requester, entry: DriveEntryRecord) => mayDelete(who, entry.createdBy);
export const mayDeletePage = (who: Requester, page: WikiPageRecord) => mayDelete(who, page.createdBy);

export function toDriveFile(entry: DriveEntryRecord, who: Requester): DriveFileItem {
  const latest = current(entry);
  const name = nameOf(entry.path);
  return {
    kind: "file",
    name,
    path: entry.path,
    mime: mimeForName(name),
    size: latest.size,
    updatedAt: latest.at,
    by: toWireActor(latest.by),
    versions: entry.versions.length,
    preview: previewKindFor(name),
    canDelete: mayDeleteFile(who, entry),
  };
}

export function toDriveVersion(entry: DriveEntryRecord, version: DriveVersionRecord): DriveVersionItem {
  return {
    n: version.n,
    size: version.size,
    at: version.at,
    by: toWireActor(version.by),
    ...(version.note ? { note: version.note } : {}),
    current: version === current(entry),
  };
}

export function toDriveTrash(entry: DriveEntryRecord): DriveTrashItem {
  return {
    id: entry.id,
    path: entry.path,
    name: nameOf(entry.path),
    size: current(entry).size,
    versions: entry.versions.length,
    deletedAt: entry.deleted!.at,
    deletedBy: toWireActor(entry.deleted!.by),
  };
}

export function toWikiSummary(page: WikiPageRecord, who: Requester): WikiPageSummary {
  const latest = currentVersion(page);
  return {
    id: page.id,
    title: page.title,
    folder: page.folder,
    aliases: page.analysis.aliases,
    tags: page.analysis.tags,
    excerpt: page.analysis.excerpt,
    updatedAt: latest.at,
    updatedBy: toWireActor(latest.by),
    versions: page.versions.length,
    canDelete: mayDeletePage(who, page),
  };
}

export function toWikiBacklink(page: WikiPageRecord, context: string): WikiBacklink {
  return { id: page.id, title: page.title, folder: page.folder, excerpt: context };
}

export function toWikiVersion(page: WikiPageRecord, version: WikiVersionRecord): WikiVersionItem {
  return {
    n: version.n,
    size: version.size,
    at: version.at,
    by: toWireActor(version.by),
    ...(version.summary ? { summary: version.summary } : {}),
    current: version === currentVersion(page),
  };
}

export function toWikiTrash(page: WikiPageRecord): WikiTrashItem {
  return { id: page.id, title: page.title, folder: page.folder, deletedAt: page.deleted!.at, deletedBy: toWireActor(page.deleted!.by) };
}
