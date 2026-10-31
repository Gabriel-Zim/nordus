import type {
  DriveFileItem,
  DriveListing,
  DriveSaveResult,
  DriveSpaces,
  DriveTrashItem,
  DriveUploadResult,
  DriveVersionItem,
  KnowledgeSpaceId,
  WikiGraph,
  WikiImportLimits,
  WikiImportSummary,
  WikiListing,
  WikiPageDetail,
  WikiSaveResult,
  WikiTrashItem,
  WikiVersionItem,
  WireKnowledgeSpace,
} from "../../shared/knowledge";
import { api, ApiError } from "@/state/api";

const enc = encodeURIComponent;

function query(params: Record<string, string | number | undefined | null>): string {
  const parts = Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== "");
  return parts.length === 0 ? "" : `?${parts.map(([name, value]) => `${name}=${enc(String(value))}`).join("&")}`;
}

const post = <T>(path: string, body: unknown) => api<T>(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export const driveApi = {
  access: () => api<DriveSpaces>("/api/drive/spaces"),
  internalPeople: () => api<{ people: string[] }>("/api/drive/internal-people").then((reply) => reply.people),
  setInternalPeople: (people: readonly string[]) =>
    api<{ people: string[] }>("/api/drive/internal-people", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ people }) }).then((reply) => reply.people),
  list: (space: KnowledgeSpaceId, path: string) => api<DriveListing>(`/api/drive/list${query({ space, path })}`),
  search: (space: KnowledgeSpaceId, q: string) => api<{ files: DriveFileItem[] }>(`/api/drive/search${query({ space, q })}`).then((reply) => reply.files),
  info: (space: KnowledgeSpaceId, path: string) => api<{ file: DriveFileItem; versions: DriveVersionItem[] }>(`/api/drive/info${query({ space, path })}`),
  createFolder: (space: KnowledgeSpaceId, path: string) => post<{ path: string; created: boolean }>("/api/drive/folder", { space, path }),
  restore: (space: KnowledgeSpaceId, path: string, version: number) => post<DriveSaveResult>("/api/drive/restore", { space, path, version }),
  move: (space: KnowledgeSpaceId, from: string, to: string) => post<{ from: string; to: string; moved: number }>("/api/drive/move", { space, from, to }),
  remove: (space: KnowledgeSpaceId, path: string) => api<{ trashed: number }>(`/api/drive/file${query({ space, path })}`, { method: "DELETE" }),
  trash: (space: KnowledgeSpaceId) => api<{ items: DriveTrashItem[] }>(`/api/drive/trash${query({ space })}`).then((reply) => reply.items),
  restoreFromTrash: (space: KnowledgeSpaceId, id: string) => post<{ file: DriveFileItem }>("/api/drive/trash/restore", { space, id }),
  downloadUrl: (space: KnowledgeSpaceId, path: string, version?: number) => `/api/drive/download${query({ space, path, version })}`,
  previewUrl: (space: KnowledgeSpaceId, path: string, version?: number) => `/api/drive/preview${query({ space, path, version })}`,
};

export interface UploadOptions {
  note?: string;
  signal?: AbortSignal;
  onProgress?: (fraction: number) => void;
}

/** A space the person is looking at, or a conversation, which leaves the choice of space to the server. */
export type UploadTarget = { space: KnowledgeSpaceId } | { conversation: string };

/** Sends the file's bytes as they are; XMLHttpRequest is the one browser API that reports how much has gone out. */
export function uploadToDrive(target: UploadTarget, path: string, body: Blob, options: UploadOptions = {}): Promise<DriveUploadResult> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", `/api/drive/file${query({ ...target, path, note: options.note })}`);
    request.responseType = "text";
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) options.onProgress?.(Math.min(0.99, event.loaded / event.total));
    };
    const fail = (status: number, text: string) => {
      let parsed: Record<string, unknown> = {};
      try { parsed = JSON.parse(text) as Record<string, unknown>; } catch { /* the server answered with something that is not JSON */ }
      reject(new ApiError(typeof parsed.error === "string" ? parsed.error : `${status}`, status, parsed));
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        options.onProgress?.(1);
        try { resolve(JSON.parse(request.responseText) as DriveUploadResult); } catch { fail(request.status, request.responseText); }
      } else fail(request.status, request.responseText);
    };
    request.onerror = () => reject(new ApiError("network", 0));
    request.onabort = () => reject(new DOMException("aborted", "AbortError"));
    options.signal?.addEventListener("abort", () => request.abort(), { once: true });
    if (options.signal?.aborted) {
      reject(new DOMException("aborted", "AbortError"));
      return;
    }
    request.send(body);
  });
}

export interface WikiDraft {
  space: KnowledgeSpaceId;
  title: string;
  folder?: string;
  content: string;
  summary?: string;
}

export const wikiApi = {
  spaces: () => api<{ spaces: WireKnowledgeSpace[] }>("/api/wiki/spaces").then((reply) => reply.spaces),
  list: (space: KnowledgeSpaceId, filter: { q?: string; folder?: string; tag?: string } = {}) => api<WikiListing>(`/api/wiki/pages${query({ space, ...filter })}`),
  page: (space: KnowledgeSpaceId, id: string) => api<WikiPageDetail>(`/api/wiki/page${query({ space, id })}`),
  create: (draft: WikiDraft) => post<WikiSaveResult>("/api/wiki/page", draft),
  update: (space: KnowledgeSpaceId, id: string, patch: { title?: string; folder?: string; content?: string; summary?: string; expectedVersion?: number }) =>
    api<WikiSaveResult>("/api/wiki/page", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ space, id, ...patch }) }),
  remove: (space: KnowledgeSpaceId, id: string) => api<{ ok: true }>(`/api/wiki/page${query({ space, id })}`, { method: "DELETE" }),
  versions: (space: KnowledgeSpaceId, id: string) => api<{ versions: WikiVersionItem[] }>(`/api/wiki/versions${query({ space, id })}`).then((reply) => reply.versions),
  version: (space: KnowledgeSpaceId, id: string, n: number) => api<{ content: string }>(`/api/wiki/version${query({ space, id, n })}`),
  restore: (space: KnowledgeSpaceId, id: string, version: number) => post<WikiSaveResult>("/api/wiki/restore", { space, id, version }),
  graph: (space: KnowledgeSpaceId) => api<WikiGraph>(`/api/wiki/graph${query({ space })}`),
  trash: (space: KnowledgeSpaceId) => api<{ items: WikiTrashItem[] }>(`/api/wiki/trash${query({ space })}`).then((reply) => reply.items),
  restoreFromTrash: (space: KnowledgeSpaceId, id: string) => post<{ page: WikiPageDetail }>("/api/wiki/trash/restore", { space, id }),
  importStart: (space: KnowledgeSpaceId, root: string) => post<{ session: string; root: string; limits: WikiImportLimits }>("/api/wiki/import/start", { space, root }),
  importFile: (space: KnowledgeSpaceId, session: string, path: string, body: Blob, signal?: AbortSignal) =>
    api<{ accepted: boolean; skipped?: string; kind?: string }>(`/api/wiki/import/file${query({ space, session, path })}`, {
      method: "PUT",
      headers: { "content-type": "application/octet-stream" },
      body,
      ...(signal ? { signal } : {}),
    }),
  importFinish: (space: KnowledgeSpaceId, session: string) => post<WikiImportSummary>("/api/wiki/import/finish", { space, session }),
  importCancel: (space: KnowledgeSpaceId, session: string) => post<{ ok: true }>("/api/wiki/import/cancel", { space, session }),
};
