// Nordus's own sign-in page: "Entrar com Google" run by this server (OpenID Connect authorization code flow with
// PKCE), ending in the same session cookie a pairing code gives. Who may enter is the owner's sign-in list.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

import { writeFileAtomic } from "./atomic.ts";
import { decryptBrowserState, encryptBrowserState } from "./browser-sites.ts";
import type { LoginRefusal } from "../shared/nordus-login.ts";
import { httpsPhotoUrl } from "../shared/person-identity.ts";
import type { Scope } from "./sessions.ts";

export const LOGIN_START_PATH = "/auth/google";
export const LOGIN_CALLBACK_PATH = "/auth/google/callback";
export const LOGIN_STATUS_PATH = "/auth/status";
/** Short-lived, httpOnly, scoped to the callback: ties the returning browser to the one that started. */
export const LOGIN_BINDING_COOKIE = "nordus_login_state";
export const LOGIN_STATE_TTL_MS = 10 * 60_000;
export const MAX_PENDING_LOGINS = 500;

const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);
const CLOCK_SKEW_S = 120;

const credentialsSchema = z.object({
  clientId: z.string().min(1).max(400),
  clientSecret: z.string().min(1).max(400),
  updatedAt: z.number(),
});
type StoredCredentials = z.infer<typeof credentialsSchema>;

export interface GoogleLoginStatus {
  configured: boolean;
  clientId: string | null;
  updatedAt: number | null;
}

/** The sign-in client's id and secret, sealed under a key of its own; the secret never leaves the server. */
export class GoogleLoginStore {
  private readonly file: string;
  private readonly keyFile: string;
  private cache: StoredCredentials | null | undefined;

  constructor(dataDir: string) {
    this.file = join(dataDir, "google-login.json.enc");
    this.keyFile = join(dataDir, "google-login-key");
  }

  private key(create: boolean): string | null {
    try {
      const existing = readFileSync(this.keyFile, "utf8").trim();
      if (/^[0-9a-f]{64}$/u.test(existing)) return existing;
    } catch {
    }
    if (!create) return null;
    const key = randomBytes(32).toString("hex");
    mkdirSync(join(this.keyFile, ".."), { recursive: true, mode: 0o700 });
    writeFileAtomic(this.keyFile, `${key}\n`, { mode: 0o600 });
    return key;
  }

  private read(): StoredCredentials | null {
    if (this.cache !== undefined) return this.cache;
    let stored: StoredCredentials | null = null;
    if (existsSync(this.file)) {
      try {
        const key = this.key(false);
        if (!key) throw new Error("missing key");
        stored = credentialsSchema.parse(JSON.parse(decryptBrowserState(readFileSync(this.file), key)));
      } catch {
        console.warn("google login: the saved client could not be opened; save it again in Settings");
      }
    }
    this.cache = stored;
    return stored;
  }

  status(): GoogleLoginStatus {
    const stored = this.read();
    return { configured: Boolean(stored), clientId: stored?.clientId ?? null, updatedAt: stored?.updatedAt ?? null };
  }

  /** A blank secret keeps the saved one, so the id can be corrected alone. */
  set(clientId: string, clientSecret: string | null): void {
    const id = clientId.trim();
    if (!/^[\w.-]+\.apps\.googleusercontent\.com$/.test(id)) {
      throw Object.assign(new Error("O ID do cliente do Google termina em .apps.googleusercontent.com."), { status: 400 });
    }
    const secret = clientSecret?.trim() || this.read()?.clientSecret;
    if (!secret) throw Object.assign(new Error("A chave secreta do cliente é obrigatória."), { status: 400 });
    const next = credentialsSchema.parse({ clientId: id, clientSecret: secret, updatedAt: Date.now() });
    const key = this.key(true)!;
    mkdirSync(join(this.file, ".."), { recursive: true, mode: 0o700 });
    writeFileAtomic(this.file, encryptBrowserState(JSON.stringify(next), key), { mode: 0o600 });
    this.cache = next;
  }

  remove(): void {
    rmSync(this.file, { force: true });
    this.cache = null;
  }

