import { breadcrumbOf, nameOf } from "../../shared/knowledge-path.ts";
import type { DriveFileItem, DriveListing, DriveSaveResult, DriveTrashItem, DriveVersionItem } from "../../shared/knowledge.ts";
import type { Sees } from "./actors.ts";
import type { StoredBlob } from "./blob-store.ts";
import { current, type DriveEntryRecord, type DriveVersionRecord } from "./drive-store.ts";
import { KnowledgeError } from "./errors.ts";
import type { KnowledgeSpace } from "./space.ts";
import { mayDeleteFile, toDriveFile, toDriveTrash, toDriveVersion, type Requester } from "./wire.ts";

export interface OpenedFile {
  entry: DriveEntryRecord;
  version: DriveVersionRecord;
  name: string;
  size: number;
  file: string;
}

export interface SaveOptions {
  note?: string;
  declaredSize?: number;
}

/** Every Drive operation of one asker in one space; what the asker may not see is never listed, opened or changed. */
export class DriveApi {
  private readonly space: KnowledgeSpace;
  private readonly who: Requester;
  private readonly sees: Sees;

  constructor(space: KnowledgeSpace, who: Requester) {
    this.space = space;
    this.who = who;
    this.sees = who.access.sees;
  }

  list(folder: unknown): DriveListing {
    const { path, folders, files } = this.space.drive.listFolder(folder, this.sees);
    return {
      space: this.space.id,
      path,
      breadcrumb: breadcrumbOf(path),
      items: [...folders, ...files.map((entry) => toDriveFile(entry, this.who))],
      maxFileBytes: this.space.limits.driveFileMaxBytes,
    };
  }

  search(query: unknown): DriveFileItem[] {
    const text = typeof query === "string" ? query.trim() : "";
    if (!text) return [];
    return this.space.drive.search(text, this.sees).map((entry) => toDriveFile(entry, this.who));
  }

  info(path: unknown): { file: DriveFileItem; versions: DriveVersionItem[] } {
    const entry = this.space.drive.find(path, this.sees);
    return { file: toDriveFile(entry, this.who), versions: this.versionsOf(entry) };
  }

  versions(path: unknown): DriveVersionItem[] {
    return this.versionsOf(this.space.drive.find(path, this.sees));
  }

  private versionsOf(entry: DriveEntryRecord): DriveVersionItem[] {
    return [...entry.versions].reverse().map((version) => toDriveVersion(entry, version));
  }

  open(path: unknown, version?: number): OpenedFile {
    const entry = this.space.drive.find(path, this.sees);
    const picked = version === undefined ? current(entry) : entry.versions.find((candidate) => candidate.n === version);
    if (!picked) throw new KnowledgeError("not_found", "that version no longer exists");
    if (this.space.blobs.sizeOf(picked.sha256) === null) throw new KnowledgeError("not_found", "the stored content is missing");
    return { entry, version: picked, name: nameOf(entry.path), size: picked.size, file: this.space.blobs.path(picked.sha256) };
  }

  /** The beginning of a file as text, for an agent: `truncated` says there was more. */
  readText(path: unknown, version: number | undefined, maxBytes: number): { text: string; truncated: boolean; opened: OpenedFile } {
    const opened = this.open(path, version);
    const head = this.space.blobs.readHead(opened.version.sha256, maxBytes);
    return { text: head.toString("utf8"), truncated: opened.size > head.byteLength, opened };
  }

  readBytes(path: unknown, version: number | undefined, maxBytes: number): { data: Buffer; opened: OpenedFile } {
    const opened = this.open(path, version);
    if (opened.size > maxBytes) throw new KnowledgeError("too_large", `the file is larger than ${maxBytes} bytes`, { maxBytes });
    return { data: this.space.blobs.read(opened.version.sha256), opened };
  }

  createFolder(path: unknown): { path: string; created: boolean } {
    return this.space.drive.createFolder(path, this.who.actor, this.sees);
  }

  async save(path: unknown, source: Uint8Array | AsyncIterable<Uint8Array>, options: SaveOptions = {}): Promise<DriveSaveResult> {
    const { drive, blobs, limits } = this.space;
    const target = drive.normalize(path);
    if (options.declaredSize !== undefined && options.declaredSize > limits.driveFileMaxBytes) {
      throw new KnowledgeError("too_large", `a file can hold up to ${limits.driveFileMaxBytes} bytes`, { maxBytes: limits.driveFileMaxBytes });
    }
    this.space.assertRoom(options.declaredSize ?? 0);
    const admit = (candidate: StoredBlob) => this.space.assertRoomFor(candidate);
    let blob: StoredBlob;
    if (source instanceof Uint8Array) {
      if (source.byteLength > limits.driveFileMaxBytes) {
        throw new KnowledgeError("too_large", `a file can hold up to ${limits.driveFileMaxBytes} bytes`, { maxBytes: limits.driveFileMaxBytes });
      }
      blob = blobs.putBuffer(source, { admit });
    } else blob = await blobs.putStream(source, limits.driveFileMaxBytes, { room: this.space.roomLeft(), admit });
    let saved: ReturnType<typeof drive.save>;
    try {
      saved = drive.save({ path: target, blob, actor: this.who.actor, ...(options.note ? { note: options.note } : {}) }, this.sees);
    } catch (error) {
      this.space.discard(blob);
      throw error;
    }
    if (saved.outcome !== "unchanged") this.space.noteWritten(blob);
    if (saved.pruned) this.space.forgetUsage();
    return { outcome: saved.outcome, file: toDriveFile(saved.entry, this.who), version: saved.version.n };
  }

  restoreVersion(path: unknown, n: number): DriveSaveResult {
    const saved = this.space.drive.restoreVersion(path, n, this.who.actor, this.sees);
    if (saved.pruned) this.space.forgetUsage();
    return { outcome: saved.outcome, file: toDriveFile(saved.entry, this.who), version: saved.version.n };
  }

  move(from: unknown, to: unknown): { from: string; to: string; moved: number } {
    return this.space.drive.move(from, to, this.sees);
  }

  remove(path: unknown): { trashed: number } {
    return this.space.drive.remove(path, this.who.actor, (entry) => mayDeleteFile(this.who, entry), this.sees);
  }

  trash(): DriveTrashItem[] {
    return this.space.drive.trashed(this.sees).map(toDriveTrash);
  }

  restoreFromTrash(id: string): DriveFileItem {
    const entry = this.space.drive.trashedEntry(id, this.sees);
    if (!mayDeleteFile(this.who, entry)) throw new KnowledgeError("forbidden", "only the person who saved the file, or an admin, can bring it back");
    return toDriveFile(this.space.drive.restoreFromTrash(id, this.sees), this.who);
  }
}
