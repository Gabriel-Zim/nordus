import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { brotliCompress, constants, gzip } from "node:zlib";
import { promisify } from "node:util";

const brotli = promisify(brotliCompress);
const gzipAsync = promisify(gzip);

const COMPRESS_MIN_BYTES = 1_024;
const CACHE_MAX_BYTES = 64 * 1024 * 1024;
const COMPRESSIBLE = /^(?:text\/|application\/json|application\/manifest\+json|image\/svg\+xml)/;

type Encoding = "br" | "gzip";
interface Packed { etag: string; body: Buffer }

const packed = new Map<string, Packed>();
const packing = new Map<string, Promise<Packed>>();
let packedBytes = 0;

export function chooseEncoding(acceptEncoding: string | undefined): Encoding | null {
  if (!acceptEncoding) return null;
  const accepted = new Set(acceptEncoding.split(",").map((part) => part.trim().toLowerCase()).filter((part) => !/;\s*q=0(?:\.0+)?$/.test(part)).map((part) => part.split(";")[0]));
  return accepted.has("br") ? "br" : accepted.has("gzip") ? "gzip" : null;
}

function remember(key: string, entry: Packed): void {
  const previous = packed.get(key);
  if (previous) packedBytes -= previous.body.length;
  packed.delete(key);
  packed.set(key, entry);
  packedBytes += entry.body.length;
  for (const [oldest, old] of packed) {
    if (packedBytes <= CACHE_MAX_BYTES) break;
    packed.delete(oldest);
    packedBytes -= old.body.length;
  }
}

async function packedFor(file: string, encoding: Encoding, etag: string): Promise<Packed> {
  const key = `${encoding}:${file}`;
  const kept = packed.get(key);
  if (kept?.etag === etag) {
    packed.delete(key);
    packed.set(key, kept);
    return kept;
  }
  const running = packing.get(key);
  if (running) return running;
  const job = (async () => {
    const raw = await readFile(file);
    const body = encoding === "br"
      ? await brotli(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 9, [constants.BROTLI_PARAM_SIZE_HINT]: raw.length } })
      : await gzipAsync(raw, { level: 9 });
    const entry = { etag, body };
    remember(key, entry);
    return entry;
  })().finally(() => packing.delete(key));
  packing.set(key, job);
  return job;
}

/** Hashed build output never changes; the page and the files that steer updates always revalidate; the rest (brand, icons) may be an hour old. */
export function staticCachePolicy(path: string, type: string): string {
  if (type === "text/html" || path === "/sw.js" || path === "/ui-manifest.json") return "no-cache";
  return path.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "public, max-age=3600, stale-while-revalidate=86400";
}

export interface StaticFile { file: string; size: number; mtimeMs: number; type: string; headers: Record<string, string> }

/** The validator changes with the file, so a revalidation costs a 304 and a deploy never serves a stale copy. */
export async function sendStaticFile(req: IncomingMessage, res: ServerResponse, entry: StaticFile): Promise<void> {
  const etag = `W/"${entry.size.toString(16)}-${Math.floor(entry.mtimeMs).toString(16)}"`;
  const headers = { ...entry.headers, etag, vary: "accept-encoding" };
  if (req.headers["if-none-match"] === etag) {
    res.writeHead(304, headers);
    res.end();
    return;
  }
  const encoding = entry.size >= COMPRESS_MIN_BYTES && COMPRESSIBLE.test(entry.type) ? chooseEncoding(req.headers["accept-encoding"]) : null;
  try {
    const body = encoding ? (await packedFor(entry.file, encoding, etag)).body : await readFile(entry.file);
    res.writeHead(200, { "content-type": entry.type, ...headers, ...(encoding ? { "content-encoding": encoding } : {}), "content-length": body.length });
    res.end(req.method === "HEAD" ? undefined : body);
  } catch {
    if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
    res.end("Static file could not be read");
  }
}
