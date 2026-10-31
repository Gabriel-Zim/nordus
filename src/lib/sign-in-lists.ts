import type { PersonRole } from "../../shared/people";

/** `guests` is left out until the server has said what it holds: a save that omits it keeps the saved guests, `[]` clears them. */
export interface SignInLists {
  admins: string[];
  members: string[];
  guests?: string[];
}

export function normalizeAccessEntry(raw: string): string | null {
  const value = raw.trim().toLowerCase();
  if (!value || /\s/.test(value)) return null;
  if (value.startsWith("@")) return /^@[^@\s]+\.[^@\s]+$/.test(value) ? value : null;
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value) ? value : null;
}

function without(list: readonly string[] | undefined, entry: string): string[] {
  return (list ?? []).filter((item) => item !== entry);
}

export function withEntry(lists: SignInLists, entry: string, role: PersonRole): SignInLists {
  const admins = without(lists.admins, entry);
  const members = without(lists.members, entry);
  const guests = lists.guests || role === "guest" ? without(lists.guests, entry) : undefined;
  return {
    admins: role === "admin" ? [...admins, entry] : admins,
    members: role === "member" ? [...members, entry] : members,
    ...(guests ? { guests: role === "guest" ? [...guests, entry] : guests } : {}),
  };
}

export function withoutEntry(lists: SignInLists, entry: string): SignInLists {
  return {
    admins: without(lists.admins, entry),
    members: without(lists.members, entry),
    ...(lists.guests ? { guests: without(lists.guests, entry) } : {}),
  };
}

export function withEntries(lists: SignInLists, entries: readonly string[], role: PersonRole): SignInLists {
  return entries.reduce((current, entry) => withEntry(current, entry, role), lists);
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function readSignInLists(config: { signIn?: { admins?: unknown; members?: unknown; guests?: unknown } } | null | undefined): SignInLists {
  const signIn = config?.signIn;
  return {
    admins: strings(signIn?.admins),
    members: strings(signIn?.members),
    ...(Array.isArray(signIn?.guests) ? { guests: strings(signIn.guests) } : {}),
  };
}
