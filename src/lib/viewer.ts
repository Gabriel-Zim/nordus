import { normalizePersonEmail } from "../../shared/people";
import { sessionOnce, type SessionState } from "./session";

/** Who is looking at the screen: the address they answer to, whether they run the workspace, and whether they are a guest. */
export interface Viewer {
  email?: string;
  admin: boolean;
  guest: boolean;
}

const NOBODY: Viewer = { admin: false, guest: false };

/** The workspace owner on a desktop that never asks for an address is an admin under the address of their profile. */
export function viewerOf(session: SessionState | null, profileEmail?: string | null): Viewer {
  if (!session) return NOBODY;
  const profile = normalizePersonEmail(profileEmail) ?? undefined;
  if (session.kind === "loopback") return session.trust === "service" ? NOBODY : { admin: true, guest: false, ...(profile ? { email: profile } : {}) };
  if (session.kind !== "session") return NOBODY;
  const admin = session.scopes.includes("admin");
  const email = normalizePersonEmail(session.email) ?? (admin ? profile : undefined);
  return { admin, guest: session.guest === true, ...(email ? { email } : {}) };
}

export function sameEmail(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normalizePersonEmail(a);
  return left !== null && left === normalizePersonEmail(b);
}

export function sessionIsGuest(): Promise<boolean> {
  return sessionOnce().then((session) => viewerOf(session).guest, () => false);
}