  credentials(): { clientId: string; clientSecret: string } | null {
    const stored = this.read();
    return stored ? { clientId: stored.clientId, clientSecret: stored.clientSecret } : null;
  }
}

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const token = (bytes = 32) => randomBytes(bytes).toString("base64url");

function sameText(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Only a path on this server: never another host, never a protocol-relative or backslash trick. */
export function safeReturnTo(value: string | null | undefined): string {
  const raw = (value ?? "").trim();
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\") || raw.length > 512) return "/";
  if ([...raw].some((char) => char.charCodeAt(0) < 0x20)) return "/";
  if (raw.startsWith("/auth/")) return "/";
  return raw;
}

/** Native shells that open the sign-in in the system's browser sheet and get the session back through their own scheme.
 *  The new app answers on `ai.nordus.rn` on every platform (iOS, Android, Mac, Windows), so `desktop` is not a client
 *  name: `ai.nordus.desktop` belongs to the old Electron app installed beside it, and a sign-in sent there would open
 *  the wrong app. `ios` and `mac` stay for builds already shipped. */
export const APP_CALLBACKS = {
  ios: "ai.nordus.app://auth",
  mac: "ai.nordus.desktop://auth",
  rn: "ai.nordus.rn://auth",
} as const;
export type AppClient = keyof typeof APP_CALLBACKS;
export const APP_CODE_TTL_MS = 60_000;

export function isAppClient(value: unknown): value is AppClient {
  return typeof value === "string" && Object.hasOwn(APP_CALLBACKS, value);
}

/** The app's own PKCE: it keeps the verifier, so a code caught on the way back through the scheme is useless alone. */
export interface AppHandoff { client: AppClient; challenge: string }

export function parseAppHandoff(client: string | null, challenge: string | null): AppHandoff | null | "invalid" {
  if (client === null && challenge === null) return null;
  if (!isAppClient(client) || !challenge || !/^[\w-]{43}$/.test(challenge)) return "invalid";
  return { client, challenge };
}

interface PendingLogin {
  app?: AppHandoff;
  bindingHash: string;
  verifier: string;
  nonce: string;
  redirectUri: string;
  returnTo: string;
  /** The invite link's token, kept here and never in the address sent to Google. */
  join?: string;
  expiresAt: number;
}

export type LoginFinish =
  | { ok: true; email: string; subject: string; name: string | null; picture: string | null; scopes: Scope[]; returnTo: string; app?: AppHandoff }
  | { ok: false; reason: LoginRefusal; returnTo: string; countsAsFailure: boolean; app?: AppHandoff };

export interface GoogleLoginOptions {
  credentials: () => { clientId: string; clientSecret: string } | null;
  /** The owner's sign-in list: the scopes this address gets, or null when it may not enter. */
  allow: (email: string) => readonly Scope[] | null;
  /** Verified Google accounts that are not on the list wait here; a successful sign-in leaves the queue. */
  /** The invite link: a verified account that is not on the list but came through a live link waits for approval. */
  join?: { matches: (token: string) => boolean; record: (email: string, name: string | null) => boolean };
  waitlist?: { request: (email: string, name: string | null) => void; clear: (email: string) => void };
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export interface GoogleLogin {
  enabled(): boolean;
  begin(input: { redirectUri: string; returnTo?: string | null; app?: AppHandoff | null; join?: string | null }): { ok: true; url: string; binding: string } | { ok: false; reason: LoginRefusal };
  finish(input: { query: URLSearchParams; binding: string | undefined }): Promise<LoginFinish>;
  pendingCount(): number;
}

function decodeIdToken(idToken: string): Record<string, unknown> | null {
  const parts = idToken.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload: unknown = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8"));
    return payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/** The ID token came straight from Google's token endpoint over TLS, so its claims are checked, not its signature
 * (OpenID Connect Core 1.0, section 3.1.3.7, item 6). */
export function verifiedIdentity(
  claims: Record<string, unknown> | null,
  expected: { clientId: string; nonce: string; nowSeconds: number },
): { ok: true; email: string; subject: string; name: string | null; picture: string | null } | { ok: false; reason: LoginRefusal } {
  if (!claims) return { ok: false, reason: "falhou" };
  if (typeof claims.iss !== "string" || !GOOGLE_ISSUERS.has(claims.iss)) return { ok: false, reason: "falhou" };
  const aud = claims.aud;
  const audiences = Array.isArray(aud) ? aud : [aud];
  if (!audiences.includes(expected.clientId)) return { ok: false, reason: "falhou" };
  if (audiences.length > 1 && claims.azp !== expected.clientId) return { ok: false, reason: "falhou" };
  if (typeof claims.exp !== "number" || claims.exp + CLOCK_SKEW_S < expected.nowSeconds) return { ok: false, reason: "expirou" };
  if (typeof claims.iat === "number" && claims.iat - CLOCK_SKEW_S > expected.nowSeconds) return { ok: false, reason: "falhou" };
  if (typeof claims.nonce !== "string" || !sameText(claims.nonce, expected.nonce)) return { ok: false, reason: "expirou" };
  if (typeof claims.sub !== "string" || !claims.sub) return { ok: false, reason: "falhou" };
  const email = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : "";
  if (!email.includes("@")) return { ok: false, reason: "email_nao_verificado" };
  if (claims.email_verified !== true && claims.email_verified !== "true") return { ok: false, reason: "email_nao_verificado" };
  const name = typeof claims.name === "string" && claims.name.trim() ? claims.name.trim().slice(0, 80) : null;
  return { ok: true, email, subject: claims.sub, name, picture: httpsPhotoUrl(claims.picture) ?? null };
}

export function createGoogleLogin(options: GoogleLoginOptions): GoogleLogin {
  const now = options.now ?? Date.now;
  const fetchImpl = options.fetchImpl ?? fetch;
  const pending = new Map<string, PendingLogin>();

  const prune = () => {
    const at = now();
    for (const [key, entry] of pending) if (entry.expiresAt <= at) pending.delete(key);
    // Oldest first: Map keeps insertion order, so a flood of starts cannot grow memory without bound.
    while (pending.size >= MAX_PENDING_LOGINS) pending.delete(pending.keys().next().value!);
  };

  async function exchange(entry: PendingLogin, query: URLSearchParams, binding: string | undefined): Promise<LoginFinish> {
    const returnTo = entry.returnTo;
    if (!binding || !sameText(sha256(binding), entry.bindingHash)) return { ok: false, reason: "expirou", returnTo, countsAsFailure: true };
    if (query.get("error")) return { ok: false, reason: "cancelado", returnTo, countsAsFailure: false };
    const code = query.get("code");
    if (!code) return { ok: false, reason: "falhou", returnTo, countsAsFailure: true };
    const credentials = options.credentials();
    if (!credentials) return { ok: false, reason: "nao_configurado", returnTo, countsAsFailure: false };

    let idToken: string;
    try {
      const response = await fetchImpl(GOOGLE_TOKEN_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          client_id: credentials.clientId,
          client_secret: credentials.clientSecret,
          redirect_uri: entry.redirectUri,
          code_verifier: entry.verifier,
        }).toString(),
        signal: AbortSignal.timeout(15_000),
      });
      const body = await response.json().catch(() => null) as { id_token?: unknown; error?: unknown } | null;
      if (!response.ok || typeof body?.id_token !== "string") {
        console.warn(`google login: the token exchange was refused (${response.status}${typeof body?.error === "string" ? ` ${body.error.replace(/[^\w.-]/g, "").slice(0, 40)}` : ""})`);
        return { ok: false, reason: "falhou", returnTo, countsAsFailure: true };
      }
      idToken = body.id_token;
    } catch {
      return { ok: false, reason: "falhou", returnTo, countsAsFailure: false };
    }

    const identity = verifiedIdentity(decodeIdToken(idToken), { clientId: credentials.clientId, nonce: entry.nonce, nowSeconds: Math.floor(now() / 1000) });
    if (!identity.ok) return { ...identity, returnTo, countsAsFailure: true };
    const scopes = options.allow(identity.email);
    if (!scopes?.length) {
      if (entry.join && options.join?.matches(entry.join)) {
        try {
          if (options.join.record(identity.email, identity.name)) return { ok: false, reason: "pendente", returnTo, countsAsFailure: false };
        } catch {
          console.warn("google login: the join request could not be saved");
        }
        return { ok: false, reason: "falhou", returnTo, countsAsFailure: false };
      }
      if (!options.waitlist) return { ok: false, reason: "nao_permitido", returnTo, countsAsFailure: true };
      try {
        options.waitlist.request(identity.email, identity.name);
      } catch {
        console.warn("google login: the waiting list could not be saved");
      }
      return { ok: false, reason: "lista_de_espera", returnTo, countsAsFailure: true };
    }
    try {
      options.waitlist?.clear(identity.email);
    } catch {
      console.warn("google login: the waiting list could not be updated");
    }
    return { ok: true, email: identity.email, subject: identity.subject, name: identity.name, picture: identity.picture, scopes: [...scopes], returnTo };
  }

  return {
    enabled: () => options.credentials() !== null,
    pendingCount: () => pending.size,
    begin({ redirectUri, returnTo, app, join }) {
      const credentials = options.credentials();
      if (!credentials) return { ok: false, reason: "nao_configurado" };
      prune();
      const state = token();
      const binding = token();
      const verifier = token(48);
      const nonce = token();
      pending.set(sha256(state), {
        ...(app ? { app } : {}),
        bindingHash: sha256(binding),
        verifier,
        nonce,
        redirectUri,
        returnTo: safeReturnTo(returnTo),
        ...(join && /^[A-Za-z0-9_-]{8,256}$/.test(join) ? { join } : {}),
        expiresAt: now() + LOGIN_STATE_TTL_MS,
      });
      const challenge = createHash("sha256").update(verifier).digest("base64url");
      const url = new URL(GOOGLE_AUTHORIZE_URL);
      url.search = new URLSearchParams({
        client_id: credentials.clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: "openid email profile",
        state,
        nonce,
        code_challenge: challenge,
        code_challenge_method: "S256",
        prompt: "select_account",
        access_type: "online",
      }).toString();
      return { ok: true, url: url.toString(), binding };
    },
    async finish({ query, binding }) {
      prune();
      const state = query.get("state") ?? "";
      const entry = state ? pending.get(sha256(state)) : undefined;
      // Single use: whatever happens next, this state is spent.
      if (entry) pending.delete(sha256(state));
      const returnTo = entry?.returnTo ?? "/";
      if (!entry) return { ok: false, reason: "expirou", returnTo, countsAsFailure: true };
      const result = await exchange(entry, query, binding);
      return entry.app ? { ...result, app: entry.app } : result;
    },
  };
}

