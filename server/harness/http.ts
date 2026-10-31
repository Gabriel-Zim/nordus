import type { IncomingMessage, ServerResponse } from "node:http";
import { brotliCompressSync, constants as zlibConstants, gzipSync } from "node:zlib";

import { sendTunnelJson } from "./tunnel-gzip.ts";

export { gzipTunnelReplies } from "./tunnel-gzip.ts";

const compressedReplies = new WeakSet<ServerResponse>();

/** Wraps the main listener's request handler: only replies it carries are brotli/gzip-compressed by `json` (the Nordus
 *  server sits behind a proxy that does not encode). The tunnel listener has its own gzip (`gzipTunnelReplies`), and a
 *  listener nobody wrapped never compresses. */
export function compressReplies<T>(handle: (req: IncomingMessage, res: ServerResponse) => T) {
  return (req: IncomingMessage, res: ServerResponse): T => {
    compressedReplies.add(res);
    return handle(req, res);
  };
}

const jsonHooks = new WeakMap<ServerResponse, (body: unknown) => unknown>();
const parsedBodies = new WeakMap<IncomingMessage, unknown>();

/** Every JSON body sent on this response passes through `hook` (it may return a narrowed copy); later hooks run after earlier ones. */
export function onJsonBody(res: ServerResponse, hook: (body: unknown) => unknown): void {
  const previous = jsonHooks.get(res);
  jsonHooks.set(res, previous ? (body) => hook(previous(body)) : hook);
}

export function parsedBodyOf(req: IncomingMessage): unknown {
  return parsedBodies.get(req);
}

/** Bodies below this go out as they are: compressing them costs more than it saves. */
const COMPRESS_MIN_BYTES = 1_024;

/** Brotli or gzip when the client asks for it. The robot list is hundreds of KB of JSON and crosses an ocean;
 *  compressed it is a fifth of that. Only JSON goes through here, never the event stream. */
function compressedFor(res: ServerResponse, data: string): { body: Buffer; encoding: "br" | "gzip" } | null {
  if (!compressedReplies.has(res)) return null;
  const raw = Buffer.from(data);
  if (raw.length < COMPRESS_MIN_BYTES) return null;
  const accepted = String((res as ServerResponse & { req?: IncomingMessage }).req?.headers["accept-encoding"] ?? "").toLowerCase();
  const wants = (name: string) => accepted.split(",").some((part) => {
    const [token, ...params] = part.trim().split(";");
    return token === name && !params.some((param) => /^\s*q=0(\.0*)?\s*$/.test(param));
  });
  try {
    if (wants("br")) return { body: brotliCompressSync(raw, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 4, [zlibConstants.BROTLI_PARAM_SIZE_HINT]: raw.length } }), encoding: "br" };
    if (wants("gzip")) return { body: gzipSync(raw, { level: 6 }), encoding: "gzip" };
  } catch { /* send it plain */ }
  return null;
}

export function json(res: ServerResponse, status: number, body: unknown) {
  const hook = jsonHooks.get(res);
  const data = JSON.stringify(hook ? hook(body) : body);
  const headers = { "content-type": "application/json" };
  if (sendTunnelJson(res, status, headers, data)) return;
  const compressed = compressedFor(res, data);
  if (compressed) {
    res.writeHead(status, { ...headers, "content-encoding": compressed.encoding, vary: "accept-encoding" });
    res.end(compressed.body);
    return;
  }
  res.writeHead(status, headers);
  res.end(data);
}

export function readBody(req: IncomingMessage, limit = 1_000_000): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let done = false;
    const fail = (status: number, msg: string) => {
      if (done) return;
      done = true;
      const err = Object.assign(new Error(msg), { status });
      reject(err);
    };
    req.on("data", (c) => {
      if (done) return;
      bytes += typeof c === "string" ? Buffer.byteLength(c) : c.length;
      if (bytes > limit) {
        // Keep draining but stop retaining attacker-controlled bytes; destroying the request would lose the 413.
        return fail(413, "body too large");
      }
      chunks.push(typeof c === "string" ? Buffer.from(c) : c);
    });
    req.on("end", () => {
      if (done) return;
      // Decode once: a character split across two chunks turns into U+FFFD when each is decoded alone.
      const data = Buffer.concat(chunks).toString("utf8");
      let body: any;
      try {
        body = data ? JSON.parse(data) : {};
      } catch {
        return fail(400, "invalid JSON body");
      }
      done = true;
      parsedBodies.set(req, body);
      resolve(body);
    });
    req.on("error", (e) => fail(400, e instanceof Error ? e.message : String(e)));
  });
}
