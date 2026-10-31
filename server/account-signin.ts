// Email sign-in through the Nordus control plane: the code exchange is server-side, so a browser only talks to this
// server, and a server with an empty allow-list does not expose the routes. The result is an ordinary local session.
import { resolveCompanionControlPlaneURL } from "../electron/companion-account-service.mjs";
import { ControlPlaneError, createControlPlaneClient, normalizeAccountEmail, type ControlPlaneClient } from "../electron/control-plane-client.mjs";
import type { PersonRole } from "../shared/people.ts";
import type { JoinPending } from "../shared/people-join.ts";
import type { JoinRecordResult } from "./join-requests.ts";
import type { Scope } from "./sessions.ts";

/** Who may sign in. `a@b.com` is that address; `@b.com` is everyone at b.com. */
export interface SignInAllowList {
  admins: string[];
  members: string[];
  /** Nordus: people who only chat in the rooms they were put in. */
  guests?: string[];
}

/** Commas, spaces or newlines between entries; case does not matter. */
export function parseAllowList(value: string | undefined | null): string[] {
  return (value ?? "")
    .split(/[,\s]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function entryMatches(entry: string, email: string): boolean {
  return entry.startsWith("@") ? email.endsWith(entry) && email.length > entry.length : entry === email;
}

/** The first list that names the address wins, so a person on two lists keeps the wider role. */
export function roleOfEmail(rawEmail: string, list: SignInAllowList): PersonRole | null {
  const email = rawEmail.trim().toLowerCase();
  if (!email.includes("@")) return null;
  const matches = (entry: string) => entryMatches(entry, email);
  if (list.admins.some(matches)) return "admin";
  if (list.members.some(matches)) return "member";
  if (list.guests?.some(matches)) return "guest";
  return null;
}

export function allowedScopes(rawEmail: string, list: SignInAllowList): Scope[] | null {
  const role = roleOfEmail(rawEmail, list);
  if (role === "admin") return ["admin", "client"];
  return role ? ["client"] : null;
}

export function isGuestEmail(rawEmail: string, list: SignInAllowList): boolean {
  return roleOfEmail(rawEmail, list) === "guest";
}

export function signInEnabled(list: SignInAllowList): boolean {
  return list.admins.length + list.members.length + (list.guests?.length ?? 0) > 0;
}

export type SignInFailure = { ok: false; status: number; error: string };

/** The invite link, as sign-in sees it: a matching token lets an unlisted email prove itself and queue for approval. */
export interface JoinInvites {
  active(): boolean;
  matches(token: unknown): boolean;
  record(email: string): JoinRecordResult;
}

export interface EmailSignIn {
  enabled(): boolean;
  start(email: string, joinToken?: unknown): Promise<{ ok: true } | SignInFailure>;
  verify(
    email: string,
    code: string,
    joinToken?: unknown,
  ): Promise<({ ok: true; email: string; userId: string; scopes: Scope[]; guest?: true } | ({ ok: true } & JoinPending)) | SignInFailure>;
}

const NOT_WELCOME: SignInFailure = { ok: false, status: 403, error: "this email is not on this server's sign-in list; ask the server's owner to add it" };

export function createEmailSignIn(options: {
  allow: SignInAllowList | (() => SignInAllowList);
  join?: JoinInvites;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  client?: ControlPlaneClient;
}): EmailSignIn {
  const env = options.env ?? process.env;
  const allow = () => (typeof options.allow === "function" ? options.allow() : options.allow);
  let client: ControlPlaneClient | null = options.client ?? null;
  const controlPlane = (): ControlPlaneClient => {
    if (client) return client;
    const url = resolveCompanionControlPlaneURL({ isPackaged: true, environment: env });
    if (!url) throw new Error("NORDUS_CONTROL_PLANE_URL is set but is not an https address");
    client = createControlPlaneClient({ baseURL: url, fetchImpl: options.fetchImpl });
    return client;
  };
  return {
    enabled: () => signInEnabled(allow()) || options.join?.active() === true,
    async start(rawEmail, joinToken) {
      const email = normalizeAccountEmail(rawEmail);
      if (!email) return { ok: false, status: 400, error: "enter a valid email address" };
      if (!allowedScopes(email, allow()) && !options.join?.matches(joinToken)) return NOT_WELCOME;
      try {
        await controlPlane().requestOTP(email);
      } catch (error) {
        return unavailable(error);
      }
      return { ok: true };
    },
    async verify(rawEmail, code, joinToken) {
      const email = normalizeAccountEmail(rawEmail);
      if (!email || (!allowedScopes(email, allow()) && !options.join?.matches(joinToken))) return NOT_WELCOME;
      let verified: { accountToken: string; user: { id: string; email: string } };
      try {
        verified = await controlPlane().verifyOTP(email, code);
      } catch (error) {
        // The client refuses a malformed code before any request (status 0);
        // the control plane's own "invalid_otp" is a wrong or expired code.
        if (error instanceof ControlPlaneError && error.code === "invalid_otp" && !error.status) {
          return { ok: false, status: 400, error: "enter the 8-digit code from the email" };
        }
        if (error instanceof ControlPlaneError && error.status === 429) {
          return { ok: false, status: 429, error: "too many attempts; wait a minute and request a new code" };
        }
        if (error instanceof ControlPlaneError && (error.status === 400 || error.status === 401 || error.status === 403)) {
          return { ok: false, status: 401, error: "that code is wrong or has expired; request a new one" };
        }
        return unavailable(error);
      }
      void controlPlane()
        .signOut(verified.accountToken)
        .catch(() => undefined);
      const scopes = allowedScopes(verified.user.email, allow());
      if (!scopes) {
        if (!options.join?.matches(joinToken)) return NOT_WELCOME;
        const recorded = options.join.record(verified.user.email);
        if (!recorded.ok) return recorded;
        return { ok: true, pending: true, email: recorded.request.email };
      }
      return { ok: true, email: verified.user.email, userId: verified.user.id, scopes, ...(isGuestEmail(verified.user.email, allow()) ? { guest: true as const } : {}) };
    },
  };
}

function unavailable(error: unknown): SignInFailure {
  const detail = error instanceof ControlPlaneError ? `${error.code}${error.status ? ` (${error.status})` : ""}` : error instanceof Error ? error.message : String(error);
  return { ok: false, status: 502, error: `the sign-in service could not be reached (${detail}); try again in a moment` };
}
