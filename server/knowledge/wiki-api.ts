import { createHash } from "node:crypto";

import {
  WIKI_ATTACHMENTS_FOLDER,
  type WikiGraph,
  type WikiListing,
  type WikiPageDetail,
  type WikiSaveResult,
  type WikiSearchHit,
  type WikiTrashItem,
  type WikiVersionItem,
} from "../../shared/knowledge.ts";
import { toWireActor, type Sees } from "./actors.ts";
import { KnowledgeError } from "./errors.ts";
import type { KnowledgeSpace } from "./space.ts";
import { currentVersion, type WikiPageRecord, type WikiPatch, type WikiSaved } from "./wiki-store.ts";
import { mayDeletePage, toWikiBacklink, toWikiSummary, toWikiTrash, toWikiVersion, type Requester } from "./wire.ts";

export interface WikiBody {
  title?: unknown;
  folder?: unknown;
  content?: unknown;
  summary?: unknown;
  expectedVersion?: unknown;
}

function optionalText(value: unknown, name: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new KnowledgeError("bad_input", `${name} must be text`);
  return value;
}

function optionalVersion(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) throw new KnowledgeError("bad_input", "expectedVersion must be a whole number");
  return value;
}

/** Every Wiki operation of one asker in one space; a page the asker may not see is neither listed, read, linked nor counted. */
export class WikiApi {
  private readonly space: KnowledgeSpace;
  private readonly who: Requester;
  private readonly sees: Sees;

  constructor(space: KnowledgeSpace, who: Requester) {
    this.space = space;
    this.who = who;
    this.sees = who.access.sees;
  }

  list(query: { q?: unknown; folder?: unknown; tag?: unknown }): WikiListing {
    const { wiki } = this.space;
    const text = typeof query.q === "string" ? query.q.trim() : "";
    const folder = typeof query.folder === "string" ? query.folder : undefined;
    const tag = typeof query.tag === "string" ? query.tag : undefined;
    let pages: WikiSearchHit[];
    if (text) {
      const scoped = new Set(wiki.list(this.sees, { ...(folder ? { folder } : {}), ...(tag ? { tag } : {}) }).map((page) => page.id));
      pages = wiki
        .search(text, this.sees, 100)
        .filter((hit) => scoped.has(hit.page.id))
        .map((hit) => ({ ...toWikiSummary(hit.page, this.who), snippet: hit.snippet }));
    } else {
      pages = wiki.list(this.sees, { ...(folder ? { folder } : {}), ...(tag ? { tag } : {}) }).map((page) => ({ ...toWikiSummary(page, this.who), snippet: page.analysis.excerpt }));
    }
    return { space: this.space.id, query: text, pages, folders: wiki.folders(this.sees), tags: wiki.tags(this.sees), maxPageBytes: this.space.limits.wikiPageMaxBytes };
  }

  private files(page: WikiPageRecord): Record<string, string> {
    const out: Record<string, string> = {};
    for (const reference of [...page.analysis.embeds, ...page.analysis.images]) {
      const found = this.space.drive.findAsset(reference, WIKI_ATTACHMENTS_FOLDER, this.sees);
      if (found) out[reference] = found;
    }
    return out;
  }

  private detail(page: WikiPageRecord): WikiPageDetail {
    const { wiki } = this.space;
    const latest = currentVersion(page);
    return {
      ...toWikiSummary(page, this.who),
      content: wiki.content(page),
      version: latest.n,
      createdAt: page.createdAt,
      createdBy: toWireActor(page.createdBy),
      backlinks: wiki.backlinks(page.id, this.sees).map((backlink) => toWikiBacklink(backlink.page, backlink.context)),
      links: wiki.linkMap(page, this.sees),
      files: this.files(page),
    };
  }

  private saved(result: WikiSaved): WikiSaveResult {
    if (result.pruned) this.space.forgetUsage();
    else if (result.outcome !== "unchanged") this.space.noteWritten(result.version);
    return { outcome: result.outcome, page: this.detail(result.page) };
  }

  page(id: string): WikiPageDetail {
    return this.detail(this.space.wiki.get(id, this.sees));
  }

  /** A page by its title (or `Folder/Title`), then by an alias or a title it used to have. */
  pageByTitle(reference: string): WikiPageDetail | null {
    const { wiki } = this.space;
    const page = wiki.findByTitle(reference, this.sees) ?? wiki.resolve(reference, this.sees);
    return page ? this.detail(page) : null;
  }

