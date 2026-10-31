import { mkdirSync } from "node:fs";
import { join } from "node:path";

import type { KnowledgeSpaceId } from "../../shared/knowledge.ts";
import { spaceFolder } from "./audience.ts";
import { BlobStore, type StoredBlob } from "./blob-store.ts";
import { DriveStore } from "./drive-store.ts";
import { KnowledgeError } from "./errors.ts";
import type { KnowledgeLimits } from "./limits.ts";
import { WikiStore } from "./wiki-store.ts";

/** One space's files and pages: they share one content store, so a page's pictures and the Drive count against one quota. */
export class KnowledgeSpace {
  readonly id: KnowledgeSpaceId;
  readonly limits: KnowledgeLimits;
  readonly blobs: BlobStore;
  readonly drive: DriveStore;
  readonly wiki: WikiStore;
  private readonly pinned: () => Iterable<string>;
  private sizes: Map<string, number> | null = null;
  private used = 0;

  constructor(root: string, id: KnowledgeSpaceId, limits: KnowledgeLimits, pinned: () => Iterable<string>) {
    const folder = join(root, spaceFolder(id));
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    this.id = id;
    this.limits = limits;
    this.pinned = pinned;
    this.blobs = new BlobStore(folder);
    this.drive = new DriveStore(join(folder, "drive.json"), limits);
    this.wiki = new WikiStore(join(folder, "wiki.json"), this.blobs, limits);
  }

  private stored(): Map<string, number> {
    if (this.sizes === null) {
      this.sizes = new Map([...this.drive.blobSizes(), ...this.wiki.blobSizes()]);
      this.used = 0;
      for (const size of this.sizes.values()) this.used += size;
    }
    return this.sizes;
  }

  usedBytes(): number {
    this.stored();
    return this.used;
  }

  assertRoom(incoming: number): void {
    if (this.usedBytes() + incoming > this.limits.spaceMaxBytes) {
      throw new KnowledgeError("full", "this space has no room left", { maxBytes: this.limits.spaceMaxBytes });
    }
  }

  roomLeft(): number {
    return Math.max(0, this.limits.spaceMaxBytes - this.usedBytes());
  }

  /** Removes content an upload left behind when it was refused or replaced, unless the space or a running import still holds it. */
  discard(blob: StoredBlob): void {
    try {
      if (this.stored().has(blob.sha256)) return;
      for (const pinned of this.pinned()) if (pinned === blob.sha256) return;
      this.blobs.remove(blob.sha256);
    } catch {
    }
  }

  /** Content the space already holds takes no room: saving the same bytes again, or a restored version, is free. */
  assertRoomFor(blob: StoredBlob): void {
    this.assertRoom(this.stored().has(blob.sha256) ? 0 : blob.size);
  }

  assertRoomForAll(blobs: Iterable<StoredBlob>): void {
    const stored = this.stored();
    const fresh = new Map<string, number>();
    for (const blob of blobs) if (!stored.has(blob.sha256)) fresh.set(blob.sha256, blob.size);
    let incoming = 0;
    for (const size of fresh.values()) incoming += size;
    this.assertRoom(incoming);
  }

  noteWritten(blob: StoredBlob): void {
    if (this.sizes !== null && !this.sizes.has(blob.sha256)) {
      this.sizes.set(blob.sha256, blob.size);
      this.used += blob.size;
    }
  }

  /** Deleting and version pruning free room that is only known by counting again. */
  forgetUsage(): void {
    this.sizes = null;
    this.used = 0;
  }

  /** Empties what stayed in the trash too long, then removes contents nothing points to any more. */
  collect(now = Date.now()): number {
    const files = this.drive.expiredTrash(now);
    if (files.length > 0) this.drive.purge(files);
    const pages = this.wiki.expiredTrash(now);
    if (pages.length > 0) this.wiki.purge(pages);
    const referenced = new Set<string>([...this.drive.referenced(), ...this.wiki.referenced(), ...this.pinned()]);
    const removed = this.blobs.sweep(referenced, now);
    this.blobs.clearStaging(now);
    this.forgetUsage();
    return removed;
  }
}
