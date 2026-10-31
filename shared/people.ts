/** Admin sees and changes everything. Member chats and decides what is theirs. Guest only chats in the rooms they were put in. */
export type PersonRole = "admin" | "member" | "guest";

export const PERSON_ROLES: readonly PersonRole[] = ["admin", "member", "guest"];

/** `GET /api/people/directory` answers a list of these: no spend, no last seen. */
export interface DirectoryPerson {
  email: string;
  name: string;
  role: PersonRole;
}

/** A line in a direct message: text between two people, no agent anywhere. */
export interface DirectMessage {
  id: string;
  at: number;
  /** The sender's address, lowercased. */
  from: string;
  name: string;
  text: string;
}

/** `GET /api/dms` answers `{ dms: DirectConversation[] }`, newest first. A direct message is visible only to its two people, admins included.
 * The live stream carries `{ kind: "dm", dm }` and `{ kind: "dm.message", dmId, message }` to those two people only. */
export interface DirectConversation {
  id: string;
  /** The id a notification about this conversation names as its thread. */
  threadId: string;
  /** The other person, lowercased. */
  peer: string;
  peerName: string;
  unread: boolean;
  last?: DirectMessage;
}

export const DIRECT_THREAD_PREFIX = "dm:";

const EMAIL = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;

/** The address as people lists keep it: trimmed and lowercased; null when it is not an email address. */
export function normalizePersonEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 320 && EMAIL.test(email) ? email : null;
}

/** "ana.paula@acme.com" reads "Ana Paula" until the person gives a name of their own. */
export function personNameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "";
  const words = local.split(/[._\-+]+/).filter(Boolean);
  if (!words.length) return email;
  return words.map((word) => word.charAt(0).toLocaleUpperCase() + word.slice(1)).join(" ");
}

/** How a person is greeted in a list: the name they gave, else the one their address suggests. */
export function personDisplayName(person: { name?: string | null; email: string }): string {
  return person.name?.trim() || personNameFromEmail(person.email);
}
