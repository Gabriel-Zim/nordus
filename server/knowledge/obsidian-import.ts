import { randomUUID } from "node:crypto";

import { extensionOf, foldKey, nameOf, parentOf, parsePath, stemOf } from "../../shared/knowledge-path.ts";
import { WIKI_ATTACHMENTS_FOLDER, type ImportSkipReason, type WikiImportLimits, type WikiImportSummary } from "../../shared/knowledge.ts";
import { cleanWikiTitle } from "../../shared/wiki-markdown.ts";
import { actorKey } from "./actors.ts";
import type { StoredBlob } from "./blob-store.ts";
import type { DriveSaveInput } from "./drive-store.ts";
import { isKnowledgeError, KnowledgeError } from "./errors.ts";
import type { KnowledgeLimits } from "./limits.ts";
import type { KnowledgeSpace } from "./space.ts";
import type { WikiWriteInput } from "./wiki-store.ts";
import type { Requester } from "./wire.ts";

const SESSION_IDLE_MS = 30 * 60_000;
const SESSIONS_PER_PERSON = 2;
const SKIPPED_LISTED = 100;
const PAGES_PER_WRITE = 200;
const IMPORT_SUMMARY = "import:obsidian";

interface Staged {
  path: string;
  kind: "page" | "attachment";
  blob: StoredBlob;
}

interface ImportSession {
  id: string;
  space: KnowledgeSpace;
  owner: string;
  root: string;
  touchedAt: number;
  finishing: boolean;
  requests: number;
  totalBytes: number;
  files: Map<string, Staged>;
  skipped: Array<{ path: string; reason: ImportSkipReason }>;
  skippedCount: number;
}

export interface ImportStarted {
  session: string;
  root: string;
  limits: WikiImportLimits;
}

export interface ImportFileResult {
  accepted: boolean;
  kind?: "page" | "attachment";
  skipped?: ImportSkipReason;
}

const emptyCounts = () => ({ created: 0, updated: 0, unchanged: 0 });

function rootName(input: unknown): string {
  const name = typeof input === "string" ? cleanWikiTitle(input) : null;
  return name ?? "Obsidian";
}

/** A vault chosen in the browser arrives file by file; nothing touches the wiki or the Drive until the person finishes. */
export class ObsidianImports {
  private readonly limits: KnowledgeLimits;
  private readonly sessions = new Map<string, ImportSession>();

  constructor(limits: KnowledgeLimits) {
    this.limits = limits;
  }

  /** Contents staged by running imports: a clean-up must not remove them. */
  pinned(): string[] {
    const shas: string[] = [];
    for (const session of this.sessions.values()) for (const staged of session.files.values()) shas.push(staged.blob.sha256);
    return shas;
  }

  expire(now = Date.now()): void {
    for (const [id, session] of this.sessions) {
      if (session.finishing || now - session.touchedAt <= SESSION_IDLE_MS) continue;
      this.sessions.delete(id);
      this.discardStaged(session);
    }
  }

  /** Contents an import staged and no longer needs go at once, unless the space or another import holds them. */
  private discardStaged(session: ImportSession): void {
    for (const staged of session.files.values()) session.space.discard(staged.blob);
  }

  private limitsFor(): WikiImportLimits {
    return { maxFiles: this.limits.importMaxFiles, maxBytes: this.limits.importMaxBytes, maxFileBytes: this.limits.driveFileMaxBytes };
  }

  start(space: KnowledgeSpace, who: Requester, root: unknown): ImportStarted {
    this.expire();
    const owner = actorKey(who.actor);
    let mine = 0;
    for (const session of this.sessions.values()) if (session.owner === owner) mine += 1;
    if (mine >= SESSIONS_PER_PERSON) throw new KnowledgeError("limit", "finish or cancel the imports you already started");
    const session: ImportSession = {
      id: randomUUID(),
      space,
      owner,
      root: rootName(root),
      touchedAt: Date.now(),
      finishing: false,
      requests: 0,
      totalBytes: 0,
      files: new Map(),
      skipped: [],
      skippedCount: 0,
    };
    this.sessions.set(session.id, session);
    return { session: session.id, root: session.root, limits: this.limitsFor() };
  }

  private session(space: KnowledgeSpace, who: Requester, id: string): ImportSession {
    const session = this.sessions.get(id);
    if (!session || session.owner !== actorKey(who.actor) || session.space !== space) throw new KnowledgeError("not_found", "this import is not open any more");
    session.touchedAt = Date.now();
    return session;
  }

  private skip(session: ImportSession, path: string, reason: ImportSkipReason): ImportFileResult {
    session.skippedCount += 1;
    if (session.skipped.length < SKIPPED_LISTED) session.skipped.push({ path, reason });
    return { accepted: false, skipped: reason };
  }

