import type { PersonRole } from "../shared/people.ts";
import { normalizePersonEmail } from "../shared/people.ts";
import { BOT_PROFILE_PATCH_FIELDS } from "./bot-profile.ts";
import type { RequestAuth } from "./request-auth.ts";
import { CLIENT_BOT_PATCH_FIELDS, clientBotPatchViolation } from "./request-auth.ts";

export function authEmail(auth: RequestAuth): string | undefined {
  if (auth.kind !== "session") return undefined;
  return normalizePersonEmail(auth.session.email) ?? undefined;
}

export function authIsAdmin(auth: RequestAuth): boolean {
  return auth.scopes.includes("admin");
}

export function authIsGuest(auth: RequestAuth): boolean {
  return auth.kind === "session" && auth.session.guest === true;
}

/** The owner at their own desktop: a request from this machine that a service trust did not narrow. */
export function authIsOwnerDesktop(auth: RequestAuth): boolean {
  return auth.kind === "loopback" && auth.trust !== "service";
}

export function roleOfAuth(auth: RequestAuth): PersonRole {
  if (authIsAdmin(auth)) return "admin";
  return authIsGuest(auth) ? "guest" : "member";
}

/** A person named without a request: by address, and by the role they have now. */
export interface PersonRef {
  email?: string | null;
  role?: PersonRole;
  guest?: boolean;
}

/** Whether this person answers for this agent, by the role they have now: a guest never does. Naming a person opens nothing: who
 * sees the agent is decided apart from who answers for it. The one place that asks, for requests and for decisions alike. */
export function ownsBot(person: RequestAuth | PersonRef, bot: { owner?: string } | null | undefined): boolean {
  const email = "kind" in person ? authEmail(person) : normalizePersonEmail(person.email) ?? undefined;
  const guest = "kind" in person ? authIsGuest(person) : person.guest === true || person.role === "guest";
  return Boolean(email && !guest && bot?.owner && bot.owner.trim().toLowerCase() === email);
}

/** Who a new agent answers to: nobody when an admin makes it, so that its admins answer and no right outlives the admin role. */
export function defaultOwner(auth: RequestAuth): string | undefined {
  return authIsAdmin(auth) || authIsGuest(auth) ? undefined : authEmail(auth);
}

export function parseOwner(value: unknown): { ok: true; owner: string | null } | { ok: false; error: string } {
  if (value === null || value === "" || value === "admins") return { ok: true, owner: null };
  const email = normalizePersonEmail(value);
  return email ? { ok: true, owner: email } : { ok: false, error: "owner must be an email address, or null for the workspace admins" };
}

/** What the person an agent answers to may change on it: how it looks, its instructions and its everyday settings.
 * What it may reach, who may see it and who answers for it stay with the admins. */
export const OWNER_BOT_PATCH_FIELDS: ReadonlySet<string> = new Set([
  ...CLIENT_BOT_PATCH_FIELDS,
  ...BOT_PROFILE_PATCH_FIELDS,
  "memoryEnabled", "voiceNotes", "xResearch", "parkDirectMessages",
]);

export function ownerBotPatchViolation(body: unknown): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "body";
  for (const key of Object.keys(body)) if (!OWNER_BOT_PATCH_FIELDS.has(key)) return key;
  return null;
}

/** The field of a change to an agent that this caller may not make, or null. An admin and the owner's own desktop change anything;
 * a paired device or a member only how it looks, and the person the agent answers to also its instructions and everyday switches. */
export function botPatchViolation(auth: RequestAuth, bot: { owner?: string } | null | undefined, body: unknown, pairedDevice: boolean): string | null {
  if (!pairedDevice && (auth.kind !== "session" || authIsAdmin(auth))) return null;
  return !pairedDevice && ownsBot(auth, bot) ? ownerBotPatchViolation(body) : clientBotPatchViolation(body);
}

/** An owner reads what an agent used in tokens and runs; what that cost in money is for the admins. */
export function withoutMoney<T extends object>(state: T): Omit<T, "spentUsd"> {
  const { spentUsd: _spent, ...rest } = state as T & { spentUsd?: unknown };
  return rest;
}
