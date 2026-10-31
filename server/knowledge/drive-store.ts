import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

import { foldKey, matchesFolded, nameOf, parentOf, parsePath } from "../../shared/knowledge-path.ts";
import type { DriveFolderItem } from "../../shared/knowledge.ts";
import { writeFileAtomic } from "../atomic.ts";
import { SEES_ALL, storableActor, visibleHistory, type KnowledgeActor, type Sees } from "./actors.ts";
import type { StoredBlob } from "./blob-store.ts";
import { badPath, isKnowledgeError, KnowledgeError } from "./errors.ts";
import type { KnowledgeLimits } from "./limits.ts";

export interface DriveVersionRecord {
  n: number;
  sha256: string;
  size: number;
  at: number;
  by: KnowledgeActor;
  note?: string;
}

export interface DriveEntryRecord {
  id: string;
  path: string;
  createdAt: number;
  createdBy: KnowledgeActor;
  nextVersion: number;
  versions: DriveVersionRecord[];
  deleted?: { at: number; by: KnowledgeActor };
}

interface DriveFolderRecord {
  path: string;
  at: number;
  by: KnowledgeActor;
}

interface DriveIndexFile {
  version: 1;
  files: DriveEntryRecord[];
  folders: DriveFolderRecord[];
}

export interface DriveSaveInput {
  path: string;
  blob: StoredBlob;
  actor: KnowledgeActor;
  note?: string;
}

export interface DriveSaved {
  outcome: "created" | "updated" | "unchanged";
  entry: DriveEntryRecord;
  version: DriveVersionRecord;
  pruned: boolean;
}

export type DriveBatchItem = { ok: true; saved: DriveSaved } | { ok: false; error: KnowledgeError };

export const current = <T extends { versions: readonly unknown[] }>(entry: T): T["versions"][number] => entry.versions[entry.versions.length - 1]!;

const collator = new Intl.Collator("pt-BR", { sensitivity: "base", numeric: true });

function startsWithSegments(segments: readonly string[], prefix: readonly string[]): boolean {
  return segments.length >= prefix.length && prefix.every((part, index) => foldKey(part) === foldKey(segments[index]!));
}

function sameSegments(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && startsWithSegments(a, b);
}

const NAME_UNUSABLE = "that name can't be used here, choose another";

export class DriveStore {
  private readonly file: string;
  private readonly limits: KnowledgeLimits;
  private files: DriveEntryRecord[] = [];
  private folders: DriveFolderRecord[] = [];
  private live = new Map<string, DriveEntryRecord>();
  private byId = new Map<string, DriveEntryRecord>();
  private folderCase = new Map<string, string>();

  constructor(file: string, limits: KnowledgeLimits) {
    this.file = file;
    this.limits = limits;
    this.load();
  }

  private load(): void {
    let parsed: Partial<DriveIndexFile> | null = null;
    if (existsSync(this.file)) {
      try {
        parsed = JSON.parse(readFileSync(this.file, "utf8")) as Partial<DriveIndexFile>;
      } catch {
        throw new Error(`The Drive index at ${this.file} could not be read; it was left as it is.`);
      }
      if (!parsed || !Array.isArray(parsed.files) || !Array.isArray(parsed.folders)) {
        throw new Error(`The Drive index at ${this.file} has an unexpected shape; it was left as it is.`);
      }
    }
    this.files = parsed?.files ?? [];
    this.folders = parsed?.folders ?? [];
    this.reindex();
  }

