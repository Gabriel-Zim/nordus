// Who works here, for pickers and @colega: the addresses on the sign-in lists plus anyone who signed in under a @domain entry,
// with the name each gave. No spend, no last-seen. A guest sees only the people who share a room with them.
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { normalizePersonEmail, personDisplayName, type DirectoryPerson, type PersonRole } from "../shared/people.ts";
import { roleOfEmail, type SignInAllowList } from "./account-signin.ts";
import { writeFileAtomic } from "./atomic.ts";
import { isJsonObject, readJsonState } from "./state-file.ts";

const MAX_NAMES = 5_000;

export interface DirectoryDeps {
  file: string;
  lists(): SignInAllowList;
  /** Addresses of everyone signed in now, with the names they gave. */
  signedIn(): Array<{ email?: string; name?: string }>;
  /** The workspace owner, who may use the desktop without signing in with an address. */
  profile(): { email?: string; name?: string };
  /** Whether two people are both listed on one room. */
  shareRoom(a: string, b: string): boolean;
}

export interface DirectoryViewer {
  email?: string;
  admin: boolean;
  guest: boolean;
}

export class PeopleDirectory {
  private readonly deps: DirectoryDeps;
  private names = new Map<string, string>();
  private saving: NodeJS.Timeout | null = null;

  constructor(deps: DirectoryDeps) {
    this.deps = deps;
    const saved = readJsonState(deps.file, isJsonObject);
    if (saved.status === "ok") {
      for (const [email, name] of Object.entries(saved.value)) if (typeof name === "string" && name.trim()) this.names.set(email, name.trim());
    }
  }

  remember(rawEmail: string | undefined, name: string | undefined): void {
    const email = normalizePersonEmail(rawEmail);
    const clean = name?.trim().slice(0, 120);
    if (!email || !clean || this.names.get(email) === clean) return;
    if (this.names.size >= MAX_NAMES && !this.names.has(email)) return;
    this.names.set(email, clean);
    if (this.saving) return;
    this.saving = setTimeout(() => this.flush(), 500);
    this.saving.unref();
  }

  flush(): void {
    if (this.saving) clearTimeout(this.saving);
    this.saving = null;
    mkdirSync(dirname(this.deps.file), { recursive: true, mode: 0o700 });
    writeFileAtomic(this.deps.file, JSON.stringify(Object.fromEntries(this.names)), { mode: 0o600, durable: false });
  }

  nameOf(rawEmail: string): string {
    const email = normalizePersonEmail(rawEmail) ?? rawEmail;
    const profile = this.deps.profile();
    if (profile.email && normalizePersonEmail(profile.email) === email && profile.name?.trim()) return profile.name.trim();
    return personDisplayName({ name: this.names.get(email), email });
  }

  roleOf(rawEmail: string): PersonRole | null {
    const email = normalizePersonEmail(rawEmail);
    if (!email) return null;
    const profile = normalizePersonEmail(this.deps.profile().email);
    return roleOfEmail(email, this.deps.lists()) ?? (profile === email ? "admin" : null);
  }

  /** Everyone with a role here, as an admin or member sees them. */
  everyone(): DirectoryPerson[] {
    const lists = this.deps.lists();
    const seen = new Set<string>();
    const add = (raw: unknown) => {
      const email = normalizePersonEmail(raw);
      if (email) seen.add(email);
    };
    for (const entry of [...lists.admins, ...lists.members, ...(lists.guests ?? [])]) if (!entry.startsWith("@")) add(entry);
    for (const person of this.deps.signedIn()) add(person.email);
    add(this.deps.profile().email);
    for (const email of this.names.keys()) add(email);
    const people: DirectoryPerson[] = [];
    for (const email of seen) {
      const role = this.roleOf(email);
      if (role) people.push({ email, name: this.nameOf(email), role });
    }
    return people.sort((a, b) => a.name.localeCompare(b.name) || a.email.localeCompare(b.email));
  }

  forViewer(viewer: DirectoryViewer): DirectoryPerson[] {
    const everyone = this.everyone();
    if (!viewer.guest) return everyone;
    const me = viewer.email;
    if (!me) return [];
    return everyone.filter((person) => person.email === me || this.deps.shareRoom(me, person.email));
  }

  /** Whether `viewer` may pick `email` as someone to write to. */
  mayReach(viewer: DirectoryViewer, email: string): boolean {
    return this.forViewer(viewer).some((person) => person.email === email);
  }
}

