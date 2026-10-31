import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { JoinLink, JoinRequest } from "../shared/people-join.ts";
import { writeFileAtomic } from "./atomic.ts";

export const MAX_PENDING_JOIN_REQUESTS = 100;

/** The address as a mailbox sees it: "+tag" aliases land in the same inbox, so they count as one person. */
function mailbox(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 0) return email;
  return `${email.slice(0, at).split("+")[0]}${email.slice(at)}`;
}

export type JoinRecordResult = { ok: true; request: JoinRequest; created: boolean } | { ok: false; status: 429; error: string };

export interface JoinRequests {
  link(): JoinLink | null;
  rotateLink(): JoinLink;
  revokeLink(): void;
  matches(token: unknown): boolean;
  list(): JoinRequest[];
  record(email: string, name?: string | null): JoinRecordResult;
  take(id: string): JoinRequest | null;
}

interface Stored {
  link: JoinLink | null;
  requests: JoinRequest[];
}

function sane(raw: unknown): Stored {
  const empty: Stored = { link: null, requests: [] };
  if (!raw || typeof raw !== "object") return empty;
  const { link, requests } = raw as { link?: Partial<JoinLink> | null; requests?: unknown };
  const seen = new Set<string>();
  const kept: JoinRequest[] = [];
  for (const entry of Array.isArray(requests) ? requests : []) {
    const { id, email, createdAt, name } = (entry ?? {}) as Partial<JoinRequest>;
    if (typeof id !== "string" || typeof email !== "string" || typeof createdAt !== "number") continue;
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push({ id, email: key, createdAt, ...(typeof name === "string" && name ? { name } : {}) });
  }
  return {
    link: link && typeof link.token === "string" && typeof link.createdAt === "number" ? { token: link.token, createdAt: link.createdAt } : null,
    requests: kept.slice(0, MAX_PENDING_JOIN_REQUESTS),
  };
}

export function createJoinRequests(dataDir: string, now: () => number = Date.now): JoinRequests {
  const file = join(dataDir, "join-requests.json");
  let state: Stored = { link: null, requests: [] };
  if (existsSync(file)) {
    try {
      state = sane(JSON.parse(readFileSync(file, "utf8")));
    } catch {
      state = { link: null, requests: [] };
    }
  }
  const save = () => writeFileAtomic(file, JSON.stringify(state, null, 2), { mode: 0o600 });
  return {
    link: () => (state.link ? { ...state.link } : null),
    rotateLink() {
      state.link = { token: randomBytes(24).toString("base64url"), createdAt: now() };
      save();
      return { ...state.link };
    },
    revokeLink() {
      if (!state.link) return;
      state.link = null;
      save();
    },
    matches(token) {
      if (!state.link || typeof token !== "string") return false;
      const given = Buffer.from(token);
      const want = Buffer.from(state.link.token);
      return given.length === want.length && timingSafeEqual(given, want);
    },
    list: () => state.requests.map((request) => ({ ...request })),
    record(rawEmail, rawName) {
      const email = rawEmail.trim().toLowerCase();
      const existing = state.requests.find((request) => mailbox(request.email) === mailbox(email));
      if (existing) return { ok: true, request: { ...existing }, created: false };
      if (state.requests.length >= MAX_PENDING_JOIN_REQUESTS) {
        return { ok: false, status: 429, error: "too many people are waiting for approval; ask the server's owner to answer them first" };
      }
      const name = rawName?.trim().slice(0, 80);
      const request = { id: randomUUID(), email, createdAt: now(), ...(name ? { name } : {}) };
      state.requests.push(request);
      save();
      return { ok: true, request: { ...request }, created: true };
    },
    take(id) {
      const index = state.requests.findIndex((request) => request.id === id);
      if (index < 0) return null;
      const [removed] = state.requests.splice(index, 1);
      save();
      return removed!;
    },
  };
}
