import { foldKey, hasUnsafeCharacter, replaceUnsafe } from "./knowledge-path.ts";

export const WIKI_TITLE_MAX = 120;
export const WIKI_TAG_MAX = 60;
export const WIKI_TAGS_PER_PAGE = 50;
export const WIKI_LINK_TARGET_MAX = 300;
export const WIKI_LINKS_PER_PAGE = 500;

export interface WikiLink {
  raw: string;
  target: string;
  heading?: string;
  alias?: string;
  embed: boolean;
  index: number;
}

function runEnd(line: string, from: number): number {
  let end = from;
  while (line[end] === "`") end += 1;
  return end;
}

function maskInlineCode(line: string): string {
  if (!line.includes("`")) return line;
  const runs: Array<{ at: number; length: number }> = [];
  for (let i = 0; i < line.length; ) {
    if (line[i] !== "`") {
      i += 1;
      continue;
    }
    const end = runEnd(line, i);
    runs.push({ at: i, length: end - i });
    i = end;
  }
  const closer: number[] = Array.from({ length: runs.length }, () => -1);
  const nextOfLength = new Map<number, number>();
  for (let r = runs.length - 1; r >= 0; r -= 1) {
    closer[r] = nextOfLength.get(runs[r]!.length) ?? -1;
    nextOfLength.set(runs[r]!.length, r);
  }
  let out = "";
  let copied = 0;
  for (let r = 0; r < runs.length; ) {
    const close = closer[r]!;
    if (close < 0) {
      r += 1;
      continue;
    }
    const end = runs[close]!.at + runs[close]!.length;
    out += line.slice(copied, runs[r]!.at) + " ".repeat(end - runs[r]!.at);
    copied = end;
    r = close + 1;
  }
  return out + line.slice(copied);
}