export function serializeBindingCookie(value: string, secure: boolean): string {
  const parts = [`${LOGIN_BINDING_COOKIE}=${value}`, `Path=${LOGIN_CALLBACK_PATH}`, "HttpOnly", "SameSite=Lax", `Max-Age=${LOGIN_STATE_TTL_MS / 1000}`];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearBindingCookie(secure: boolean): string {
  return `${LOGIN_BINDING_COOKIE}=; Path=${LOGIN_CALLBACK_PATH}; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
}

export interface AppGrant { email: string; subject: string; scopes: Scope[]; name?: string | null; picture?: string | null }

/** One-time codes (60 s) that carry a finished sign-in from the system browser sheet into the app's own web view. */
export function createAppCodes(options: { now?: () => number } = {}) {
  const now = options.now ?? Date.now;
  const codes = new Map<string, { grant: AppGrant; challenge: string; expiresAt: number }>();
  const prune = () => {
    const at = now();
    for (const [key, entry] of codes) if (entry.expiresAt <= at) codes.delete(key);
    while (codes.size >= MAX_PENDING_LOGINS) codes.delete(codes.keys().next().value!);
  };
  return {
    issue(grant: AppGrant, challenge: string): string {
      prune();
      const code = token();
      codes.set(sha256(code), { grant, challenge, expiresAt: now() + APP_CODE_TTL_MS });
      return code;
    },
    redeem(code: string, verifier: string): AppGrant | null {
      prune();
      const key = sha256(code);
      const entry = codes.get(key);
      if (!entry) return null;
      codes.delete(key);
      const presented = createHash("sha256").update(verifier).digest("base64url");
      return sameText(presented, entry.challenge) ? entry.grant : null;
    },
  };
}
export type AppCodes = ReturnType<typeof createAppCodes>;
