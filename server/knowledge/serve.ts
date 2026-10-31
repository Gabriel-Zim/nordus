import { createReadStream } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";

import { parseByteRange } from "../attachments.ts";
import { downloadHeaders, previewPlan } from "./content-types.ts";
import type { OpenedFile } from "./drive-api.ts";

function headerOf(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function matches(header: string | undefined, etag: string): boolean {
  return header !== undefined && header.split(",").some((candidate) => {
    const trimmed = candidate.trim();
    return trimmed === "*" || trimmed === etag || trimmed === `W/${etag}`;
  });
}

/** The ETag is the content's own hash and the browser revalidates every time, so who may see the file is checked on every request. */
export function serveStored(req: IncomingMessage, res: ServerResponse, opened: OpenedFile, mode: "download" | "preview"): boolean {
  const etag = `"${opened.version.sha256}"`;
  let headers: Record<string, string>;
  let limit = opened.size;
  let ranged = true;
  if (mode === "download") headers = downloadHeaders(opened.name, opened.size);
  else {
    const plan = previewPlan(opened.name, opened.size);
    if (!plan) return false;
    headers = plan.headers;
    if (plan.maxBytes !== null) {
      limit = Math.min(opened.size, plan.maxBytes);
      ranged = false;
    }
  }
  headers.etag = etag;
  if (matches(headerOf(req, "if-none-match"), etag)) {
    res.writeHead(304, Object.fromEntries(Object.entries(headers).filter(([name]) => name !== "content-length")));
    res.end();
    return true;
  }
  const ifRange = headerOf(req, "if-range")?.trim();
  const range = !ranged || (ifRange && ifRange !== etag) ? ({ kind: "none" } as const) : parseByteRange(headerOf(req, "range"), limit);
  if (range.kind === "unsatisfiable") {
    res.writeHead(416, { ...headers, "content-range": `bytes */${limit}` });
    res.end();
    return true;
  }
  const [start, end] = range.kind === "range" ? [range.start, range.end] : [0, limit - 1];
  if (range.kind === "range") res.writeHead(206, { ...headers, "content-length": String(end - start + 1), "content-range": `bytes ${start}-${end}/${limit}` });
  else res.writeHead(200, { ...headers, "content-length": String(limit) });
  if (limit === 0 || req.method === "HEAD") {
    res.end();
    return true;
  }
  const stream = createReadStream(opened.file, { start, end });
  stream.on("error", () => res.destroy());
  res.on("close", () => stream.destroy());
  stream.pipe(res);
  return true;
}
