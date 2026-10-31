import { personPhotoUrl } from "../../shared/person-identity";

export interface EnvironmentDescriptor {
  environmentId: string;
  label: string;
  platform: string;
  version: string;
  capabilities: { remoteSessions: true; selfUpdate: "desktop-managed" | "operator"; emailSignIn?: boolean; joinByLink?: true; sharedComputers?: true; cloudHome?: true };
}

/** The `person` of GET /api/auth/session: the owner, or anyone signed in with an address; never a bare device. */
export interface SessionPerson {
  name: string;
  email?: string;
  avatarUrl?: string;
  owner?: true;
}

export type SessionState =
  | { kind: "loopback"; trust?: "service" }
  | { kind: "session"; id: string; label: string; scopes: string[]; expiresAt: number; email?: string; name?: string; person?: SessionPerson; cloudGuest?: true; guest?: true; openedThreads?: string[]; reactor?: string }
  | { kind: "unauthenticated"; error: string }
  | { kind: "unreachable"; error: string };

interface SharedSession { ok: boolean; status: number; statusText: string; body: any }
let sharedSession: { at: number; promise: Promise<SharedSession> } | null = null;
const SESSION_TTL_MS = 5_000;

/** One GET /api/auth/session at a time and for a few seconds after: the start-up asks for it from several places. */
export function sharedAuthSession(): Promise<SharedSession> {
  if (sharedSession && Date.now() - sharedSession.at < SESSION_TTL_MS) return sharedSession.promise;
  const promise = fetch("/api/auth/session", { credentials: "same-origin" }).then(async (res) => ({
    ok: res.ok, status: res.status, statusText: res.statusText, body: await res.json().catch(() => ({})),
  }));
  const entry = { at: Date.now(), promise };
  sharedSession = entry;
  promise.catch(() => { if (sharedSession === entry) sharedSession = null; });
  return promise;
}

function personOf(value: unknown): SessionPerson | undefined {
  const person = Object(value) as Record<string, unknown>;
  if (typeof person.name !== "string" || !person.name.trim()) return undefined;
  const avatarUrl = personPhotoUrl(person.avatarUrl);
  return {
    name: person.name,
    ...(typeof person.email === "string" && person.email ? { email: person.email } : {}),
    ...(avatarUrl ? { avatarUrl } : {}),
    ...(person.owner === true ? { owner: true as const } : {}),
  };
}

/** What the server said, with the raw answer kept for the few readers that need fields SessionState leaves out. */
export interface SessionSnapshot {
  state: SessionState;
  body: Record<string, unknown>;
}

export async function readSessionSnapshot(fetchImpl?: typeof fetch): Promise<SessionSnapshot> {
  let res: { ok: boolean; status: number; statusText: string; json: () => Promise<unknown> };
  try {
    if (fetchImpl && fetchImpl !== globalThis.fetch) res = await fetchImpl("/api/auth/session", { credentials: "same-origin" });
    else {
      const answer = await sharedAuthSession();
      res = { ...answer, json: async () => answer.body };
    }
  } catch (error) {
    return { state: { kind: "unreachable", error: error instanceof Error ? error.message : String(error) }, body: {} };
  }
  const body: unknown = await res.json().catch(() => ({}));
  const record = Object(body) as Record<string, unknown>;
  if (res.status === 401 || res.status === 403) {
    return { state: { kind: "unauthenticated", error: typeof record.error === "string" ? record.error : `${res.status}` }, body: record };
  }
  if (!res.ok) return { state: { kind: "unreachable", error: `${res.status} ${res.statusText}` }, body: record };
  if (record.kind === "session" && typeof record.id === "string") {
    const person = personOf(record.person);
    return {
      state: {
        kind: "session",
        id: record.id,
        label: typeof record.label === "string" ? record.label : "",
        scopes: Array.isArray(record.scopes) ? record.scopes.filter((s): s is string => typeof s === "string") : [],
        expiresAt: typeof record.expiresAt === "number" ? record.expiresAt : 0,
        ...(typeof record.reactor === "string" ? { reactor: record.reactor } : {}),
        ...(typeof record.email === "string" && record.email ? { email: record.email } : {}),
        ...(typeof record.name === "string" ? { name: record.name } : {}),
        ...(person ? { person } : {}),
        ...(record.guest === true ? { guest: true as const } : {}),
        ...(record.cloudGuest === true ? {
          cloudGuest: true as const,
          openedThreads: Array.isArray(record.openedThreads) ? record.openedThreads.filter((id): id is string => typeof id === "string") : [],
        } : {}),
      },
      body: record,
    };
  }
  return { state: record.trust === "service" ? { kind: "loopback", trust: "service" } : { kind: "loopback" }, body: record };
}

