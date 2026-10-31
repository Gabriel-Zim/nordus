import { createHash, randomUUID } from "node:crypto";
import {
  constants,
  createReadStream,
  linkSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { link, open, unlink } from "node:fs/promises";
import { join, extname } from "node:path";
import { imageSizeSuffix, readImageSize } from "../shared/image-size.ts";
import { DATA_DIR } from "./config.ts";

export const ATTACHMENTS_DIR = join(DATA_DIR, "attachments");

export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;

/** Any other document or audio file. Bigger than Cloudflare's 100 MB request ceiling on purpose: large files arrive in parts (see saveFilePart). */
export const FILE_MAX_BYTES = 2 * 1024 * 1024 * 1024;
/** Video is the work of an editor bot: it gets its own, larger ceiling. Every other file keeps FILE_MAX_BYTES. */
export const VIDEO_MAX_BYTES = 50 * 1024 * 1024 * 1024;
/** A voice note is buffered whole in memory, so it keeps the old cap. */
const AUDIO_NOTE_MAX_BYTES = 25 * 1024 * 1024;
/** One part of a chunked upload stays far below Cloudflare's 100 MB request-body limit. */
export const FILE_PART_MAX_BYTES = 64 * 1024 * 1024;
/** A self-contained HTML page a bot attaches (images inlined as data: URIs); shown in a sandboxed frame, never executed in the app's origin. */
export const HTML_MAX_BYTES = 10 * 1024 * 1024;
export function fileMaxBytes(mime: string | undefined): number {
  const value = mime?.split(";")[0]?.trim().toLowerCase();
  if (value === "text/html") return HTML_MAX_BYTES;
  // Only the video types we know get the video ceiling; any other file, whatever it claims to be, is a generic file.
  return value?.startsWith("video/") && value in FILE_MIMES ? VIDEO_MAX_BYTES : FILE_MAX_BYTES;
}

/** Nordus keeps a much larger inbox than upstream's 512 MB: the editors' video work lives here. */
export const DEFAULT_ATTACHMENTS_MAX_BYTES = 100 * 1024 * 1024 * 1024;

/** NORDUS_ATTACHMENTS_MAX_BYTES raises (or lowers) the ceiling in whole bytes; anything that is not a positive integer keeps
 * 100 GiB. Takes the raw value or an environment. */
export function attachmentsMaxBytes(source?: string | NodeJS.ProcessEnv): number {
  const raw = typeof source === "object" && source !== null ? source.NORDUS_ATTACHMENTS_MAX_BYTES : source;
  const value = raw?.trim();
  if (!value || !/^\d+$/.test(value)) return DEFAULT_ATTACHMENTS_MAX_BYTES;
  const bytes = Number(value);
  return Number.isSafeInteger(bytes) && bytes > 0 ? bytes : DEFAULT_ATTACHMENTS_MAX_BYTES;
}

/** Never evict: prompts refer to attachment paths, so at this ceiling a new upload gets an explicit 507. */
export const ATTACHMENTS_MAX_BYTES = attachmentsMaxBytes(process.env.NORDUS_ATTACHMENTS_MAX_BYTES);

function formatStoreLimit(bytes: number): string {
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${Number.isInteger(gb) ? gb : gb.toFixed(1)} GB`;
  const mb = Math.round(bytes / (1024 * 1024));
  return mb >= 1 ? `${mb} MB` : `${bytes} bytes`;
}

/** Cleanup removes only our stale partial files, never a committed attachment a transcript may reference. */
export const ATTACHMENT_PARTIAL_MAX_AGE_MS = 60 * 60 * 1000;

const PARTIAL_NAME = /^\.nordus-upload-[0-9a-f-]+-[0-9a-f-]+\.partial$/i;
const UPLOAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const activePartials = new Set<string>();
const uploadLocks = new Map<string, Promise<void>>();
let reservedAttachmentBytes = 0;
const STREAM_RESERVATION_INCREMENT_BYTES = 1024 * 1024;

/** Cached quota usage (null: rescan needed); single-process state, since one server owns a data dir. */
let committedAttachmentBytes: number | null = null;
// An async link may finish after a scan already counted its file; the version keeps it from counting twice.
let attachmentAccountingVersion = 0;

function invalidateAttachmentAccounting(): void {
  committedAttachmentBytes = null;
  attachmentAccountingVersion += 1;
}

/** No sniffing: a lying mime only changes the filename. */
const IMAGE_MIMES: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
};

/** HTML is accepted only from a bot's attach_file (saveFile's allowHtml), never from a person's upload: it is not in FILE_MIMES. */
const HTML_MIME = "text/html";
const HTML_EXTENSION = ".html";

/** No archives, binaries, HTML (bot-only, see HTML_MIME), SVG or scripts. The claimed mime picks the extension; an attacker's filename never does. */
const FILE_MIMES: Readonly<Record<string, string>> = {
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "video/quicktime": ".mov",
  "audio/opus": ".opus",
  "audio/ogg": ".ogg",
  "audio/mpeg": ".mp3",
  "audio/mp4": ".m4a",
  "audio/x-m4a": ".m4a",
  "audio/aac": ".aac",
  "audio/wav": ".wav",
  "audio/x-wav": ".wav",
  "audio/wave": ".wav",
  "audio/flac": ".flac",
  "audio/x-flac": ".flac",
  "audio/webm": ".webm",
  "text/plain": ".txt",
  "text/markdown": ".md",
  "text/csv": ".csv",
  "text/tab-separated-values": ".tsv",
  "application/json": ".json",
  "application/pdf": ".pdf",
  "application/rtf": ".rtf",
  "text/rtf": ".rtf",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "application/vnd.ms-powerpoint": ".ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
  "application/vnd.oasis.opendocument.text": ".odt",
  "application/vnd.oasis.opendocument.spreadsheet": ".ods",
  "application/vnd.oasis.opendocument.presentation": ".odp",
};

export function extensionForMime(mime: string | undefined): string | null {
  if (!mime) return null;
  return IMAGE_MIMES[mime.split(";")[0]!.trim().toLowerCase()] ?? null;
}

export function ensureAttachmentsDir(): void {
  mkdirSync(ATTACHMENTS_DIR, { recursive: true, mode: 0o700 });
}

export function validateAttachmentUploadId(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (!UPLOAD_ID.test(normalized)) {
    throw statusError(400, "uploadId must be a UUID");
  }
  return normalized;
}

function scanAttachmentUsageAndCleanup(now = Date.now()): { bytes: number; removed: number } {
  ensureAttachmentsDir();
  let bytes = 0;
  let removed = 0;
  for (const entry of readdirSync(ATTACHMENTS_DIR, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(ATTACHMENTS_DIR, entry.name);
    // A live partial is counted by its reservation; a crashed process's orphan counts until this scan removes it.
    if (PARTIAL_NAME.test(entry.name) && activePartials.has(path)) continue;
    try {
      const stat = statSync(path);
      if (PARTIAL_NAME.test(entry.name) && now - stat.mtimeMs >= ATTACHMENT_PARTIAL_MAX_AGE_MS) {
        unlinkSync(path);
        removed += 1;
      } else {
        bytes += stat.size;
      }
    } catch {
    }
  }
  return { bytes, removed };
}

/** Reservations must use this rather than trust a cold cache. */
function committedBytes(): number {
  if (committedAttachmentBytes === null) {
    committedAttachmentBytes = scanAttachmentUsageAndCleanup().bytes;
    attachmentAccountingVersion += 1;
  }
  return committedAttachmentBytes;
}

/** Never for idempotent retries, which reuse bytes already counted; after an accounting change the next reservation rescans. */
function addCommittedBytes(delta: number, version = attachmentAccountingVersion): void {
  if (version !== attachmentAccountingVersion || committedAttachmentBytes === null) {
    invalidateAttachmentAccounting();
    return;
  }
  committedAttachmentBytes += delta;
}

export function cleanupStaleAttachmentPartials(now = Date.now()): number {
  const { bytes, removed } = scanAttachmentUsageAndCleanup(now);
  committedAttachmentBytes = bytes;
  attachmentAccountingVersion += 1;
  return removed;
}

/** Every removal of a file saveImage/saveFile created must come through here, or the cache overcounts and rejects uploads. */
export function deleteAttachment(path: string): void {
  try {
    const size = committedAttachmentBytes !== null ? statSync(path).size : 0;
    unlinkSync(path);
    if (committedAttachmentBytes !== null) {
      committedAttachmentBytes = Math.max(0, committedAttachmentBytes - size);
    }
  } catch {
  }
}

export function __resetAttachmentAccountingForTests(): void {
  invalidateAttachmentAccounting();
}

/** Holding the upload id's lock, any inactive partial with its prefix is a crashed attempt and can go now. */
function cleanupAttachmentPartialsForUpload(uploadId: string): void {
  ensureAttachmentsDir();
  const prefix = `.nordus-upload-${uploadId}-`;
  for (const entry of readdirSync(ATTACHMENTS_DIR, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.startsWith(prefix) || !PARTIAL_NAME.test(entry.name)) continue;
    const path = join(ATTACHMENTS_DIR, entry.name);
    if (activePartials.has(path)) continue;
    try {
      const size = committedAttachmentBytes !== null ? statSync(path).size : 0;
      unlinkSync(path);
      if (committedAttachmentBytes !== null) {
        committedAttachmentBytes = Math.max(0, committedAttachmentBytes - size);
      }
    } catch {
    }
  }
}

class AttachmentReservation {
  private held = 0;
  private released = false;
  private readonly perFileLimit: number;
  constructor(perFileLimit = FILE_MAX_BYTES) {
    this.perFileLimit = perFileLimit;
  }

  reserve(bytes: number): void {
    if (this.released || bytes <= 0) return;
    this.reserveAtLeast(bytes, bytes);
  }

  private reserveAtLeast(required: number, preferred: number): void {
    let used = committedBytes();
    let available = ATTACHMENTS_MAX_BYTES - used - reservedAttachmentBytes;
    // Files removed outside the server (nightly cleanup) leave the cache overcounting: rescan once before refusing.
    if (available < required) {
      invalidateAttachmentAccounting();
      used = committedBytes();
      available = ATTACHMENTS_MAX_BYTES - used - reservedAttachmentBytes;
    }
    if (available < required) {
      throw statusError(
        507,
        `attachments storage is full (${formatStoreLimit(ATTACHMENTS_MAX_BYTES)} limit)`,
      );
    }
    const granted = Math.min(preferred, available);
    reservedAttachmentBytes += granted;
    this.held += granted;
  }

  ensure(bytes: number): void {
    if (bytes <= this.held) return;
    const required = bytes - this.held;
    const remainingPerFileCapacity = this.perFileLimit - this.held;
    const preferred = Math.min(
      Math.max(required, STREAM_RESERVATION_INCREMENT_BYTES),
      remainingPerFileCapacity,
    );
    this.reserveAtLeast(required, preferred);
  }

  release(): void {
    if (this.released) return;
    this.released = true;
    reservedAttachmentBytes -= this.held;
    this.held = 0;
  }
}

async function withUploadLock<T>(uploadId: string | undefined, operation: () => Promise<T>): Promise<T> {
  if (!uploadId) return operation();
  const previous = uploadLocks.get(uploadId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  uploadLocks.set(uploadId, current);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (uploadLocks.get(uploadId) === current) uploadLocks.delete(uploadId);
  }
}

/** saveFile/saveImage only ever write `${uuid}${extension}` (an image may add `-w<width>h<height>`) with one of these extensions. */
const KNOWN_ATTACHMENT_EXTENSIONS = Array.from(
  new Set([...Object.values(IMAGE_MIMES), ...Object.values(FILE_MIMES), HTML_EXTENSION]),
);

function statSizeIfFile(path: string): number | null {
  try {
    const stat = statSync(path);
    return stat.isFile() ? stat.size : null;
  } catch {
    return null;
  }
}

/** Where a sized image records the name it was saved under, so a retry with other bytes still finds its uploadId. */
function uploadNameMarker(uploadId: string): string {
  return join(ATTACHMENTS_DIR, `.nordus-upload-${uploadId}.name`);
}

function markedUploadPath(uploadId: string): string | null {
  try {
    const name = readFileSync(uploadNameMarker(uploadId), "utf8").trim();
    if (!name.startsWith(uploadId) || !/^[A-Za-z0-9-]+\.[a-z0-9]+$/.test(name)) return null;
    const path = join(ATTACHMENTS_DIR, name);
    return statSizeIfFile(path) === null ? null : path;
  } catch {
    return null;
  }
}

/** An image's name may carry its size after the UUID: the marker finds it whatever the new bytes measure. */
function committedPathForUpload(uploadId: string, extension: string, sizeSuffix = ""): string | null {
  ensureAttachmentsDir();
  const marked = markedUploadPath(uploadId);
  if (marked) {
    if (extname(marked) !== extension) throw statusError(409, "uploadId was already used for another content type");
    return marked;
  }
  const names = (ext: string) => (sizeSuffix ? [`${uploadId}${sizeSuffix}${ext}`, `${uploadId}${ext}`] : [`${uploadId}${ext}`]);
  const exact = names(extension).map((name) => join(ATTACHMENTS_DIR, name)).find((path) => statSizeIfFile(path) !== null);
  if (exact) return exact;
  for (const other of KNOWN_ATTACHMENT_EXTENSIONS) {
    if (other === extension) continue;
    if (names(other).some((name) => statSizeIfFile(join(ATTACHMENTS_DIR, name)) !== null)) {
      throw statusError(409, "uploadId was already used for another content type");
    }
  }
  return null;
}

async function digestFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export interface SavedAttachment {
  path: string;
  mime: string;
  bytes: number;
}

export interface SavedFile extends SavedAttachment {
  name: string;
}

function statusError(status: number, message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

function normalizedMime(mime: string | undefined): string | null {
  const value = mime?.split(";")[0]?.trim().toLowerCase();
  return value || null;
}

export function extensionForFileMime(mime: string | undefined, options: { allowHtml?: boolean } = {}): string | null {
  const value = normalizedMime(mime);
  if (value === HTML_MIME) return options.allowHtml ? HTML_EXTENSION : null;
  return value ? FILE_MIMES[value] ?? null : null;
}

/** Any file that is not a known type is kept as a generic file: the browser never renders it (see genericExtensionForName). */
export const GENERIC_FILE_MIME = "application/octet-stream";

/**
 * Extensions a browser could run or render on our origin (and the image ones we serve by extension). A generic upload with one
 * of them is stored as `.bin`: the original name is kept for display and download, never for the stored filename.
 */
const UNSAFE_GENERIC_EXTENSIONS: ReadonlySet<string> = new Set([
  "html", "htm", "xhtml", "xht", "shtml", "svg", "svgz", "xml", "xsl", "xslt", "js", "mjs", "cjs", "mht", "mhtml", "hta", "swf",
  "png", "jpg", "jpeg", "gif", "webp",
]);

/** The stored extension of a generic file comes from its name: lowercase [a-z0-9], up to 10 characters, else `.bin`. */
export function genericExtensionForName(name: string): string {
  const normalized = name.normalize("NFKC").trim();
  const dot = normalized.lastIndexOf(".");
  if (dot <= 0) return ".bin";
  const ext = normalized.slice(dot + 1).toLowerCase();
  if (!/^[a-z0-9]{1,10}$/.test(ext) || UNSAFE_GENERIC_EXTENSIONS.has(ext)) return ".bin";
  return `.${ext}`;
}

interface FileTarget {
  extension: string;
  /** The mime stored and reported: the claimed one for a known type, application/octet-stream for a generic file. */
  mime: string;
  generic: boolean;
}

function fileTarget(name: string, mime: string | undefined, options: { allowHtml?: boolean } = {}): FileTarget {
  const normalized = normalizedMime(mime);
  const known = extensionForFileMime(normalized ?? undefined, options);
  if (known) return { extension: known, mime: normalized!, generic: false };
  return { extension: genericExtensionForName(name), mime: GENERIC_FILE_MIME, generic: true };
}

/** Separators and encoded separators are rejected, not massaged, so traversal attempts stay visible as bad requests. */
export function sanitizeSharedFileName(name: string, mime: string, options: { allowHtml?: boolean } = {}): string {
  const extension = extensionForFileMime(mime, options);
  if (!extension) throw statusError(400, "content-type must be a supported document or audio type");
  return sanitizeFileName(name, extension);
}

/** A generic file keeps the extension it came with (display only); a known type gets the one its mime dictates. */
function sanitizeFileName(name: string, extension: string | null): string {

  const normalized = name.normalize("NFKC").trim();
  if (!normalized) throw statusError(400, "name is required");
  if (normalized.length > 512) throw statusError(400, "name is too long");
  if (/[\\/]/.test(normalized) || /%(?:00|2f|5c)/i.test(normalized)) {
    throw statusError(400, "name must be a filename, not a path");
  }

  const dot = normalized.lastIndexOf(".");
  let suffix = extension ?? "";
  if (extension === null) {
    const original = dot > 0 ? normalized.slice(dot) : "";
    suffix = /^\.[A-Za-z0-9_+-]{1,20}$/.test(original) ? original : "";
  }
  const withoutExtension = dot > 0 ? normalized.slice(0, dot) : normalized;
  const safeCharacters = Array.from(withoutExtension, (character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127 || "<>:\"|?*".includes(character) ? "_" : character;
  }).join("");
  const stem = safeCharacters
    .replace(/^\.+/, "")
    .replace(/[.\s]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
  const boundedStem = Array.from(stem).slice(0, 180).join("");
  if (!boundedStem) throw statusError(400, "name must contain visible characters");
  return `${boundedStem}${suffix}`;
}

/** Never buffers the request; a failed, empty or oversized upload leaves no partial file. */
export async function saveFile(
  chunks: AsyncIterable<Uint8Array>,
  originalName: string,
  mime: string,
  options: { uploadId?: string; expectedBytes?: number; allowHtml?: boolean } = {},
): Promise<SavedFile> {
  const target = fileTarget(originalName, mime, { allowHtml: options.allowHtml });
  const { extension } = target;
  const normalized = target.mime;
  const name = sanitizeFileName(originalName, target.generic ? null : extension);
  const uploadId = validateAttachmentUploadId(options.uploadId);
  const expectedBytes = options.expectedBytes;
  const limit = target.generic ? FILE_MAX_BYTES : fileMaxBytes(normalized);
  if (expectedBytes !== undefined && (!Number.isSafeInteger(expectedBytes) || expectedBytes < 0)) {
    throw statusError(400, "content-length must be a non-negative integer");
  }
  if (expectedBytes !== undefined && expectedBytes > limit) {
    throw statusError(413, `file exceeds ${limit} bytes`);
  }

  return withUploadLock(uploadId, async () => {
    ensureAttachmentsDir();
    if (uploadId) cleanupAttachmentPartialsForUpload(uploadId);
    const existing = uploadId ? committedPathForUpload(uploadId, extension) : null;
    if (existing) {
      const incomingHash = createHash("sha256");
      let bytes = 0;
      for await (const value of chunks) {
        const chunk = Buffer.isBuffer(value)
          ? value
          : Buffer.from(value.buffer, value.byteOffset, value.byteLength);
        if (chunk.byteLength === 0) continue;
        if (bytes + chunk.byteLength > limit) {
          throw statusError(413, `file exceeds ${limit} bytes`);
        }
        incomingHash.update(chunk);
        bytes += chunk.byteLength;
      }
      if (bytes === 0) throw statusError(400, "empty file");
      if (statSync(existing).size !== bytes || await digestFile(existing) !== incomingHash.digest("hex")) {
        throw statusError(409, "uploadId was already used for different file bytes");
      }
      return { path: existing, name, mime: normalized, bytes };
    }

    const id = uploadId ?? randomUUID();
    const path = join(ATTACHMENTS_DIR, `${id}${extension}`);
    const partialPath = join(ATTACHMENTS_DIR, `.nordus-upload-${id}-${randomUUID()}.partial`);
    const reservation = new AttachmentReservation(limit);
    if (expectedBytes) reservation.reserve(expectedBytes);
    activePartials.add(partialPath);
    let file: Awaited<ReturnType<typeof open>> | undefined;
    let bytes = 0;
    let closed = false;
    let partialCleanupFailed = false;

    try {
      file = await open(partialPath, "wx", 0o600);
      for await (const value of chunks) {
        const chunk = Buffer.isBuffer(value)
          ? value
          : Buffer.from(value.buffer, value.byteOffset, value.byteLength);
        if (chunk.byteLength === 0) continue;
        if (bytes + chunk.byteLength > limit) {
          throw statusError(413, `file exceeds ${limit} bytes`);
        }
        reservation.ensure(bytes + chunk.byteLength);
        let offset = 0;
        while (offset < chunk.byteLength) {
          const result = await file.write(chunk, offset, chunk.byteLength - offset, null);
          if (result.bytesWritten === 0) throw new Error("file write made no progress");
          offset += result.bytesWritten;
        }
        bytes += chunk.byteLength;
      }
      if (bytes === 0) throw statusError(400, "empty file");
      await file.close();
      closed = true;
      try {
        const accountingVersion = attachmentAccountingVersion;
        await link(partialPath, path);
        addCommittedBytes(bytes, accountingVersion);
        await unlink(partialPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        if (statSync(path).size !== bytes || await digestFile(path) !== await digestFile(partialPath)) {
          throw statusError(409, "uploadId was already used for different file bytes");
        }
        await unlink(partialPath);
      }
      return { path, name, mime: normalized, bytes };
    } catch (error) {
      if (file && !closed) await file.close().catch(() => undefined);
      await unlink(partialPath).catch(() => { partialCleanupFailed = true; });
      throw error;
    } finally {
      activePartials.delete(partialPath);
      // Rescan after releasing a leftover partial, so a retry cannot subtract bytes never counted.
      if (partialCleanupFailed) invalidateAttachmentAccounting();
      reservation.release();
    }
  });
}

/** One tag for every upload id: the chunked partial must match PARTIAL_NAME so the age sweep and the quota scan treat it like any other partial. */
const CHUNK_PARTIAL_TAG = "c0ffee00-0000-4000-8000-000000000000";

function chunkPartialPath(uploadId: string): string {
  return join(ATTACHMENTS_DIR, `.nordus-upload-${uploadId}-${CHUNK_PARTIAL_TAG}.partial`);
}

export interface FilePartResult {
  /** Bytes the server now holds for this upload (the next part must start here). */
  received: number;
  total: number;
}

function receivedError(status: number, message: string, received: number): Error & { status: number; received: number } {
  return Object.assign(statusError(status, message), { received });
}

function asBuffer(value: Uint8Array): Buffer {
  return Buffer.isBuffer(value) ? value : Buffer.from(value.buffer, value.byteOffset, value.byteLength);
}

interface ChunkedTarget {
  uploadId: string;
  name: string;
  normalized: string;
  extension: string;
  limit: number;
  total: number;
}

function chunkedTarget(
  originalName: string,
  mime: string,
  rawUploadId: string | undefined,
  rawTotal: number,
): ChunkedTarget {
  const fileKind = fileTarget(originalName, mime);
  const { extension } = fileKind;
  const normalized = fileKind.mime;
  const name = sanitizeFileName(originalName, fileKind.generic ? null : extension);
  const uploadId = validateAttachmentUploadId(rawUploadId);
  if (!uploadId) throw statusError(400, "uploadId is required");
  if (!Number.isSafeInteger(rawTotal) || rawTotal <= 0) throw statusError(400, "total must be a positive integer");
  const limit = fileKind.generic ? FILE_MAX_BYTES : fileMaxBytes(normalized);
  if (rawTotal > limit) throw statusError(413, `file exceeds ${limit} bytes`);
  return { uploadId, name, normalized, extension, limit, total: rawTotal };
}

/**
 * One part of a file sent in pieces (each below Cloudflare's request-body ceiling). Parts go in order into one partial per
 * uploadId; repeating a part already held must carry the same bytes and changes nothing, a part that skips ahead is refused
 * with the size held so the sender can resume. Nothing is buffered: the part streams to disk.
 */
export async function saveFilePart(
  chunks: AsyncIterable<Uint8Array>,
  originalName: string,
  mime: string,
  options: { uploadId?: string; offset: number; total: number },
): Promise<FilePartResult> {
  const target = chunkedTarget(originalName, mime, options.uploadId, options.total);
  const { uploadId, total, extension } = target;
  const offset = options.offset;
  if (!Number.isSafeInteger(offset) || offset < 0) throw statusError(400, "offset must be a non-negative integer");
  if (offset >= total) throw statusError(400, "offset must be below total");

  return withUploadLock(uploadId, async () => {
    ensureAttachmentsDir();
    const done = committedPathForUpload(uploadId, extension);
    if (done) {
      if (statSync(done).size !== total) throw statusError(409, "uploadId was already used for different file bytes");
      for await (const _ of chunks) void _;
      return { received: total, total };
    }

    const partialPath = chunkPartialPath(uploadId);
    const held = statSizeIfFile(partialPath) ?? 0;
    if (offset > held) {
      for await (const _ of chunks) void _;
      throw receivedError(409, `part starts at ${offset} but ${held} bytes were received`, held);
    }

    committedBytes();
    const accountingVersion = attachmentAccountingVersion;
    const reservation = new AttachmentReservation(FILE_PART_MAX_BYTES);
    let file: Awaited<ReturnType<typeof open>> | undefined;
    let position = offset;
    let appended = 0;
    let truncateTo: number | null = null;
    try {
      file = await open(partialPath, constants.O_RDWR | constants.O_CREAT, 0o600);
      for await (const value of chunks) {
        const chunk = asBuffer(value);
        if (chunk.byteLength === 0) continue;
        if (position - offset + chunk.byteLength > FILE_PART_MAX_BYTES) {
          throw statusError(413, `part exceeds ${FILE_PART_MAX_BYTES} bytes`);
        }
        if (position + chunk.byteLength > total) throw statusError(400, "part runs past total");
        let used = 0;
        // The stretch already held must match what is sent; only the stretch past it is new.
        const known = Math.max(0, Math.min(chunk.byteLength, held - position));
        if (known > 0) {
          const stored = Buffer.alloc(known);
          let read = 0;
          while (read < known) {
            const r = await file.read(stored, read, known - read, position + read);
            if (r.bytesRead === 0) throw receivedError(409, "stored bytes are shorter than expected", held);
            read += r.bytesRead;
          }
          if (!stored.equals(chunk.subarray(0, known))) {
            throw receivedError(409, "part differs from the bytes already received", held);
          }
          used = known;
        }
        const fresh = chunk.byteLength - used;
        if (fresh > 0) {
          truncateTo = held;
          reservation.ensure(appended + fresh);
          let at = 0;
          while (at < fresh) {
            const result = await file.write(chunk, used + at, fresh - at, position + used + at);
            if (result.bytesWritten === 0) throw new Error("file write made no progress");
            at += result.bytesWritten;
          }
          appended += fresh;
        }
        position += chunk.byteLength;
      }
      if (position === offset) throw statusError(400, "empty part");
      await file.close();
      file = undefined;
      if (appended > 0) addCommittedBytes(appended, accountingVersion);
      return { received: held + appended, total };
    } catch (error) {
      if (file) {
        // A part that did not arrive whole leaves the file as it was, so the retry starts from a known size.
        if (truncateTo !== null && appended > 0) await file.truncate(truncateTo).catch(() => invalidateAttachmentAccounting());
        await file.close().catch(() => undefined);
      }
      throw error;
    } finally {
      reservation.release();
    }
  });
}

/** Closes a chunked upload: the partial must hold exactly `total` bytes. Same result as saveFile; repeating it after success returns the same file. */
export async function completeFileParts(
  originalName: string,
  mime: string,
  options: { uploadId?: string; total: number },
): Promise<SavedFile> {
  const target = chunkedTarget(originalName, mime, options.uploadId, options.total);
  const { uploadId, total, extension, name, normalized } = target;
  return withUploadLock(uploadId, async () => {
    ensureAttachmentsDir();
    const existing = committedPathForUpload(uploadId, extension);
    const partialPath = chunkPartialPath(uploadId);
    if (existing) {
      if (statSync(existing).size !== total) throw statusError(409, "uploadId was already used for different file bytes");
      await unlink(partialPath).catch(() => undefined);
      return { path: existing, name, mime: normalized, bytes: total };
    }
    const held = statSizeIfFile(partialPath);
    if (held === null) throw statusError(404, "no upload in progress for this uploadId");
    if (held !== total) throw receivedError(409, `${held} of ${total} bytes were received`, held);
    const path = join(ATTACHMENTS_DIR, `${uploadId}${extension}`);
    try {
      // The partial's bytes were counted part by part, so the link adds nothing to the quota.
      await link(partialPath, path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      throw statusError(409, "uploadId was already used for different file bytes");
    }
    await unlink(partialPath);
    return { path, name, mime: normalized, bytes: total };
  });
}

/**
 * The UUID filename is never attacker-controlled and never collides; the size suffix comes from the header the server read.
 * `avatarOf` names a converted avatar after the stored picture it came from, so visibility rules can tie the two together.
 */
export function saveImage(bytes: Buffer, mime: string, requestedUploadId?: string, avatarOf?: string): SavedAttachment {
  const ext = extensionForMime(mime);
  if (!ext) throw Object.assign(new Error("unsupported image type"), { status: 400 });
  if (bytes.byteLength === 0) throw Object.assign(new Error("empty image"), { status: 400 });
  if (bytes.byteLength > IMAGE_MAX_BYTES) {
    throw Object.assign(new Error(`image exceeds ${IMAGE_MAX_BYTES} bytes`), { status: 413 });
  }
  const uploadId = validateAttachmentUploadId(requestedUploadId);
  ensureAttachmentsDir();
  const sizeSuffix = imageSizeSuffix(readImageSize(bytes));
  const existing = uploadId ? committedPathForUpload(uploadId, ext, sizeSuffix) : null;
  if (existing) {
    const saved = readFileSync(existing);
    if (!saved.equals(bytes)) {
      throw statusError(409, "uploadId was already used for different image bytes");
    }
    return { path: existing, mime: mime.split(";")[0]!.trim().toLowerCase(), bytes: bytes.byteLength };
  }

  const reservation = new AttachmentReservation();
  reservation.reserve(bytes.byteLength);
  const id = uploadId ?? randomUUID();
  const name = avatarOf ? `${avatarOf}-av${sizeSuffix}${ext}` : `${id}${sizeSuffix}${ext}`;
  const path = join(ATTACHMENTS_DIR, name);
  const partialPath = join(ATTACHMENTS_DIR, `.nordus-upload-${id}-${randomUUID()}.partial`);
  activePartials.add(partialPath);
  let partialCleanupFailed = false;
  try {
    writeFileSync(partialPath, bytes, { mode: 0o600, flag: "wx" });
    try {
      linkSync(partialPath, path);
      addCommittedBytes(bytes.byteLength);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const saved = readFileSync(path);
      if (!saved.equals(bytes)) {
        throw statusError(409, "uploadId was already used for different image bytes");
      }
    }
    unlinkSync(partialPath);
    if (uploadId && sizeSuffix) writeFileSync(uploadNameMarker(uploadId), name, { mode: 0o600 });
    return { path, mime: mime.split(";")[0]!.trim().toLowerCase(), bytes: bytes.byteLength };
  } catch (error) {
    try {
      unlinkSync(partialPath);
    } catch {
      partialCleanupFailed = true;
    }
    throw error;
  } finally {
    activePartials.delete(partialPath);
    if (partialCleanupFailed) invalidateAttachmentAccounting();
    reservation.release();
  }
}

/** Cloud voices answer in MP3; the built-in Mac voices (`say`) and Chatterbox answer in WAV. */
const AUDIO_MIMES: Readonly<Record<string, { mime: string; ext: string }>> = {
  "audio/mpeg": { mime: "audio/mpeg", ext: ".mp3" },
  "audio/wav": { mime: "audio/wav", ext: ".wav" },
  "audio/x-wav": { mime: "audio/wav", ext: ".wav" },
  "audio/wave": { mime: "audio/wav", ext: ".wav" },
  "audio/webm": { mime: "audio/webm", ext: ".webm" },
  "audio/ogg": { mime: "audio/ogg", ext: ".ogg" },
  "audio/mp4": { mime: "audio/mp4", ext: ".m4a" },
};

export function saveAudio(bytes: Buffer, mime: string): SavedAttachment {
  const format = AUDIO_MIMES[mime.split(";")[0]!.trim().toLowerCase()];
  if (!format) {
    throw Object.assign(new Error("unsupported audio type"), { status: 400 });
  }
  if (bytes.byteLength === 0) throw Object.assign(new Error("empty audio"), { status: 400 });
  if (bytes.byteLength > AUDIO_NOTE_MAX_BYTES) {
    throw Object.assign(new Error(`audio exceeds ${AUDIO_NOTE_MAX_BYTES} bytes`), { status: 413 });
  }
  ensureAttachmentsDir();
  const reservation = new AttachmentReservation();
  reservation.reserve(bytes.byteLength);
  const id = randomUUID();
  const name = `${id}${format.ext}`;
  const path = join(ATTACHMENTS_DIR, name);
  const partialPath = join(ATTACHMENTS_DIR, `.nordus-upload-${id}-${randomUUID()}.partial`);
  activePartials.add(partialPath);
  let partialCleanupFailed = false;
  try {
    writeFileSync(partialPath, bytes, { mode: 0o600, flag: "wx" });
    try {
      linkSync(partialPath, path);
      addCommittedBytes(bytes.byteLength);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const saved = readFileSync(path);
      if (!saved.equals(bytes)) {
        throw Object.assign(new Error("audio destination already exists with different bytes"), { status: 409 });
      }
    }
    unlinkSync(partialPath);
    return { path, mime: format.mime, bytes: bytes.byteLength };
  } catch (error) {
    try {
      unlinkSync(partialPath);
    } catch {
      partialCleanupFailed = true;
    }
    throw error;
  } finally {
    activePartials.delete(partialPath);
    if (partialCleanupFailed) invalidateAttachmentAccounting();
    reservation.release();
  }
}

/** Takes the per-id lock, so an image and a document with one caller-supplied UUID cannot commit with different extensions. */
export async function saveImageUpload(
  bytes: Buffer,
  mime: string,
  requestedUploadId?: string,
): Promise<SavedAttachment> {
  const uploadId = validateAttachmentUploadId(requestedUploadId);
  return withUploadLock(uploadId, async () => {
    if (uploadId) cleanupAttachmentPartialsForUpload(uploadId);
    return saveImage(bytes, mime, uploadId);
  });
}

export function attachmentExists(name: string): boolean {
  if (!/^[A-Za-z0-9-]+\.(png|jpg|gif|webp)$/.test(name)) return false;
  try {
    return statSync(join(ATTACHMENTS_DIR, name)).isFile();
  } catch {
    return false;
  }
}

/** Only a bare filename inside ATTACHMENTS_DIR resolves: the route must never become a file server for the data dir. */
export function readAttachment(name: string): { bytes: Buffer; mime: string } | null {
  if (!/^[A-Za-z0-9-]+\.(png|jpg|jpeg|gif|webp|mp3|wav|webm|ogg|m4a)$/.test(name)) return null;
  const path = join(ATTACHMENTS_DIR, name);
  if (extname(path) === ".jpeg") return null;
  try {
    return { bytes: readFileSync(path), mime: mimeForExt(extname(path)) };
  } catch {
    return null;
  }
}

function mimeForExt(ext: string): string {
  switch (ext) {
    case ".png":
      return "image/png";
    case ".jpg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".mp3":
      return "audio/mpeg";
    case ".wav":
      return "audio/wav";
    case ".webm":
      return "audio/webm";
    case ".ogg":
      return "audio/ogg";
    case ".m4a":
      return "audio/mp4";
    default:
      return "application/octet-stream";
  }
}

/** `none`: answer as if no Range header (absent, malformed, non-bytes, multi-range); `unsatisfiable`: a start at or past EOF, answered 416. */
export type AudioRange =
  | { kind: "none" }
  | { kind: "unsatisfiable" }
  | { kind: "range"; start: number; end: number };

/** Honours only `a-b`, `a-` and `-n`; anything else gets the whole file, always a correct answer to a GET. */
export function parseByteRange(header: string | undefined, size: number): AudioRange {
  const raw = header?.trim();
  if (!raw) return { kind: "none" };
  const m = raw.match(/^bytes=(\d*)-(\d*)$/);
  if (!m) return { kind: "none" };
  const [, rawStart, rawEnd] = m;
  if (rawStart === "") {
    // `bytes=-` is malformed, not a suffix range; `bytes=-0` is unsatisfiable per RFC 9110.
    if (rawEnd === "") return { kind: "none" };
    const suffix = Number(rawEnd);
    if (!suffix) return { kind: "unsatisfiable" };
    if (size === 0) return { kind: "unsatisfiable" };
    return { kind: "range", start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(rawStart);
  if (start >= size) return { kind: "unsatisfiable" };
  if (rawEnd === "") return { kind: "range", start, end: size - 1 };
  const end = Number(rawEnd);
  if (end < start) return { kind: "none" };
  return { kind: "range", start, end: Math.min(end, size - 1) };
}
