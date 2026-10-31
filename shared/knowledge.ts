import { extensionOf } from "./knowledge-path.ts";

/** Where the Drive and the Wiki keep their files and pages: "internal" is the company's own, `client:<name>` belongs to one client. */
export type KnowledgeSpaceId = "internal" | `client:${string}`;

export interface WireKnowledgeSpace {
  id: KnowledgeSpaceId;
  kind: "internal" | "client";
  /** The client's name as its bots carry it. Absent for the internal space. */
  client?: string;
}

export interface WireKnowledgeActor {
  kind: "bot" | "person";
  /** The bot's id. Never set for a person. */
  id?: string;
  name: string;
}

export type PreviewKind = "image" | "pdf" | "markdown" | "text" | "csv" | "audio" | "video" | "none";

const PREVIEW_BY_EXTENSION: Readonly<Record<string, PreviewKind>> = {
  png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image",
  pdf: "pdf",
  md: "markdown", markdown: "markdown",
  txt: "text", log: "text", json: "text", yaml: "text", yml: "text", xml: "text", html: "text", htm: "text", svg: "text",
  js: "text", mjs: "text", ts: "text", tsx: "text", jsx: "text", css: "text", py: "text", sh: "text", sql: "text", ini: "text", toml: "text", diff: "text", patch: "text", rtf: "text",
  csv: "csv", tsv: "csv",
  mp3: "audio", m4a: "audio", wav: "audio", ogg: "audio", opus: "audio", aac: "audio", flac: "audio",
  mp4: "video", webm: "video", mov: "video", m4v: "video",
};

export function previewKindFor(name: string): PreviewKind {
  return PREVIEW_BY_EXTENSION[extensionOf(name)] ?? "none";
}

export const TEXT_PREVIEW_MAX_BYTES = 512 * 1024;

export interface DriveFolderItem {
  kind: "folder";
  name: string;
  path: string;
  updatedAt: number;
  items: number;
}

export interface DriveFileItem {
  kind: "file";
  name: string;
  path: string;
  mime: string;
  size: number;
  updatedAt: number;
  by: WireKnowledgeActor;
  versions: number;
  preview: PreviewKind;
  /** Whether the asker may delete it: an admin, or the person who first saved it. */
  canDelete: boolean;
}

export type DriveItem = DriveFolderItem | DriveFileItem;

export interface DriveListing {
  space: KnowledgeSpaceId;
  path: string;
  breadcrumb: Array<{ name: string; path: string }>;
  items: DriveItem[];
  maxFileBytes: number;
}

export interface DriveVersionItem {
  n: number;
  size: number;
  at: number;
  by: WireKnowledgeActor;
  note?: string;
  current: boolean;
}

export type SaveOutcome = "created" | "updated" | "unchanged";

export interface DriveSaveResult {
  outcome: SaveOutcome;
  file: DriveFileItem;
  version: number;
}

/** What an upload answers: where the file went, which the server decides when it is told only the conversation. */
export interface DriveUploadResult extends DriveSaveResult {
  space: KnowledgeSpaceId;
}

export interface DriveSpaces {
  spaces: WireKnowledgeSpace[];
  /** Whether this person may choose who opens the company's space. */
  admin: boolean;
}

export interface DriveTrashItem {
  id: string;
  path: string;
  name: string;
  size: number;
  versions: number;
  deletedAt: number;
  deletedBy: WireKnowledgeActor;
}

export interface WikiPageSummary {
  id: string;
  title: string;
  folder: string;
  aliases: string[];
  tags: string[];
  excerpt: string;
  updatedAt: number;
  updatedBy: WireKnowledgeActor;
  versions: number;
  canDelete: boolean;
}

export interface WikiBacklink {
  id: string;
  title: string;
  folder: string;
  /** The line of the other page that links here. */
  excerpt: string;
}

export interface WikiSearchHit extends WikiPageSummary {
  /** The line that matched the search, or the start of the page when nothing was searched. */
  snippet: string;
}

/** Where the images and files of an imported vault are kept in the Drive. */
export const WIKI_ATTACHMENTS_FOLDER = "Wiki/anexos";

export interface WikiListing {
  space: KnowledgeSpaceId;
  query: string;
  pages: WikiSearchHit[];
  folders: string[];
  tags: Array<{ tag: string; count: number }>;
  maxPageBytes: number;
}

export interface WikiPageDetail extends WikiPageSummary {
  content: string;
  version: number;
  createdAt: number;
  createdBy: WireKnowledgeActor;
  backlinks: WikiBacklink[];
  /** Each link written in the page, mapped to the page it leads to, or null when there is none yet. */
  links: Record<string, string | null>;
  /** Each image or file the page embeds, mapped to the Drive path that holds it. */
  files: Record<string, string>;
}

export interface WikiSaveResult {
  outcome: SaveOutcome;
  page: WikiPageDetail;
}

export interface WikiVersionItem {
  n: number;
  size: number;
  at: number;
  by: WireKnowledgeActor;
  summary?: string;
  current: boolean;
}

export interface WikiGraphNode {
  id: string;
  title: string;
  folder: string;
  degree: number;
}

export interface WikiGraph {
  nodes: WikiGraphNode[];
  edges: Array<{ source: string; target: string }>;
  truncated: boolean;
}

export interface WikiTrashItem {
  id: string;
  title: string;
  folder: string;
  deletedAt: number;
  deletedBy: WireKnowledgeActor;
}

export type ImportSkipReason = "hidden" | "unsupported" | "too-large" | "bad-path" | "conflict" | "limit";

export interface WikiImportSummary {
  root: string;
  pages: { created: number; updated: number; unchanged: number };
  attachments: { created: number; updated: number; unchanged: number };
  links: { resolved: number; missing: number };
  skipped: Array<{ path: string; reason: ImportSkipReason }>;
  skippedCount: number;
}

export interface WikiImportLimits {
  maxFiles: number;
  maxBytes: number;
  maxFileBytes: number;
}