export async function readSessionState(fetchImpl?: typeof fetch): Promise<SessionState> {
  return (await readSessionSnapshot(fetchImpl)).state;
}

let shared: Promise<SessionSnapshot> | null = null;

function snapshotOnce(force: boolean, fetchImpl?: typeof fetch): Promise<SessionSnapshot> {
  if (force || !shared) {
    const next: Promise<SessionSnapshot> = readSessionSnapshot(fetchImpl).catch((error) => {
      if (shared === next) shared = null;
      throw error;
    });
    shared = next;
  }
  return shared;
}

/** One /api/auth/session for the whole page: callers share the request in flight or its answer. */
export function sessionOnce(force = false, fetchImpl?: typeof fetch): Promise<SessionState> {
  return snapshotOnce(force, fetchImpl).then((snapshot) => snapshot.state);
}

/** The same shared answer as the server sent it, for fields such as hosted, cloudHome and owner. Rejects unless signed in. */
export async function sessionBodyOnce(force = false, fetchImpl?: typeof fetch): Promise<Record<string, unknown>> {
  const { state, body } = await snapshotOnce(force, fetchImpl);
  if (state.kind === "unauthenticated" || state.kind === "unreachable") throw new Error(state.error);
  return body;
}

/** For a caller that already holds the answer, such as the page that just opened. */
export function seedSession(state: SessionState, body: Record<string, unknown> = {}): void {
  shared = Promise.resolve({ state, body });
}

/** Sign-in, sign-out and pairing change who this is; the next reader must ask again. */
export function invalidateSession(): void {
  shared = null;
}

export const SERVICE_TRUST_REASON = "This server does not treat this computer as its owner. Sign in or pair this browser to continue.";

export function isConnected(state: SessionState | null): boolean {
  return state?.kind === "session" || (state?.kind === "loopback" && state.trust !== "service");
}

export function isOwnerOrAdmin(state: SessionState | null): boolean {
  if (!state) return false;
  return state.kind === "loopback" ? state.trust !== "service" : state.kind === "session" && state.scopes.includes("admin");
}