  /** A write that fails puts the in-memory index back to what is on disk. */
  private persist(): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
      const data: DriveIndexFile = { version: 1, files: this.files, folders: this.folders };
      writeFileAtomic(this.file, JSON.stringify(data), { mode: 0o600 });
    } catch (error) {
      this.load();
      throw error;
    }
  }

  private commit(): void {
    this.reindex();
    this.persist();
  }

  private reindex(): void {
    this.live = new Map();
    this.byId = new Map();
    this.folderCase = new Map();
    for (const folder of this.folders) this.addFolders(folder.path);
    for (const entry of this.files) this.index(entry);
  }

  private index(entry: DriveEntryRecord): void {
    this.byId.set(entry.id, entry);
    if (entry.deleted) return;
    this.live.set(foldKey(entry.path), entry);
    this.addFolders(parentOf(entry.path));
  }

  private addFolders(path: string): void {
    if (!path) return;
    const parts = path.split("/");
    for (let length = 1; length <= parts.length; length += 1) {
      const prefix = parts.slice(0, length).join("/");
      const key = foldKey(prefix);
      if (!this.folderCase.has(key)) this.folderCase.set(key, prefix);
    }
  }

  private parse(input: unknown, allowRoot = false): { path: string; segments: string[] } {
    const parsed = parsePath(input, { allowRoot });
    if (!parsed.ok) throw badPath(parsed.problem);
    return { path: parsed.path, segments: parsed.segments };
  }

  /** A folder keeps the capitalisation it was first created with, so `docs/` and `Docs/` are one folder. */
  private canonical(segments: readonly string[], keepLast: boolean): string[] {
    const out: string[] = [];
    const folderCount = keepLast ? segments.length - 1 : segments.length;
    for (let index = 0; index < folderCount; index += 1) {
      const wanted = [...out, segments[index]!].join("/");
      out.push(this.folderCase.get(foldKey(wanted))?.split("/").pop() ?? segments[index]!);
    }
    return keepLast ? [...out, segments[segments.length - 1]!] : out;
  }

  /** A folder is shown to the asker when something they may see sits in it or below it, or they see who made it. One that holds only hidden things is, for them, not there. */
  private shown(folder: string, sees: Sees): boolean {
    const base = folder.split("/");
    for (const entry of this.live.values()) {
      const segments = entry.path.split("/");
      if (segments.length > base.length && startsWithSegments(segments, base) && visibleHistory(entry, sees)) return true;
    }
    return this.folders.some((record) => startsWithSegments(record.path.split("/"), base) && sees(record.by));
  }

  /** What blocks a name is told only when the asker can see it; a hidden one is refused like any name that cannot be used. */
  private blocked(visible: boolean, message: string): KnowledgeError {
    return visible ? new KnowledgeError("path_taken", message) : new KnowledgeError("bad_path", NAME_UNUSABLE);
  }

  private assertFree(segments: readonly string[], sees: Sees, ignore?: DriveEntryRecord): void {
    const key = foldKey(segments.join("/"));
    const folder = this.folderCase.get(key);
    if (folder !== undefined) throw this.blocked(this.shown(folder, sees), "a folder with this name already exists");
    const there = this.live.get(key);
    if (there && there !== ignore) throw this.blocked(visibleHistory(there, sees), "a file with this name already exists");
    for (let length = 1; length < segments.length; length += 1) {
      const above = this.live.get(foldKey(segments.slice(0, length).join("/")));
      if (above) throw this.blocked(visibleHistory(above, sees), "a file sits where one of the folders in this path should be");
    }
  }

  count(): number {
    return this.live.size;
  }

  normalize(input: unknown): string {
    return this.parse(input).path;
  }

  folderExists(path: string): boolean {
    return path === "" || this.folderCase.has(foldKey(path));
  }

  /** The entry at an already-normalised path, or null when it does not exist or the asker may not see it. */
  lookup(path: string, sees: Sees = SEES_ALL): DriveEntryRecord | null {
    const entry = this.live.get(foldKey(path));
    return entry && visibleHistory(entry, sees) ? entry : null;
  }

  find(path: unknown, sees: Sees = SEES_ALL): DriveEntryRecord {
    const entry = this.lookup(this.parse(path).path, sees);
    if (!entry) throw new KnowledgeError("not_found", "file not found");
    return entry;
  }

  listFolder(folderInput: unknown, sees: Sees): { path: string; folders: DriveFolderItem[]; files: DriveEntryRecord[] } {
    const requested = this.parse(folderInput, true);
    const path = requested.path === "" ? "" : this.folderCase.get(foldKey(requested.path));
    if (path === undefined || (path !== "" && !this.shown(path, sees))) throw new KnowledgeError("not_found", "folder not found");
    const base = path ? path.split("/") : [];
    const folders = new Map<string, DriveFolderItem>();
    const files: DriveEntryRecord[] = [];
    const touch = (segments: readonly string[], at: number, items: number) => {
      const joined = [...base, segments[base.length]!].join("/");
      const childPath = this.folderCase.get(foldKey(joined)) ?? joined;
      const key = foldKey(childPath);
      const known = folders.get(key);
      if (known) {
        known.updatedAt = Math.max(known.updatedAt, at);
        known.items += items;
      } else folders.set(key, { kind: "folder", name: nameOf(childPath), path: childPath, updatedAt: at, items });
    };
    for (const entry of this.live.values()) {
      const segments = entry.path.split("/");
      if (segments.length <= base.length || !startsWithSegments(segments, base) || !visibleHistory(entry, sees)) continue;
      if (segments.length === base.length + 1) files.push(entry);
      else touch(segments, current(entry).at, 1);
    }
    for (const folder of this.folders) {
      const segments = folder.path.split("/");
      if (segments.length <= base.length || !startsWithSegments(segments, base) || !sees(folder.by)) continue;
      touch(segments, folder.at, 0);
    }
    return {
      path,
      folders: [...folders.values()].sort((a, b) => collator.compare(a.name, b.name)),
      files: files.sort((a, b) => collator.compare(nameOf(a.path), nameOf(b.path))),
    };
  }

  search(query: string, sees: Sees, limit = 50): DriveEntryRecord[] {
    const out: DriveEntryRecord[] = [];
    for (const entry of this.live.values()) {
      if (matchesFolded(entry.path, query) && visibleHistory(entry, sees)) out.push(entry);
    }
    return out.sort((a, b) => current(b).at - current(a).at).slice(0, limit);
  }

  /** The file an embed such as `![[photo.png]]` points to: matched by its name, or the tail of its path, under one folder. */
  findAsset(reference: string, under: string, sees: Sees): string | null {
    const wanted = foldKey(reference.normalize("NFC").replace(/^\/+/, ""));
    const base = under ? under.split("/") : [];
    let best: DriveEntryRecord | null = null;
    for (const entry of this.live.values()) {
      const key = foldKey(entry.path);
      if (key !== wanted && !key.endsWith(`/${wanted}`)) continue;
      if (!startsWithSegments(entry.path.split("/"), base) || !visibleHistory(entry, sees)) continue;
      if (!best || entry.path.length < best.path.length) best = entry;
    }
    return best?.path ?? null;
  }

  trashed(sees: Sees): DriveEntryRecord[] {
    return this.files.filter((entry) => entry.deleted && visibleHistory(entry, sees)).sort((a, b) => b.deleted!.at - a.deleted!.at);
  }

  blobSizes(): Map<string, number> {
    const sizes = new Map<string, number>();
    for (const entry of this.files) for (const version of entry.versions) sizes.set(version.sha256, version.size);
    return sizes;
  }

  referenced(): Set<string> {
    const shas = new Set<string>();
    for (const entry of this.files) for (const version of entry.versions) shas.add(version.sha256);
    return shas;
  }

  createFolder(pathInput: unknown, actor: KnowledgeActor, sees: Sees = SEES_ALL): { path: string; created: boolean } {
    const requested = this.parse(pathInput);
    const segments = this.canonical(requested.segments, false);
    const path = segments.join("/");
    const known = this.folderCase.get(foldKey(path));
    if (known && this.shown(known, sees)) return { path: known, created: false };
    if (!known) this.assertFree(segments, sees);
    this.folders.push({ path: known ?? path, at: Date.now(), by: storableActor(actor) });
    this.addFolders(path);
    this.persist();
    return { path: known ?? path, created: true };
  }

  private apply(input: DriveSaveInput, sees: Sees): DriveSaved {
    const requested = this.parse(input.path);
    const segments = this.canonical(requested.segments, true);
    const existing = this.live.get(foldKey(segments.join("/")));
    const now = Date.now();
    const by = storableActor(input.actor);
    const note = input.note?.trim().slice(0, 200);
    if (existing) {
      if (!visibleHistory(existing, sees)) throw new KnowledgeError("bad_path", NAME_UNUSABLE);
      const latest = current(existing);
      if (latest.sha256 === input.blob.sha256) return { outcome: "unchanged", entry: existing, version: latest, pruned: false };
      const version: DriveVersionRecord = { n: existing.nextVersion, sha256: input.blob.sha256, size: input.blob.size, at: now, by, ...(note ? { note } : {}) };
      existing.nextVersion += 1;
      existing.versions.push(version);
      return { outcome: "updated", entry: existing, version, pruned: this.prune(existing) };
    }
    this.assertFree(segments, sees);
    if (this.live.size >= this.limits.maxFilesPerSpace) {
      throw new KnowledgeError("limit", `the Drive holds at most ${this.limits.maxFilesPerSpace} files`, { max: this.limits.maxFilesPerSpace });
    }
    const version: DriveVersionRecord = { n: 1, sha256: input.blob.sha256, size: input.blob.size, at: now, by, ...(note ? { note } : {}) };
    const entry: DriveEntryRecord = { id: randomUUID(), path: segments.join("/"), createdAt: now, createdBy: by, nextVersion: 2, versions: [version] };
    this.files.push(entry);
    this.index(entry);
    return { outcome: "created", entry, version, pruned: false };
  }

  private prune(entry: DriveEntryRecord): boolean {
    let pruned = false;
    while (entry.versions.length > this.limits.maxVersions) {
      entry.versions.shift();
      pruned = true;
    }
    return pruned;
  }

  /** Saving to a path that exists keeps the earlier content as a version; saving the same bytes again changes nothing. */
  save(input: DriveSaveInput, sees: Sees = SEES_ALL): DriveSaved {
    const saved = this.apply(input, sees);
    if (saved.outcome !== "unchanged") this.persist();
    return saved;
  }

  /** One write for the whole batch; an item that cannot be saved is reported and the others still go in. */
  saveMany(inputs: readonly DriveSaveInput[], sees: Sees = SEES_ALL): DriveBatchItem[] {
    const results: DriveBatchItem[] = [];
    let changed = false;
    try {
      for (const input of inputs) {
        try {
          const saved = this.apply(input, sees);
          if (saved.outcome !== "unchanged") changed = true;
          results.push({ ok: true, saved });
        } catch (error) {
          if (!isKnowledgeError(error)) throw error;
          results.push({ ok: false, error });
        }
      }
    } catch (error) {
      this.load();
      throw error;
    }
    if (changed) this.persist();
    return results;
  }

  restoreVersion(pathInput: unknown, n: number, actor: KnowledgeActor, sees: Sees = SEES_ALL): DriveSaved {
    const entry = this.find(pathInput, sees);
    const wanted = entry.versions.find((version) => version.n === n);
    if (!wanted) throw new KnowledgeError("not_found", "that version no longer exists");
    const latest = current(entry);
    if (latest.sha256 === wanted.sha256) return { outcome: "unchanged", entry, version: latest, pruned: false };
    const version: DriveVersionRecord = { n: entry.nextVersion, sha256: wanted.sha256, size: wanted.size, at: Date.now(), by: storableActor(actor), note: `restore:${wanted.n}` };
    entry.nextVersion += 1;
    entry.versions.push(version);
    const pruned = this.prune(entry);
    this.persist();
    return { outcome: "updated", entry, version, pruned };
  }

  move(fromInput: unknown, toInput: unknown, sees: Sees = SEES_ALL): { from: string; to: string; moved: number } {
    const from = this.parse(fromInput);
    const to = this.parse(toInput);
    const fromKey = foldKey(from.path);
    const file = this.live.get(fromKey);
    if (file) {
      if (!visibleHistory(file, sees)) throw new KnowledgeError("not_found", "nothing to move at this path");
      const segments = this.canonical(to.segments, true);
      this.assertFree(segments, sees, file);
      file.path = segments.join("/");
      this.commit();
      return { from: from.path, to: file.path, moved: 1 };
    }
    const knownFolder = this.folderCase.get(fromKey);
    if (!knownFolder || !this.shown(knownFolder, sees)) throw new KnowledgeError("not_found", "nothing to move at this path");
    const source = knownFolder.split("/");
    if (to.segments.length > source.length && startsWithSegments(to.segments, source)) {
      throw new KnowledgeError("bad_input", "a folder cannot be moved into itself");
    }
    const target = [...this.canonical(to.segments, true).slice(0, -1), to.segments[to.segments.length - 1]!];
    if (!sameSegments(source, target)) this.assertFree(target, sees);
    const inside = [...this.live.values()].filter((entry) => startsWithSegments(entry.path.split("/"), source));
    if (inside.some((entry) => !visibleHistory(entry, sees))) throw new KnowledgeError("forbidden", "you cannot change this folder");
    const rebase = (path: string) => [...target, ...path.split("/").slice(source.length)].join("/");
    for (const entry of inside) entry.path = rebase(entry.path);
    for (const folder of this.folders) {
      if (startsWithSegments(folder.path.split("/"), source)) folder.path = rebase(folder.path);
    }
    this.commit();
    return { from: source.join("/"), to: target.join("/"), moved: inside.length };
  }

  /** Files go to the trash, not away: they come back with all their versions until the trash is emptied. */
  remove(pathInput: unknown, actor: KnowledgeActor, mayDelete: (entry: DriveEntryRecord) => boolean, sees: Sees = SEES_ALL): { trashed: number } {
    const requested = this.parse(pathInput);
    const key = foldKey(requested.path);
    const stamp = { at: Date.now(), by: storableActor(actor) };
    const file = this.live.get(key);
    if (file) {
      if (!visibleHistory(file, sees)) throw new KnowledgeError("not_found", "nothing to delete at this path");
      if (!mayDelete(file)) throw new KnowledgeError("forbidden", "only the person who saved the file, or an admin, can delete it");
      file.deleted = stamp;
      this.commit();
      return { trashed: 1 };
    }
    const knownFolder = this.folderCase.get(key);
    if (!knownFolder || !this.shown(knownFolder, sees)) throw new KnowledgeError("not_found", "nothing to delete at this path");
    const source = knownFolder.split("/");
    const inside = [...this.live.values()].filter((entry) => startsWithSegments(entry.path.split("/"), source));
    if (inside.some((entry) => !visibleHistory(entry, sees) || !mayDelete(entry))) throw new KnowledgeError("forbidden", "you cannot delete this folder; it holds files saved by others, and only an admin can");
    for (const entry of inside) entry.deleted = stamp;
    this.folders = this.folders.filter((folder) => !startsWithSegments(folder.path.split("/"), source));
    this.commit();
    return { trashed: inside.length };
  }

  trashedEntry(id: string, sees: Sees = SEES_ALL): DriveEntryRecord {
    const entry = this.byId.get(id);
    if (!entry?.deleted || !visibleHistory(entry, sees)) throw new KnowledgeError("not_found", "this file is not in the trash");
    return entry;
  }

  restoreFromTrash(id: string, sees: Sees = SEES_ALL): DriveEntryRecord {
    const entry = this.trashedEntry(id, sees);
    this.assertFree(entry.path.split("/"), sees);
    delete entry.deleted;
    this.commit();
    return entry;
  }

  purge(ids: readonly string[]): number {
    const wanted = new Set(ids);
    const before = this.files.length;
    this.files = this.files.filter((entry) => !(wanted.has(entry.id) && entry.deleted));
    const removed = before - this.files.length;
    if (removed > 0) this.commit();
    return removed;
  }

  expiredTrash(now: number): string[] {
    const cutoff = now - this.limits.trashDays * 86_400_000;
    return this.files.filter((entry) => entry.deleted && entry.deleted.at < cutoff).map((entry) => entry.id);
  }
}
