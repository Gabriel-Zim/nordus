import { applyConfig, configOnce } from "@/lib/config-cache";
import { api } from "@/state/store";
import { normalizeAccessEntry, readSignInLists, withEntries } from "./sign-in-lists";
import type { JoinApproveRole, JoinLink, PeopleJoinState } from "../../shared/people-join";

export type { JoinApproveRole, JoinLink, JoinRequest, PeopleJoinState } from "../../shared/people-join";

export interface ParsedAddresses {
  valid: string[];
  invalid: string[];
}

export function parseAddresses(raw: string): ParsedAddresses {
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const piece of raw.split(/[\s,;]+/)) {
    if (!piece) continue;
    const entry = normalizeAccessEntry(piece);
    if (!entry) invalid.push(piece);
    else if (!valid.includes(entry)) valid.push(entry);
  }
  return { valid, invalid };
}

export { withEntries };

export function joinUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}/pair?join=${encodeURIComponent(token)}`;
}

export function loopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return host === "" || host === "localhost" || host.endsWith(".localhost") || host === "::1" || host === "0.0.0.0" || /^127(?:\.\d{1,3}){3}$/.test(host);
}

export { readSignInLists as currentLists };

export interface InviteResult {
  added: string[];
  invalid: string[];
}

/** One PUT for every valid address; the invalid ones come back so the caller can show them. */
export async function inviteAddresses(raw: string, role: JoinApproveRole): Promise<InviteResult> {
  const { valid, invalid } = parseAddresses(raw);
  if (valid.length) {
    const lists = readSignInLists(await configOnce());
    applyConfig(await api("/api/config", { method: "PUT", body: JSON.stringify({ signIn: withEntries(lists, valid, role) }) }));
  }
  return { added: valid, invalid };
}

export function fetchJoinState(): Promise<PeopleJoinState> {
  return api<PeopleJoinState>("/api/people/join");
}

export async function createJoinLink(): Promise<JoinLink | null> {
  return (await api<{ link: JoinLink | null }>("/api/people/join/link", { method: "POST" })).link;
}

export async function removeJoinLink(): Promise<void> {
  await api("/api/people/join/link", { method: "DELETE" });
}

export async function ensureJoinLink(): Promise<PeopleJoinState> {
  const state = await fetchJoinState();
  if (state.link) return state;
  return { ...state, link: await createJoinLink() };
}

export async function answerJoinRequest(id: string, answer: { approve: JoinApproveRole } | { reject: true }): Promise<void> {
  const base = `/api/people/join/requests/${encodeURIComponent(id)}`;
  if ("approve" in answer) await api(`${base}/approve`, { method: "POST", body: JSON.stringify({ role: answer.approve }) });
  else await api(`${base}/reject`, { method: "POST", body: "{}" });
}
