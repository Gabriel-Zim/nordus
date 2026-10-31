import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

import { foldKey, parsePath, stripMarks } from "../../shared/knowledge-path.ts";
import type { WikiGraph } from "../../shared/knowledge.ts";
import { analyzeWikiPage, cleanWikiTitle, createWikiResolver, scanWikiLinks, type WikiAnalysis } from "../../shared/wiki-markdown.ts";
import { writeFileAtomic } from "../atomic.ts";
import { SEES_ALL, storableActor, visibleHistory, type KnowledgeActor, type Sees } from "./actors.ts";
import type { BlobStore, StoredBlob } from "./blob-store.ts";
import { badPath, isKnowledgeError, KnowledgeError } from "./errors.ts";
import type { KnowledgeLimits } from "./limits.ts";

export interface WikiVersionRecord {
  n: number;
  sha256: string;
  size: number;
  at: number;
  by: KnowledgeActor;
  title: string;
  folder: string;
  summary?: string;
}

export interface WikiPageRecord {
  id: string;
  title: string;
  folder: string;
  createdAt: number;
  createdBy: KnowledgeActor;
  nextVersion: number;
  versions: WikiVersionRecord[];
  formerTitles: string[];
  analysis: WikiAnalysis;
  deleted?: { at: number; by: KnowledgeActor };
}

interface WikiIndexFile {
  version: 1;
  pages: WikiPageRecord[];
}

export interface WikiWriteInput {
  title: string;
  folder?: string;
  content: string;
  actor: KnowledgeActor;
  summary?: string;
}

export interface WikiPatch {
  content?: string;
  title?: string;
  folder?: string;
  /** The version the editor started from; a newer one on the server means someone else saved in between. */
  expectedVersion?: number;
  summary?: string;
}

export interface WikiSaved {
  outcome: "created" | "updated" | "unchanged";
  page: WikiPageRecord;
  version: WikiVersionRecord;
  pruned: boolean;
}

export type WikiBatchItem = { ok: true; saved: WikiSaved } | { ok: false; error: KnowledgeError };

export interface WikiSearchResult {
  page: WikiPageRecord;
  score: number;
  snippet: string;
}

export interface WikiBacklinkResult {
  page: WikiPageRecord;
  context: string;
}

interface GraphIndex {
  resolve: (target: string, fromFolder?: string) => string | null;
  outgoing: Map<string, string[]>;
  incoming: Map<string, string[]>;
}

export const currentVersion = (page: WikiPageRecord): WikiVersionRecord => page.versions[page.versions.length - 1]!;

const TEXT_CACHE_BYTES = 64 * 1024 * 1024;
const FORMER_TITLES_MAX = 20;
const TITLE_UNUSABLE = "that title can't be used here, choose another";
const SUMMARY_MAX = 200;
const GRAPH_CACHE_ENTRIES = 8;

const norm = (value: string) => stripMarks(foldKey(value));
const pathKey = (folder: string, title: string) => foldKey(folder ? `${folder}/${title}` : title);

function countUpTo(haystack: string, needle: string, cap: number): number {
  let count = 0;
  for (let at = haystack.indexOf(needle); at >= 0 && count < cap; at = haystack.indexOf(needle, at + needle.length)) count += 1;
  return count;
}

