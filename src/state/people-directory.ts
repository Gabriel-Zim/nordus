// Who is in the workspace, for pickers and names: one shared copy of GET /api/people/directory.
import { useEffect, useSyncExternalStore } from "react";

import { PERSON_ROLES, normalizePersonEmail, personDisplayName, type DirectoryPerson } from "../../shared/people";
import { api } from "./api";

export interface DirectoryState {
  loaded: boolean;
  people: DirectoryPerson[];
}

const EMPTY: DirectoryState = { loaded: false, people: [] };
let state = EMPTY;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function commit(next: DirectoryState): void {
  state = next;
  for (const listener of listeners) listener();
}

/** The directory answers a bare list. Anything that is not an address with a known role is left out, and each address once. */
export function parseDirectory(body: unknown): DirectoryPerson[] {
  const seen = new Set<string>();
  const people: DirectoryPerson[] = [];
  for (const item of Array.isArray(body) ? body : []) {
    const record = Object(item) as Record<string, unknown>;
    const email = normalizePersonEmail(record.email);
    const role = PERSON_ROLES.find((candidate) => candidate === record.role);
    if (!email || !role || seen.has(email)) continue;
    seen.add(email);
    people.push({ email, role, name: personDisplayName({ name: typeof record.name === "string" ? record.name : "", email }) });
  }
  return people.sort((a, b) => a.name.localeCompare(b.name) || a.email.localeCompare(b.email));
}

export function loadDirectory(options: { force?: boolean; background?: boolean } = {}): Promise<void> {
  if (loading) return loading;
  if (state.loaded && !options.force) return Promise.resolve();
  loading = api<unknown>("/api/people/directory", { background: options.background ?? false })
    .then((body) => commit({ loaded: true, people: parseDirectory(body) }))
    .catch(() => commit({ loaded: true, people: state.people }))
    .finally(() => { loading = null; });
  return loading;
}

export function directorySnapshot(): DirectoryState {
  return state;
}

export function resetDirectory(): void {
  loading = null;
  commit(EMPTY);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** `fresh` asks again each time the caller appears, so a picker never offers someone who has since left. */
export function useDirectory(options: { fresh?: boolean } = {}): DirectoryState {
  const fresh = options.fresh === true;
  useEffect(() => { void loadDirectory({ force: fresh, background: !fresh }); }, [fresh]);
  return useSyncExternalStore(subscribe, directorySnapshot, () => EMPTY);
}

export function personNamed(people: readonly DirectoryPerson[], email: string | null | undefined): string {
  const address = normalizePersonEmail(email);
  if (!address) return email ?? "";
  return people.find((person) => person.email === address)?.name ?? personDisplayName({ email: address });
}

/** People whose name or address contains every word typed. */
export function matchPeople<T extends { name: string; email: string }>(people: readonly T[], query: string): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [...people];
  return people.filter((person) => {
    const haystack = `${person.name} ${person.email}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}