  async addFile(
    space: KnowledgeSpace,
    who: Requester,
    id: string,
    pathInput: unknown,
    chunks: AsyncIterable<Uint8Array>,
    declaredSize?: number,
  ): Promise<ImportFileResult> {
    const session = this.session(space, who, id);
    if (session.finishing) throw new KnowledgeError("conflict", "this import is already being saved");
    session.requests += 1;
    if (session.requests > this.limits.importMaxFiles * 4) throw new KnowledgeError("limit", "too many files in this import", { maxFiles: this.limits.importMaxFiles });
    const shown = typeof pathInput === "string" ? pathInput.slice(0, 300) : "";
    const parsed = parsePath(pathInput);
    if (!parsed.ok) return this.skip(session, shown, "bad-path");
    if (parsed.segments.some((segment) => segment.startsWith("."))) return this.skip(session, parsed.path, "hidden");
    const kind = extensionOf(nameOf(parsed.path)) === "md" ? "page" : "attachment";
    const fileMax = kind === "page" ? this.limits.wikiPageMaxBytes : this.limits.driveFileMaxBytes;
    if (declaredSize !== undefined && declaredSize > fileMax) return this.skip(session, parsed.path, "too-large");
    const key = foldKey(parsed.path);
    const room = this.limits.importMaxBytes - session.totalBytes + (session.files.get(key)?.blob.size ?? 0);
    if (room <= 0 || (declaredSize !== undefined && declaredSize > room)) throw new KnowledgeError("too_large", "this import is bigger than the allowed total", { maxBytes: this.limits.importMaxBytes });
    if (!session.files.has(key) && session.files.size >= this.limits.importMaxFiles) throw new KnowledgeError("limit", "too many files in this import", { maxFiles: this.limits.importMaxFiles });
    let blob: StoredBlob;
    try {
      blob = await space.blobs.putStream(chunks, Math.min(fileMax, room), { room: space.roomLeft() });
    } catch (error) {
      if (isKnowledgeError(error) && error.code === "too_large") {
        if (room < fileMax) throw new KnowledgeError("too_large", "this import is bigger than the allowed total", { maxBytes: this.limits.importMaxBytes });
        return this.skip(session, parsed.path, "too-large");
      }
      throw error;
    }
    if (kind === "page") {
      try {
        new TextDecoder("utf-8", { fatal: true }).decode(space.blobs.read(blob.sha256));
      } catch {
        space.discard(blob);
        return this.skip(session, parsed.path, "unsupported");
      }
    }
    const previous = session.files.get(key);
    if (!previous && session.files.size >= this.limits.importMaxFiles) {
      space.discard(blob);
      throw new KnowledgeError("limit", "too many files in this import", { maxFiles: this.limits.importMaxFiles });
    }
    if (session.totalBytes - (previous?.blob.size ?? 0) + blob.size > this.limits.importMaxBytes) {
      space.discard(blob);
      throw new KnowledgeError("too_large", "this import is bigger than the allowed total", { maxBytes: this.limits.importMaxBytes });
    }
    session.totalBytes += blob.size - (previous?.blob.size ?? 0);
    session.files.set(key, { path: parsed.path, kind, blob });
    if (previous) space.discard(previous.blob);
    return { accepted: true, kind };
  }

  cancel(space: KnowledgeSpace, who: Requester, id: string): void {
    const session = this.session(space, who, id);
    if (session.finishing) throw new KnowledgeError("conflict", "this import is already being saved");
    this.sessions.delete(id);
    this.discardStaged(session);
  }

  async finish(space: KnowledgeSpace, who: Requester, id: string): Promise<WikiImportSummary> {
    const session = this.session(space, who, id);
    if (session.finishing) throw new KnowledgeError("conflict", "this import is already being saved");
    space.assertRoomForAll([...session.files.values()].map((file) => file.blob));
    session.finishing = true;
    try {
      return await this.apply(space, who, session);
    } finally {
      this.sessions.delete(id);
      this.discardStaged(session);
    }
  }

  private async apply(space: KnowledgeSpace, who: Requester, session: ImportSession): Promise<WikiImportSummary> {
    const staged = [...session.files.values()].sort((a, b) => a.path.localeCompare(b.path));
    const sees = who.access.sees;
    const attachments = emptyCounts();
    const pages = emptyCounts();
    const skipped = session.skipped.slice();
    let skippedCount = session.skippedCount;
    const skip = (path: string, reason: ImportSkipReason) => {
      skippedCount += 1;
      if (skipped.length < SKIPPED_LISTED) skipped.push({ path, reason });
    };
    const reasonOf = (error: KnowledgeError): ImportSkipReason => {
      if (error.code === "limit" || error.code === "full") return "limit";
      if (error.code === "bad_path" || error.code === "bad_title") return "bad-path";
      if (error.code === "too_large") return "too-large";
      return "conflict";
    };

    const files = staged.filter((file) => file.kind === "attachment");
    const driveInputs: DriveSaveInput[] = files.map((file) => ({
      path: `${WIKI_ATTACHMENTS_FOLDER}/${session.root}/${file.path}`,
      blob: file.blob,
      actor: who.actor,
      note: IMPORT_SUMMARY,
    }));
    for (const [index, result] of space.drive.saveMany(driveInputs, sees).entries()) {
      if (result.ok) attachments[result.saved.outcome] += 1;
      else skip(files[index]!.path, reasonOf(result.error));
    }

    const textPages = staged.filter((file) => file.kind === "page");
    const imported = new Set<string>();
    for (let start = 0; start < textPages.length; start += PAGES_PER_WRITE) {
      await new Promise<void>((resolve) => setImmediate(resolve));
      const batch = textPages.slice(start, start + PAGES_PER_WRITE);
      const inputs: Array<WikiWriteInput | null> = batch.map((file) => {
        const title = cleanWikiTitle(stemOf(nameOf(file.path)));
        if (!title) {
          skip(file.path, "bad-path");
          return null;
        }
        const content = new TextDecoder("utf-8").decode(space.blobs.read(file.blob.sha256));
        const folder = parentOf(file.path);
        return { title, folder, content, actor: who.actor, summary: IMPORT_SUMMARY };
      });
      const writable = inputs.flatMap((input, index) => (input ? [{ input, file: batch[index]! }] : []));
      for (const [index, result] of space.wiki.writeMany(writable.map((entry) => entry.input), sees).entries()) {
        if (!result.ok) skip(writable[index]!.file.path, reasonOf(result.error));
        else {
          pages[result.saved.outcome] += 1;
          imported.add(result.saved.page.id);
        }
      }
    }

    space.forgetUsage();
    return {
      root: session.root,
      pages,
      attachments,
      links: space.wiki.countLinks(imported, sees),
      skipped,
      skippedCount,
    };
  }
}