export function takePairingCodeFromLocation(): string | null {
  const m = /[#&]code=([^&]+)/.exec(location.hash);
  if (!m) return null;
  history.replaceState(null, "", location.pathname + location.search);
  return decodeURIComponent(m[1]);
}

/** A single-use sign-in credential: taken off the address bar and out of history before anything renders, never shown. */
export function takeBrowserSignInFromLocation(): string | null {
  if (!/[#&]signin=/.test(location.hash)) return null;
  const m = /[#&]signin=(nordus_pair_[A-Za-z0-9_-]{43})(?:&|$)/.exec(location.hash);
  history.replaceState(null, "", location.pathname + location.search);
  return m ? m[1] : null;
}

export const BROWSER_SIGN_IN_FAILED = "This sign-in link has expired or was already used. On My Cloud, choose “Use in your browser” again.";

/** Never trusted on its own; the one-time code still goes to the address itself. */
export function takeInvitedEmailFromLocation(): string | null {
  const params = new URLSearchParams(location.search);
  const email = params.get("email")?.trim().toLowerCase() ?? "";
  if (!email) return null;
  params.delete("email");
  const search = params.toString();
  history.replaceState(null, "", location.pathname + (search ? `?${search}` : "") + location.hash);
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : null;
}

/** The invite link's token: taken off the address bar before anything renders. The server decides whether it is still valid. */
export function takeJoinTokenFromLocation(): string | null {
  const params = new URLSearchParams(location.search);
  const token = params.get("join")?.trim() ?? "";
  if (!token) return null;
  params.delete("join");
  const search = params.toString();
  history.replaceState(null, "", location.pathname + (search ? `?${search}` : "") + location.hash);
  return /^[A-Za-z0-9_-]{8,256}$/.test(token) ? token : null;
}

export function defaultDeviceLabel(userAgent: string = navigator.userAgent): string {
  const browser = /Edg\//.test(userAgent) ? "Edge" : /OPR\//.test(userAgent) ? "Opera" : /Chrome\//.test(userAgent) ? "Chrome" : /Firefox\//.test(userAgent) ? "Firefox" : /Safari\//.test(userAgent) ? "Safari" : "Browser";
  const os = /iPhone/.test(userAgent) ? "iPhone" : /iPad/.test(userAgent) ? "iPad" : /Android/.test(userAgent) ? "Android" : /Mac OS X/.test(userAgent) ? "Mac" : /Windows/.test(userAgent) ? "Windows" : /Linux/.test(userAgent) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}

/** A retry with the same id returns the same session, and nobody who merely shares this address can guess it. */
export function newAttemptId(): string {
  return typeof crypto?.randomUUID === "function" ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

export async function pairWithCode(
  input: { code: string; label: string; attemptId?: string; browser?: boolean },
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true } | { ok: false; error: string }> {
  let res: Response;
  try {
    res = await fetchImpl("/api/auth/pair", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: input.code, label: input.label, cookie: true, attemptId: input.attemptId ?? newAttemptId(), ...(input.browser ? { browser: true } : {}) }),
    });
  } catch (error) {
    return { ok: false, error: `could not reach the server (${error instanceof Error ? error.message : String(error)})` };
  }
  const body: unknown = await res.json().catch(() => ({}));
  if (res.ok) {
    invalidateSession();
    return { ok: true };
  }
  const error = Reflect.get(Object(body), "error");
  return { ok: false, error: typeof error === "string" ? error : `${res.status} ${res.statusText}` };
}

export async function previewBrowserSignIn(credential: string, fetchImpl: typeof fetch = fetch): Promise<{ owner: string } | null> {
  try {
    const res = await fetchImpl("/api/auth/pair", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: credential, browser: true, preview: true }),
    });
    const owner: unknown = Reflect.get(Object(await res.json().catch(() => ({}))), "owner");
    return res.ok && typeof owner === "string" && owner ? { owner } : null;
  } catch {
    return null;
  }
}

export function signInWithBrowserGrant(credential: string, attemptId: string, fetchImpl: typeof fetch = fetch): Promise<{ ok: true } | { ok: false; error: string }> {
  return pairWithCode({ code: credential, label: defaultDeviceLabel(), attemptId, browser: true }, fetchImpl);
}

export function cloudOwnerOf(session: unknown): string | null {
  const record = Object(session) as { cloudHome?: unknown; owner?: unknown };
  return record.cloudHome === true && typeof record.owner === "string" && record.owner ? record.owner : null;
}

export type AuthResult = { ok: true; pending?: true } | { ok: false; error: string };

async function postAuth(path: string, body: Record<string, unknown>, fetchImpl: typeof fetch): Promise<AuthResult> {
  let res: Response;
  try {
    res = await fetchImpl(path, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  } catch (error) {
    return { ok: false, error: `could not reach the server (${error instanceof Error ? error.message : String(error)})` };
  }
  const parsed: unknown = await res.json().catch(() => ({}));
  if (res.status === 202 && Reflect.get(Object(parsed), "pending") === true) return { ok: true, pending: true };
  if (res.ok) {
    invalidateSession();
    return { ok: true };
  }
  const error = Reflect.get(Object(parsed), "error");
  return { ok: false, error: typeof error === "string" ? error : `${res.status} ${res.statusText}` };
}

export function startEmailSignIn(email: string, joinToken?: string | null, fetchImpl: typeof fetch = fetch): Promise<AuthResult> {
  return postAuth("/api/auth/email/start", { email, ...(joinToken ? { joinToken } : {}) }, fetchImpl);
}

export function verifyEmailSignIn(input: { email: string; code: string; label: string; name?: string; joinToken?: string | null }, fetchImpl: typeof fetch = fetch): Promise<AuthResult> {
  return postAuth("/api/auth/email/verify", { email: input.email, code: input.code, label: input.label, ...(input.name?.trim() ? { name: input.name.trim() } : {}), ...(input.joinToken ? { joinToken: input.joinToken } : {}) }, fetchImpl);
}

export function reasonWorthShowing(reason: string | undefined): string | null {
  if (!reason) return null;
  if (/through a proxy|loopback host required|cross-origin request|^40[13]$/i.test(reason)) return null;
  return reason;
}
