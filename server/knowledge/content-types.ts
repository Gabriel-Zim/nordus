import { extensionOf } from "../../shared/knowledge-path.ts";
import { previewKindFor, TEXT_PREVIEW_MAX_BYTES, type PreviewKind } from "../../shared/knowledge.ts";
import { messageFileDisposition } from "../message-file.ts";

const MIME: Readonly<Record<string, string>> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", bmp: "image/bmp", heic: "image/heic",
  pdf: "application/pdf", rtf: "application/rtf",
  md: "text/markdown", markdown: "text/markdown", txt: "text/plain", log: "text/plain", csv: "text/csv", tsv: "text/tab-separated-values",
  json: "application/json", yaml: "text/yaml", yml: "text/yaml", xml: "application/xml", html: "text/html", htm: "text/html",
  js: "text/javascript", mjs: "text/javascript", ts: "text/plain", tsx: "text/plain", jsx: "text/plain", css: "text/css", py: "text/plain", sh: "text/plain",
  sql: "text/plain", ini: "text/plain", toml: "text/plain", diff: "text/plain", patch: "text/plain",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odt: "application/vnd.oasis.opendocument.text", ods: "application/vnd.oasis.opendocument.spreadsheet", odp: "application/vnd.oasis.opendocument.presentation",
  mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", wav: "audio/wav", ogg: "audio/ogg", opus: "audio/opus", flac: "audio/flac",
  mp4: "video/mp4", m4v: "video/x-m4v", webm: "video/webm", mov: "video/quicktime",
  zip: "application/zip",
};

const ACTIVE = new Set(["html", "htm", "xhtml", "svg", "svgz", "xml", "xsl", "xslt", "js", "mjs", "cjs", "mht", "mhtml", "hta", "swf"]);

export function mimeForName(name: string): string {
  return MIME[extensionOf(name)] ?? "application/octet-stream";
}

const COMMON_HEADERS = {
  "x-content-type-options": "nosniff",
  "cache-control": "private, no-cache",
  "cdn-cache-control": "no-store",
  "cloudflare-cdn-cache-control": "no-store",
  "cross-origin-resource-policy": "same-origin",
  "referrer-policy": "no-referrer",
  vary: "Authorization, Cookie",
} as const;

/** A download never runs: scripts, pages and vector images are handed over as opaque bytes, inside a sandbox. */
export function downloadHeaders(name: string, size: number): Record<string, string> {
  const extension = extensionOf(name);
  const type = ACTIVE.has(extension) ? "application/octet-stream" : mimeForName(name);
  return {
    ...COMMON_HEADERS,
    "content-type": type,
    "content-length": String(size),
    "content-disposition": messageFileDisposition(name),
    "content-security-policy": "sandbox",
    "accept-ranges": "bytes",
  };
}

export interface PreviewPlan {
  kind: PreviewKind;
  headers: Record<string, string>;
  maxBytes: number | null;
}

export const CSV_PREVIEW_MAX_BYTES = 10 * 1024 * 1024;

/** Only kinds with a safe inline form get one; html and svg are shown as their source text, never rendered. */
export function previewPlan(name: string, size: number): PreviewPlan | null {
  const kind = previewKindFor(name);
  const disposition = messageFileDisposition(name, "inline");
  switch (kind) {
    case "image": {
      const type = mimeForName(name);
      if (type === "image/svg+xml" || !type.startsWith("image/")) return null;
      return { kind, maxBytes: null, headers: { ...COMMON_HEADERS, "content-type": type, "content-length": String(size), "content-disposition": disposition, "content-security-policy": "sandbox" } };
    }
    case "pdf":
      return { kind, maxBytes: null, headers: { ...COMMON_HEADERS, "content-type": "application/pdf", "content-length": String(size), "content-disposition": disposition } };
    case "audio":
    case "video":
      return { kind, maxBytes: null, headers: { ...COMMON_HEADERS, "content-type": mimeForName(name), "content-length": String(size), "content-disposition": disposition, "content-security-policy": "sandbox", "accept-ranges": "bytes" } };
    case "markdown":
    case "text":
    case "csv": {
      const maxBytes = kind === "csv" ? CSV_PREVIEW_MAX_BYTES : TEXT_PREVIEW_MAX_BYTES;
      const sent = Math.min(size, maxBytes);
      return {
        kind,
        maxBytes,
        headers: {
          ...COMMON_HEADERS,
          "content-type": "text/plain; charset=utf-8",
          "content-length": String(sent),
          "content-disposition": disposition,
          "content-security-policy": "sandbox",
          ...(size > maxBytes ? { "x-knowledge-truncated": "1" } : {}),
        },
      };
    }
    case "none":
      return null;
  }
}