/** Same length as the input, with code blocks and code spans blanked, so offsets still point into the original. */
export function maskCode(text: string): string {
  let fence: { char: string; length: number } | null = null;
  return text.split("\n").map((line) => {
    const open = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (open && open[1]![0] === fence.char && open[1]!.length >= fence.length && /^ {0,3}[`~]+\s*$/.test(line)) fence = null;
      return " ".repeat(line.length);
    }
    if (open) {
      fence = { char: open[1]![0]!, length: open[1]!.length };
      return " ".repeat(line.length);
    }
    return maskInlineCode(line);
  }).join("\n");
}

function parseLinkBody(body: string): { target: string; heading?: string; alias?: string } | null {
  const pipe = body.search(/(?<!\\)\|/);
  const head = pipe < 0 ? body : body.slice(0, pipe);
  const alias = pipe < 0 ? undefined : body.slice(pipe + 1).trim();
  const hash = head.indexOf("#");
  const target = (hash < 0 ? head : head.slice(0, hash)).replace(/\\+$/, "").trim();
  const heading = hash < 0 ? undefined : head.slice(hash + 1).replace(/\\+$/, "").trim();
  if (target.length > WIKI_LINK_TARGET_MAX) return null;
  if (!target && !heading) return null;
  return { target, ...(heading ? { heading } : {}), ...(alias ? { alias } : {}) };
}

/** `[[Page]]`, `[[Page|alias]]`, `[[Page#section]]` and the embed form `![[file]]`, outside code. */
export function scanWikiLinks(markdown: string): WikiLink[] {
  const masked = maskCode(markdown);
  const found: WikiLink[] = [];
  const pattern = /(!?)\[\[([^[\]\n]+)\]\]/g;
  for (let match = pattern.exec(masked); match; match = pattern.exec(masked)) {
    const parsed = parseLinkBody(markdown.slice(match.index + match[1]!.length + 2, match.index + match[0].length - 2));
    if (!parsed) continue;
    found.push({ raw: markdown.slice(match.index, match.index + match[0].length), embed: match[1] === "!", index: match.index, ...parsed });
    if (found.length >= WIKI_LINKS_PER_PAGE) break;
  }
  return found;
}

export interface SplitFrontmatter {
  frontmatter: string | null;
  body: string;
  offset: number;
}

export function splitFrontmatter(text: string): SplitFrontmatter {
  const match = /^﻿?---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(text);
  if (!match) return { frontmatter: null, body: text, offset: 0 };
  return { frontmatter: match[1] ?? "", body: text.slice(match[0].length), offset: match[0].length };
}

function unquote(value: string): string {
  const trimmed = value.trim();
  const first = trimmed[0];
  return (first === '"' || first === "'") && trimmed.endsWith(first) && trimmed.length > 1 ? trimmed.slice(1, -1) : trimmed;
}

function splitList(value: string): string[] {
  const parts: string[] = [];
  let quote = "";
  let current = "";
  for (const char of value) {
    if (quote) {
      current += char;
      if (char === quote) quote = "";
    } else if (char === '"' || char === "'") {
      quote = char;
      current += char;
    } else if (char === ",") {
      parts.push(current);
      current = "";
    } else current += char;
  }
  parts.push(current);
  return parts.map(unquote).filter(Boolean);
}

export function cleanTag(raw: string): string | null {
  const tag = raw.normalize("NFC").trim().replace(/^#+/, "").replace(/\s+/g, "-");
  if (!tag || [...tag].length > WIKI_TAG_MAX || /^[0-9/-]+$/.test(tag) || hasUnsafeCharacter(tag) || /[\\[\]{}<>|"']/.test(tag)) return null;
  return tag;
}

function uniqueFolded(values: Iterable<string>, limit: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = foldKey(value);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= limit) break;
  }
  return out;
}

export function frontmatterFields(frontmatter: string | null): { tags: string[]; aliases: string[] } {
  const tags: string[] = [];
  const aliases: string[] = [];
  if (!frontmatter) return { tags, aliases };
  const lines = frontmatter.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const field = /^(tags?|aliases|alias)\s*:\s*(.*)$/i.exec(lines[i]!);
    if (!field) continue;
    const isTag = field[1]!.toLowerCase().startsWith("tag");
    const rest = field[2]!.trim();
    let values: string[];
    if (rest === "") {
      values = [];
      while (i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1]!)) values.push(unquote(lines[++i]!.replace(/^\s*-\s+/, "")));
    } else if (rest.startsWith("[")) {
      values = splitList(rest.replace(/^\[/, "").replace(/\]\s*$/, ""));
    } else {
      values = isTag ? unquote(rest).split(/[,\s]+/) : splitList(rest);
    }
    if (isTag) for (const value of values) { const tag = cleanTag(value); if (tag) tags.push(tag); }
    else for (const value of values) { const alias = value.normalize("NFC").trim(); if (alias && alias.length <= WIKI_TITLE_MAX) aliases.push(alias); }
  }
  return { tags: uniqueFolded(tags, WIKI_TAGS_PER_PAGE), aliases: uniqueFolded(aliases, 20) };
}

export function inlineTags(body: string): string[] {
  const masked = maskCode(body);
  const found: string[] = [];
  const pattern = /(?:^|[\s(])#([\p{L}\p{N}_][\p{L}\p{N}_/-]*)/gu;
  for (let match = pattern.exec(masked); match; match = pattern.exec(masked)) {
    const tag = cleanTag(match[1]!);
    if (tag) found.push(tag);
  }
  return found;
}

export interface WikiAnalysis {
  tags: string[];
  aliases: string[];
  links: string[];
  embeds: string[];
  /** Local images written the Markdown way, `![alt](folder/photo.png)`; addresses on the web are left out. */
  images: string[];
  excerpt: string;
}

const IMAGE = /!\[[^\]\n]{0,300}\]\(\s{0,20}(<[^>\n]{1,300}>|[^)\s]{1,300})(?:\s{1,20}(?:"[^"\n]{0,300}"|'[^'\n]{0,300}'))?\s{0,20}\)/g;

export function markdownImageTargets(body: string): string[] {
  const masked = maskCode(body);
  const found: string[] = [];
  for (const match of masked.matchAll(IMAGE)) {
    let target = match[1]!.replace(/^<|>$/g, "");
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(target)) continue;
    target = target.replace(/[?#].*$/, "");
    try {
      target = decodeURIComponent(target);
    } catch {
      continue;
    }
    target = target.normalize("NFC").trim();
    if (target && target.length <= WIKI_LINK_TARGET_MAX) found.push(target);
    if (found.length >= WIKI_LINKS_PER_PAGE) break;
  }
  return uniqueFolded(found, WIKI_LINKS_PER_PAGE);
}

/** Only the start of a page becomes its excerpt, and every pattern here is capped: a page cannot be written to make the server chew on it. */
const EXCERPT_SCAN_CHARS = 4096;

function plainExcerpt(body: string): string {
  return maskCode(body.slice(0, EXCERPT_SCAN_CHARS))
    .replace(/!\[\[[^\]\n]{0,300}\]\]/g, " ")
    .replace(/\[\[([^\]|#\n]{0,300})(?:#[^\]|\n]{0,300})?\|([^\]\n]{0,300})\]\]/g, "$2")
    .replace(/\[\[([^\]#\n]{0,300})(?:#[^\]\n]{0,300})?\]\]/g, "$1")
    .replace(/!\[[^\]\n]{0,300}\]\([^)\n]{0,300}\)/g, " ")
    .replace(/\[([^\]\n]{0,300})\]\([^)\n]{0,300}\)/g, "$1")
    .replace(/[#>*_`~|]+/g, " ")
    .replace(/(^|\s)-+(?=\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

export function analyzeWikiPage(content: string): WikiAnalysis {
  const { frontmatter, body } = splitFrontmatter(content);
  const fields = frontmatterFields(frontmatter);
  const scanned = scanWikiLinks(content);
  const targets = (embed: boolean) => uniqueFolded(scanned.filter((link) => link.embed === embed && link.target).map((link) => link.target), WIKI_LINKS_PER_PAGE);
  return {
    tags: uniqueFolded([...fields.tags, ...inlineTags(body)], WIKI_TAGS_PER_PAGE),
    aliases: fields.aliases,
    links: targets(false),
    embeds: targets(true),
    images: markdownImageTargets(body),
    excerpt: plainExcerpt(body),
  };
}

const TITLE_FORBIDDEN = /[\\/:*?"<>|#^[\]]/g;

export function cleanWikiTitle(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const title = replaceUnsafe(input.normalize("NFC"), "-").replace(TITLE_FORBIDDEN, "-").replace(/\s+/g, " ").trim();
  if (!title || /^\.+$/.test(title) || [...title].length > WIKI_TITLE_MAX) return null;
  return title;
}

export interface ResolvablePage {
  id: string;
  title: string;
  folder: string;
  aliases?: readonly string[];
}

const depthOf = (folder: string) => (folder ? folder.split("/").length : 0);

function nearest(candidates: readonly ResolvablePage[], fromFolder: string): ResolvablePage | null {
  if (candidates.length === 0) return null;
  const here = foldKey(fromFolder);
  const distance = (page: ResolvablePage) => {
    const folder = foldKey(page.folder);
    if (folder === here) return 0;
    if (here.startsWith(`${folder}/`) || folder === "") return 1 + (depthOf(here) - depthOf(folder)) / 100;
    return 2 + depthOf(folder) / 100;
  };
  return [...candidates].sort((a, b) => distance(a) - distance(b) || foldKey(a.folder + a.title).localeCompare(foldKey(b.folder + b.title)))[0]!;
}

/** Obsidian's rule: a bare name finds the page anywhere (nearest folder wins), `Pasta/Nome` is matched on the path, aliases count. */
export function createWikiResolver(pages: readonly ResolvablePage[]): (target: string, fromFolder?: string) => string | null {
  const byTitle = new Map<string, ResolvablePage[]>();
  const byAlias = new Map<string, ResolvablePage[]>();
  const paths: Array<{ key: string; page: ResolvablePage }> = [];
  const push = (map: Map<string, ResolvablePage[]>, key: string, page: ResolvablePage) => {
    const list = map.get(key);
    if (list) list.push(page);
    else map.set(key, [page]);
  };
  for (const page of pages) {
    push(byTitle, foldKey(page.title), page);
    for (const alias of page.aliases ?? []) push(byAlias, foldKey(alias), page);
    paths.push({ key: foldKey(page.folder ? `${page.folder}/${page.title}` : page.title), page });
  }
  return (target, fromFolder = "") => {
    const cleaned = target.normalize("NFC").trim().replace(/^\/+/, "").replace(/\.(?:md|markdown)$/i, "");
    if (!cleaned) return null;
    const key = foldKey(cleaned);
    if (key.includes("/")) {
      const exact = paths.filter((entry) => entry.key === key).map((entry) => entry.page);
      const tail = exact.length ? exact : paths.filter((entry) => entry.key.endsWith(`/${key}`)).map((entry) => entry.page);
      return nearest(tail, fromFolder)?.id ?? null;
    }
    return nearest(byTitle.get(key) ?? byAlias.get(key) ?? [], fromFolder)?.id ?? null;
  };
}