  search(query: string, limit = 10): WikiSearchHit[] {
    return this.space.wiki.search(query, this.sees, limit).map((hit) => ({ ...toWikiSummary(hit.page, this.who), snippet: hit.snippet }));
  }

  private assertRoomFor(content: string | undefined): void {
    if (content === undefined) return;
    const bytes = Buffer.from(content, "utf8");
    this.space.assertRoomFor({ sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.byteLength });
  }

  create(body: WikiBody): WikiSaveResult {
    const content = optionalText(body.content, "content") ?? "";
    const title = optionalText(body.title, "title");
    if (title === undefined) throw new KnowledgeError("bad_title", "the title is required");
    this.assertRoomFor(content);
    const folder = optionalText(body.folder, "folder");
    const summary = optionalText(body.summary, "summary");
    return this.saved(
      this.space.wiki.createPage(
        { title, content, actor: this.who.actor, ...(folder !== undefined ? { folder } : {}), ...(summary !== undefined ? { summary } : {}) },
        this.sees,
      ),
    );
  }

  update(id: string, body: WikiBody): WikiSaveResult {
    const patch: WikiPatch = {};
    const content = optionalText(body.content, "content");
    const title = optionalText(body.title, "title");
    const folder = optionalText(body.folder, "folder");
    const summary = optionalText(body.summary, "summary");
    const expected = optionalVersion(body.expectedVersion);
    if (content !== undefined) patch.content = content;
    if (title !== undefined) patch.title = title;
    if (folder !== undefined) patch.folder = folder;
    if (summary !== undefined) patch.summary = summary;
    if (expected !== undefined) patch.expectedVersion = expected;
    this.assertRoomFor(content);
    return this.saved(this.space.wiki.update(id, patch, this.who.actor, this.sees));
  }

  /** What an agent does: write the page called this, creating it when it does not exist. */
  writeByTitle(reference: string, content: string, summary?: string): WikiSaveResult {
    const { wiki } = this.space;
    this.assertRoomFor(content);
    const cleaned = reference.normalize("NFC").trim().replace(/^\/+/, "").replace(/\.(?:md|markdown)$/i, "");
    const cut = cleaned.lastIndexOf("/");
    const folder = cut >= 0 ? cleaned.slice(0, cut) : undefined;
    const title = cut >= 0 ? cleaned.slice(cut + 1) : cleaned;
    const existing = wiki.findByTitle(cleaned, this.sees);
    if (existing) return this.saved(wiki.update(existing.id, { content, ...(summary ? { summary } : {}) }, this.who.actor, this.sees));
    return this.saved(wiki.write({ title, content, actor: this.who.actor, ...(folder !== undefined ? { folder } : {}), ...(summary ? { summary } : {}) }, this.sees));
  }

  remove(id: string): void {
    this.space.wiki.remove(id, this.who.actor, (page) => mayDeletePage(this.who, page), this.sees);
  }

  versions(id: string): WikiVersionItem[] {
    const { wiki } = this.space;
    const page = wiki.get(id, this.sees);
    return wiki.versions(id, this.sees).map((version) => toWikiVersion(page, version));
  }

  versionContent(id: string, n: number): { n: number; title: string; folder: string; content: string } {
    const { wiki } = this.space;
    const page = wiki.get(id, this.sees);
    const version = page.versions.find((candidate) => candidate.n === n);
    if (!version) throw new KnowledgeError("not_found", "that version no longer exists");
    return { n, title: version.title, folder: version.folder, content: wiki.content(page, version) };
  }

  restoreVersion(id: string, n: number): WikiSaveResult {
    return this.saved(this.space.wiki.restoreVersion(id, n, this.who.actor, this.sees));
  }

  graph(): WikiGraph {
    return this.space.wiki.graph(this.sees);
  }

  trash(): WikiTrashItem[] {
    return this.space.wiki.trashed(this.sees).map(toWikiTrash);
  }

  restoreFromTrash(id: string): WikiPageDetail {
    const { wiki } = this.space;
    const page = wiki.trashedPage(id, this.sees);
    if (!mayDeletePage(this.who, page)) throw new KnowledgeError("forbidden", "only the person who created the page, or an admin, can bring it back");
    return this.detail(wiki.restoreFromTrash(id, this.sees));
  }
}
