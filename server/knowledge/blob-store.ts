import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, statSync, unlinkSync, utimesSync } from "node:fs";
import { open, rename, unlink, utimes, type FileHandle } from "node:fs/promises";
import { join } from "node:path";

import { writeFileAtomic } from "../atomic.ts";
import { KnowledgeError } from "./errors.ts";

export interface StoredBlob {
  sha256: string;
  size: number;
}

const SHA256 = /^[0-9a-f]{64}$/;
const ORPHAN_GRACE_MS = 10 * 60_000;

export interface PutOptions {
  /** Bytes the space can still take. A stream that goes past it stops being written; it is kept only if it turns out to be content already held. */
  room?: number;
  /** Looks at the finished content before it is put in place. Throwing refuses it, and nothing of it stays on disk. */
  admit?: (blob: StoredBlob) => void;
}

/** Content-addressed bytes: a name on disk is only ever a sha256, so nothing a person types reaches the file system. */
export class BlobStore {
  readonly root: string;
  private readonly blobs: string;
  private readonly staging: string;

  constructor(root: string) {
    this.root = root;
    this.blobs = join(root, "blobs");
    this.staging = join(root, "tmp");
    mkdirSync(this.blobs, { recursive: true, mode: 0o700 });
    mkdirSync(this.staging, { recursive: true, mode: 0o700 });
  }

  path(sha256: string): string {
    if (!SHA256.test(sha256)) throw new KnowledgeError("bad_input", "invalid content id");
    return join(this.blobs, sha256.slice(0, 2), sha256);
  }

  has(sha256: string): boolean {
    return SHA256.test(sha256) && existsSync(this.path(sha256));
  }

  read(sha256: string): Buffer {
    try {
      return readFileSync(this.path(sha256));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new KnowledgeError("not_found", "the stored content is missing");
      throw error;
    }
  }

  readHead(sha256: string, maxBytes: number): Buffer {
    let fd: number;
    try {
      fd = openSync(this.path(sha256), "r");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new KnowledgeError("not_found", "the stored content is missing");
      throw error;
    }
    try {
      const length = Math.min(fstatSync(fd).size, maxBytes);
      const buffer = Buffer.alloc(length);
      readSync(fd, buffer, 0, length, 0);
      return buffer;
    } finally {
      closeSync(fd);
    }
  }

  sizeOf(sha256: string): number | null {
    try {
      return statSync(this.path(sha256)).size;
    } catch {
      return null;
    }
  }

  putBuffer(data: Uint8Array, options: PutOptions = {}): StoredBlob {
    const sha256 = createHash("sha256").update(data).digest("hex");
    const blob = { sha256, size: data.byteLength };
    const target = this.path(sha256);
    options.admit?.(blob);
    if (existsSync(target)) utimesSync(target, new Date(), new Date());
    else {
      mkdirSync(join(this.blobs, sha256.slice(0, 2)), { recursive: true, mode: 0o700 });
      writeFileAtomic(target, data, { mode: 0o600, durable: false });
    }
    return blob;
  }

  async putStream(chunks: AsyncIterable<Uint8Array>, maxBytes: number, options: PutOptions = {}): Promise<StoredBlob> {
    const partial = join(this.staging, `${randomUUID()}.part`);
    const hash = createHash("sha256");
    const room = options.room ?? Number.POSITIVE_INFINITY;
    let file: FileHandle | null = await open(partial, "wx", 0o600);
    let size = 0;
    try {
      for await (const chunk of chunks) {
        if (chunk.byteLength === 0) continue;
        size += chunk.byteLength;
        if (size > maxBytes) throw new KnowledgeError("too_large", `file exceeds ${maxBytes} bytes`, { maxBytes });
        hash.update(chunk);
        if (file && size > room) {
          await file.close();
          file = null;
          await unlink(partial).catch(() => undefined);
        }
        if (file) await file.write(chunk);
      }
      const sha256 = hash.digest("hex");
      const blob = { sha256, size };
      const target = this.path(sha256);
      const held = existsSync(target);
      options.admit?.(blob);
      if (!held && !file) throw new KnowledgeError("full", "this space has no room left");
      if (held) {
        await utimes(target, new Date(), new Date());
      } else {
        await file!.close();
        file = null;
        mkdirSync(join(this.blobs, sha256.slice(0, 2)), { recursive: true, mode: 0o700 });
        await rename(partial, target);
      }
      return blob;
    } finally {
      await file?.close().catch(() => undefined);
      await unlink(partial).catch(() => undefined);
    }
  }

  remove(sha256: string): void {
    try {
      unlinkSync(this.path(sha256));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  /** Removes blobs nothing refers to, once they are old enough that no save can still be about to claim them. */
  sweep(referenced: ReadonlySet<string>, now = Date.now()): number {
    let removed = 0;
    for (const bucket of readdirSync(this.blobs, { withFileTypes: true })) {
      if (!bucket.isDirectory()) continue;
      for (const name of readdirSync(join(this.blobs, bucket.name))) {
        if (!SHA256.test(name) || referenced.has(name)) continue;
        const path = join(this.blobs, bucket.name, name);
        try {
          if (now - statSync(path).mtimeMs < ORPHAN_GRACE_MS) continue;
          unlinkSync(path);
          removed += 1;
        } catch {
        }
      }
    }
    return removed;
  }

  clearStaging(now = Date.now(), olderThanMs = ORPHAN_GRACE_MS): void {
    for (const name of readdirSync(this.staging)) {
      const path = join(this.staging, name);
      try {
        if (now - statSync(path).mtimeMs >= olderThanMs) unlinkSync(path);
      } catch {
      }
    }
  }
}