function lineAround(content: string, terms: readonly string[], fallback: string): string {
  for (const line of content.split("\n")) {
    const folded = norm(line);
    if (terms.some((term) => folded.includes(term))) {
      const clean = line.replace(/^[\s>#*\-+]+/, "").replace(/\s+/g, " ").trim();
      if (clean) return clean.length > 200 ? `${clean.slice(0, 200)}...` : clean;
    }
  }
  return fallback;
}

export class WikiStore {
  private readonly file: string;
  private readonly blobs: BlobStore;
  private readonly limits: KnowledgeLimits;
  private pages: WikiPageRecord[] = [];
  private live = new Map<string, WikiPageRecord>();
  private byId = new Map<string, WikiPageRecord>();
  private folderCase = new Map<string, string>();
  private graphs = new Map<string, GraphIndex>();
  private texts = new Map<string, string>();
  private textBytes = 0;

  constructor(file: string, blobs: BlobStore, limits: KnowledgeLimits) {
    this.file = file;
    this.blobs = blobs;
    this.limits = limits;
    this.load();
  }

  private load(): void {
    let parsed: Partial<WikiIndexFile> | null = null;
    if (existsSync(this.file)) {
      try {
        parsed = JSON.parse(readFileSync(this.file, "utf8")) as Partial<WikiIndexFile>;
      } catch {
        throw new Error(`The Wiki index at ${this.file} could not be read; it was left as it is.`);
      }
      if (!parsed || !Array.isArray(parsed.pages)) throw new Error(`The Wiki index at ${this.file} has an unexpected shape; it was left as it is.`);
    }
    this.pages = parsed?.pages ?? [];
    this.reindex();
  }

  /** A write that fails puts the in-memory index back to what is on disk. */
  private persist(): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
      const data: WikiIndexFile = { version: 1, pages: this.pages };
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
    this.graphs = new Map();
    for (const page of this.pages) this.index(page);
  }

  private index(page: WikiPageRecord): void {
    this.byId.set(page.id, page);
    if (page.deleted) return;
    this.live.set(pathKey(page.folder, page.title), page);
    this.addFolders(page.folder);
  }

  private addFolders(folder: string): void {
    if (!folder) return;
    const parts = folder.split("/");
    for (let length = 1; length <= parts.length; length += 1) {
      const prefix = parts.slice(0, length).join("/");
      if (!this.folderCase.has(foldKey(prefix))) this.folderCase.set(foldKey(prefix), prefix);
    }
  }

  private canonicalFolder(input: unknown): string {
    const parsed = parsePath(input ?? "", { allowRoot: true });
    if (!parsed.ok) throw badPath(parsed.problem);
    const out: string[] = [];
    for (const segment of parsed.segments) {
      const wanted = [...out, segment].join("/");
      out.push(this.folderCase.get(foldKey(wanted))?.split("/").pop() ?? segment);
    }
    return out.join("/");
  }

  private cleanTitle(input: unknown): string {
    const title = cleanWikiTitle(input);
    if (!title) throw new KnowledgeError("bad_title", "the title is empty, too long, or has no usable characters");
    return title;
  }

  private cleanContent(input: unknown): string {
    if (typeof input !== "string") throw new KnowledgeError("bad_input", "the page content must be text");
    if (input.includes("\u0000")) throw new KnowledgeError("bad_input", "the page content has a character that is not allowed");
    const bytes = Buffer.byteLength(input, "utf8");
    if (bytes > this.limits.wikiPageMaxBytes) {
      throw new KnowledgeError("too_large", `a page can hold up to ${this.limits.wikiPageMaxBytes} bytes`, { maxBytes: this.limits.wikiPageMaxBytes });
    }
    return input;
  }

  count(): number {
    return this.live.size;
  }

  content(page: WikiPageRecord, version: WikiVersionRecord = currentVersion(page)): string {
    return this.blobs.read(version.sha256).toString("utf8");
  }

  private text(page: WikiPageRecord): string {
    const sha = currentVersion(page).sha256;
    const hit = this.texts.get(sha);
    if (hit !== undefined) {
      this.texts.delete(sha);
      this.texts.set(sha, hit);
      return hit;
    }
    let folded = "";
    try {
      folded = norm(this.blobs.read(sha).toString("utf8"));
    } catch (error) {
      if (!isKnowledgeError(error)) throw error;
    }
    this.texts.set(sha, folded);
    this.textBytes += folded.length * 2;
    while (this.textBytes > TEXT_CACHE_BYTES && this.texts.size > 1) {
      const [oldest, value] = this.texts.entries().next().value!;
      this.texts.delete(oldest);
      this.textBytes -= value.length * 2;
    }
    return folded;
  }

  get(id: string, sees: Sees = SEES_ALL): WikiPageRecord {
    const page = this.byId.get(id);
    if (!page || page.deleted || !visibleHistory(page, sees)) throw new KnowledgeError("not_found", "page not found");
    return page;
  }

  private visible(sees: Sees): WikiPageRecord[] {
    return [...this.live.values()].filter((page) => visibleHistory(page, sees));
  }

  list(sees: Sees, filter: { folder?: string; tag?: string } = {}): WikiPageRecord[] {
    const folder = filter.folder ? norm(filter.folder) : "";
    const tag = filter.tag ? norm(filter.tag.replace(/^#/, "")) : "";
    return this.visible(sees)
      .filter((page) => !folder || norm(page.folder) === folder || norm(page.folder).startsWith(`${folder}/`))
      .filter((page) => !tag || page.analysis.tags.some((candidate) => norm(candidate) === tag))
      .sort((a, b) => currentVersion(b).at - currentVersion(a).at);
  }

  folders(sees: Sees): string[] {
    const folders = new Map<string, string>();
    for (const page of this.visible(sees)) {
      const parts = page.folder ? page.folder.split("/") : [];
      for (let length = 1; length <= parts.length; length += 1) {
        const prefix = parts.slice(0, length).join("/");
        folders.set(foldKey(prefix), prefix);
      }
    }
    return [...folders.values()].sort((a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base" }));
  }

  tags(sees: Sees): Array<{ tag: string; count: number }> {
    const counts = new Map<string, { tag: string; count: number }>();
    for (const page of this.visible(sees)) {
      for (const tag of page.analysis.tags) {
        const known = counts.get(foldKey(tag));
        if (known) known.count += 1;
        else counts.set(foldKey(tag), { tag, count: 1 });
      }
    }
    return [...counts.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  }

  /** A page by its exact title, or by `Folder/Title`; the page nearest the top wins when the same title lives in several folders. */
  findByTitle(reference: string, sees: Sees = SEES_ALL): WikiPageRecord | null {
    const cleaned = reference.normalize("NFC").trim().replace(/^\/+/, "").replace(/\.(?:md|markdown)$/i, "");
    const cut = cleaned.lastIndexOf("/");
    if (cut >= 0) {
      const page = this.live.get(foldKey(cleaned));
      return page && visibleHistory(page, sees) ? page : null;
    }
    const wanted = foldKey(cleaned);
    const matches = this.visible(sees).filter((page) => foldKey(page.title) === wanted);
    matches.sort((a, b) => a.folder.split("/").filter(Boolean).length - b.folder.split("/").filter(Boolean).length || a.folder.localeCompare(b.folder));
    return matches[0] ?? null;
  }

  private buildGraph(pages: readonly WikiPageRecord[]): GraphIndex {
    const resolve = createWikiResolver(pages.map((page) => ({ id: page.id, title: page.title, folder: page.folder, aliases: [...page.analysis.aliases, ...page.formerTitles] })));
    const outgoing = new Map<string, string[]>();
    const incoming = new Map<string, string[]>();
    for (const page of pages) {
      const targets = new Set<string>();
      for (const target of [...page.analysis.links, ...page.analysis.embeds]) {
        const id = resolve(target, page.folder);
        if (id && id !== page.id) targets.add(id);
      }
      outgoing.set(page.id, [...targets]);
      for (const id of targets) {
        const list = incoming.get(id);
        if (list) list.push(page.id);
        else incoming.set(id, [page.id]);
      }
    }
    return { resolve, outgoing, incoming };
  }

  /** Links are resolved among the pages the asker may see, so a hidden page is neither followed nor revealed. */
  private graphFor(sees: Sees): GraphIndex {
    const visible = this.visible(sees);
    let key = "";
    if (visible.length !== this.live.size) {
      const shown = new Set(visible.map((page) => page.id));
      key = [...this.live.values()].filter((page) => !shown.has(page.id)).map((page) => page.id).sort().join(",");
    }
    const cached = this.graphs.get(key);
    if (cached) return cached;
    const built = this.buildGraph(visible);
    if (this.graphs.size >= GRAPH_CACHE_ENTRIES) this.graphs.delete(this.graphs.keys().next().value!);
    this.graphs.set(key, built);
    return built;
  }

  resolve(target: string, sees: Sees, fromFolder = ""): WikiPageRecord | null {
    const id = this.graphFor(sees).resolve(target, fromFolder);
    return id ? (this.byId.get(id) ?? null) : null;
  }

  linkMap(page: WikiPageRecord, sees: Sees): Record<string, string | null> {
    const graph = this.graphFor(sees);
    const out: Record<string, string | null> = {};
    for (const target of [...page.analysis.links, ...page.analysis.embeds]) out[target] = graph.resolve(target, page.folder);
    return out;
  }

  backlinks(id: string, sees: Sees): WikiBacklinkResult[] {
    const target = this.get(id, sees);
    const graph = this.graphFor(sees);
    const results: WikiBacklinkResult[] = [];
    for (const sourceId of graph.incoming.get(id) ?? []) {
      const source = this.byId.get(sourceId);
      if (!source) continue;
      let context = source.analysis.excerpt;
      try {
        const content = this.content(source);
        const link = scanWikiLinks(content).find((candidate) => candidate.target && graph.resolve(candidate.target, source.folder) === target.id);
        if (link) context = lineAround(content, [norm(link.target)], context);
      } catch (error) {
        if (!isKnowledgeError(error)) throw error;
      }
      results.push({ page: source, context });
    }
    return results.sort((a, b) => a.page.title.localeCompare(b.page.title, "pt-BR", { sensitivity: "base" }));
  }

  graph(sees: Sees, limit = 400): WikiGraph {
    const graph = this.graphFor(sees);
    const pages = this.visible(sees);
    const degree = (page: WikiPageRecord) => new Set([...(graph.outgoing.get(page.id) ?? []), ...(graph.incoming.get(page.id) ?? [])]).size;
    const ranked = pages.map((page) => ({ page, degree: degree(page) })).sort((a, b) => b.degree - a.degree || currentVersion(b.page).at - currentVersion(a.page).at);
    const kept = ranked.slice(0, limit);
    const keptIds = new Set(kept.map((entry) => entry.page.id));
    const edges: Array<{ source: string; target: string }> = [];
    for (const { page } of kept) {
      for (const target of graph.outgoing.get(page.id) ?? []) if (keptIds.has(target)) edges.push({ source: page.id, target });
    }
    return {
      nodes: kept.map(({ page, degree: value }) => ({ id: page.id, title: page.title, folder: page.folder, degree: value })),
      edges,
      truncated: ranked.length > kept.length,
    };
  }

  search(query: string, sees: Sees, limit = 30): WikiSearchResult[] {
    const terms = norm(query).split(/\s+/).filter(Boolean).slice(0, 8);
    if (terms.length === 0) return [];
    const results: WikiSearchResult[] = [];
    for (const page of this.visible(sees)) {
      const title = norm(page.title);
      const folder = norm(page.folder);
      const aliases = [...page.analysis.aliases, ...page.formerTitles].map(norm);
      const tags = page.analysis.tags.map(norm);
      const body = this.text(page);
      let score = 0;
      for (const term of terms) {
        let part = 0;
        if (title === term) part += 100;
        else if (title.startsWith(term)) part += 60;
        else if (title.includes(term)) part += 40;
        if (aliases.some((alias) => alias.includes(term))) part += 30;
        if (tags.some((tag) => tag.includes(term))) part += 25;
        if (folder.includes(term)) part += 10;
        part += countUpTo(body, term, 5) * 2;
        if (part === 0) {
          score = 0;
          break;
        }
        score += part;
      }
      if (score > 0) results.push({ page, score, snippet: page.analysis.excerpt });
    }
    results.sort((a, b) => b.score - a.score || currentVersion(b.page).at - currentVersion(a.page).at);
    const top = results.slice(0, limit);
    for (const hit of top) {
      try {
        hit.snippet = lineAround(this.content(hit.page), terms, hit.page.analysis.excerpt);
      } catch (error) {
        if (!isKnowledgeError(error)) throw error;
      }
    }
    return top;
  }

  versions(id: string, sees: Sees): WikiVersionRecord[] {
    return [...this.get(id, sees).versions].reverse();
  }

  private prune(page: WikiPageRecord): boolean {
    let pruned = false;
    while (page.versions.length > this.limits.maxVersions) {
      page.versions.shift();
      pruned = true;
    }
    return pruned;
  }

  private addVersion(page: WikiPageRecord, content: string, blob: StoredBlob, actor: KnowledgeActor, summary: string | undefined): WikiVersionRecord {
    const note = summary?.trim().slice(0, SUMMARY_MAX);
    const version: WikiVersionRecord = {
      n: page.nextVersion,
      sha256: blob.sha256,
      size: blob.size,
      at: Date.now(),
      by: storableActor(actor),
      title: page.title,
      folder: page.folder,
      ...(note ? { summary: note } : {}),
    };
    page.nextVersion += 1;
    page.versions.push(version);
    page.analysis = analyzeWikiPage(content);
    return version;
  }

  private create(input: WikiWriteInput, title: string, folder: string, content: string, blob: StoredBlob): WikiSaved {
    if (this.live.size >= this.limits.wikiMaxPages) {
      throw new KnowledgeError("limit", `the Wiki holds at most ${this.limits.wikiMaxPages} pages`, { max: this.limits.wikiMaxPages });
    }
    const page: WikiPageRecord = {
      id: randomUUID(),
      title,
      folder,
      createdAt: Date.now(),
      createdBy: storableActor(input.actor),
      nextVersion: 1,
      versions: [],
      formerTitles: [],
      analysis: analyzeWikiPage(""),
    };
    const version = this.addVersion(page, content, blob, input.actor, input.summary);
    this.pages.push(page);
    this.index(page);
    this.graphs = new Map();
    return { outcome: "created", page, version, pruned: false };
  }

  /** What blocks a title is told only when the asker can see it; a hidden page is refused like any title that cannot be used. */
  private blockedBy(page: WikiPageRecord, sees: Sees): KnowledgeError {
    return visibleHistory(page, sees) ? new KnowledgeError("title_taken", "a page with this title already exists in this folder") : new KnowledgeError("bad_title", TITLE_UNUSABLE);
  }

  private applyWrite(input: WikiWriteInput, sees: Sees): WikiSaved {
    const title = this.cleanTitle(input.title);
    const folder = this.canonicalFolder(input.folder);
    const content = this.cleanContent(input.content);
    const existing = this.live.get(pathKey(folder, title));
    if (existing && !visibleHistory(existing, sees)) throw new KnowledgeError("bad_title", TITLE_UNUSABLE);
    const blob = this.blobs.putBuffer(Buffer.from(content, "utf8"));
    if (!existing) return this.create(input, title, folder, content, blob);
    const latest = currentVersion(existing);
    if (blob.sha256 === latest.sha256) return { outcome: "unchanged", page: existing, version: latest, pruned: false };
    const version = this.addVersion(existing, content, blob, input.actor, input.summary);
    this.graphs = new Map();
    return { outcome: "updated", page: existing, version, pruned: this.prune(existing) };
  }

  /** Creates the page, or saves a new version when one with this title already sits in the folder. */
  write(input: WikiWriteInput, sees: Sees = SEES_ALL): WikiSaved {
    const saved = this.applyWrite(input, sees);
    if (saved.outcome !== "unchanged") this.persist();
    return saved;
  }

  /** One write for the whole batch; a page that cannot be saved is reported and the others still go in. */
  writeMany(inputs: readonly WikiWriteInput[], sees: Sees = SEES_ALL): WikiBatchItem[] {
    const results: WikiBatchItem[] = [];
    let changed = false;
    try {
      for (const input of inputs) {
        try {
          const saved = this.applyWrite(input, sees);
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

  createPage(input: WikiWriteInput, sees: Sees = SEES_ALL): WikiSaved {
    const folder = this.canonicalFolder(input.folder);
    const title = this.cleanTitle(input.title);
    const taken = this.live.get(pathKey(folder, title));
    if (taken) throw this.blockedBy(taken, sees);
    return this.write(input, sees);
  }

  update(id: string, patch: WikiPatch, actor: KnowledgeActor, sees: Sees = SEES_ALL): WikiSaved {
    const page = this.get(id, sees);
    const latest = currentVersion(page);
    if (patch.expectedVersion !== undefined && patch.expectedVersion !== latest.n) {
      throw new KnowledgeError("conflict", "someone else saved this page while you were editing", { currentVersion: latest.n });
    }
    const title = patch.title === undefined ? page.title : this.cleanTitle(patch.title);
    const folder = patch.folder === undefined ? page.folder : this.canonicalFolder(patch.folder);
    const content = patch.content === undefined ? this.content(page) : this.cleanContent(patch.content);
    const moved = title !== page.title || folder !== page.folder;
    if (moved) {
      const taken = this.live.get(pathKey(folder, title));
      if (taken && taken !== page) throw this.blockedBy(taken, sees);
    }
    const blob = this.blobs.putBuffer(Buffer.from(content, "utf8"));
    if (!moved && blob.sha256 === latest.sha256) return { outcome: "unchanged", page, version: latest, pruned: false };
    const previousTitle = page.title;
    page.title = title;
    page.folder = folder;
    if (foldKey(previousTitle) !== foldKey(title)) {
      const keep = (former: string) => foldKey(former) !== foldKey(previousTitle) && foldKey(former) !== foldKey(title);
      page.formerTitles = [previousTitle, ...page.formerTitles.filter(keep)].slice(0, FORMER_TITLES_MAX);
    }
    const version = this.addVersion(page, content, blob, actor, patch.summary);
    const pruned = this.prune(page);
    this.commit();
    return { outcome: "updated", page, version, pruned };
  }

  restoreVersion(id: string, n: number, actor: KnowledgeActor, sees: Sees = SEES_ALL): WikiSaved {
    const page = this.get(id, sees);
    const wanted = page.versions.find((version) => version.n === n);
    if (!wanted) throw new KnowledgeError("not_found", "that version no longer exists");
    const latest = currentVersion(page);
    if (wanted.sha256 === latest.sha256) return { outcome: "unchanged", page, version: latest, pruned: false };
    const version = this.addVersion(page, this.content(page, wanted), { sha256: wanted.sha256, size: wanted.size }, actor, `restore:${wanted.n}`);
    const pruned = this.prune(page);
    this.graphs = new Map();
    this.persist();
    return { outcome: "updated", page, version, pruned };
  }

  remove(id: string, actor: KnowledgeActor, mayDelete: (page: WikiPageRecord) => boolean, sees: Sees = SEES_ALL): void {
    const page = this.get(id, sees);
    if (!mayDelete(page)) throw new KnowledgeError("forbidden", "only the person who created the page, or an admin, can delete it");
    page.deleted = { at: Date.now(), by: storableActor(actor) };
    this.commit();
  }

  trashed(sees: Sees): WikiPageRecord[] {
    return this.pages.filter((page) => page.deleted && visibleHistory(page, sees)).sort((a, b) => b.deleted!.at - a.deleted!.at);
  }

  trashedPage(id: string, sees: Sees = SEES_ALL): WikiPageRecord {
    const page = this.byId.get(id);
    if (!page?.deleted || !visibleHistory(page, sees)) throw new KnowledgeError("not_found", "this page is not in the trash");
    return page;
  }

  restoreFromTrash(id: string, sees: Sees = SEES_ALL): WikiPageRecord {
    const page = this.trashedPage(id, sees);
    const taken = this.live.get(pathKey(page.folder, page.title));
    if (taken) throw this.blockedBy(taken, sees);
    delete page.deleted;
    this.commit();
    return page;
  }

  purge(ids: readonly string[]): number {
    const wanted = new Set(ids);
    const before = this.pages.length;
    this.pages = this.pages.filter((page) => !(wanted.has(page.id) && page.deleted));
    const removed = before - this.pages.length;
    if (removed > 0) this.commit();
    return removed;
  }

  expiredTrash(now: number): string[] {
    const cutoff = now - this.limits.trashDays * 86_400_000;
    return this.pages.filter((page) => page.deleted && page.deleted.at < cutoff).map((page) => page.id);
  }

  blobSizes(): Map<string, number> {
    const sizes = new Map<string, number>();
    for (const page of this.pages) for (const version of page.versions) sizes.set(version.sha256, version.size);
    return sizes;
  }

  referenced(): Set<string> {
    const shas = new Set<string>();
    for (const page of this.pages) for (const version of page.versions) shas.add(version.sha256);
    return shas;
  }

  /** How many of the links written in these pages lead to a page, and how many lead nowhere yet. */
  countLinks(ids: ReadonlySet<string>, sees: Sees = SEES_ALL): { resolved: number; missing: number } {
    const graph = this.graphFor(sees);
    let resolved = 0;
    let missing = 0;
    for (const id of ids) {
      const page = this.byId.get(id);
      if (!page || page.deleted) continue;
      for (const target of page.analysis.links) {
        if (graph.resolve(target, page.folder)) resolved += 1;
        else missing += 1;
      }
    }
    return { resolved, missing };
  }
}
