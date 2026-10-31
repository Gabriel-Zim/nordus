// Google accounts that tried to sign in and are not on the owner's list yet. Only verified identities are recorded.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

import { writeFileAtomic } from "./atomic.ts";

export const WAITLIST_FILE = "waitlist.json";
export const WAITLIST_MAX = 2000;

const entrySchema = z.object({
  email: z.string().min(3).max(320),
  name: z.string().max(80).nullable(),
  firstAt: z.number(),
  lastAt: z.number(),
  attempts: z.number().int().min(1),
});
const fileSchema = z.object({ version: z.literal(1), entries: z.array(entrySchema) });
export type WaitlistEntry = z.infer<typeof entrySchema>;

export class WaitlistStore {
  private readonly file: string;
  private readonly now: () => number;
  private cache: WaitlistEntry[] | undefined;

  constructor(dataDir: string, options: { now?: () => number } = {}) {
    this.file = join(dataDir, WAITLIST_FILE);
    this.now = options.now ?? Date.now;
  }

  private read(): WaitlistEntry[] {
    if (this.cache) return this.cache;
    let entries: WaitlistEntry[] = [];
    if (existsSync(this.file)) {
      try {
        entries = fileSchema.parse(JSON.parse(readFileSync(this.file, "utf8"))).entries;
      } catch {
        console.warn("waitlist: the saved file could not be read; starting empty");
      }
    }
    this.cache = entries;
    return entries;
  }

  private write(entries: WaitlistEntry[]): void {
    mkdirSync(join(this.file, ".."), { recursive: true, mode: 0o700 });
    writeFileAtomic(this.file, `${JSON.stringify({ version: 1, entries })}\n`, { mode: 0o600 });
    this.cache = entries;
  }

  /** Records one more attempt by an already verified Google identity; past the cap a new address is dropped silently. */
  request(rawEmail: string, name: string | null): void {
    const email = rawEmail.trim().toLowerCase();
    if (!email.includes("@") || email.length > 320) return;
    const at = this.now();
    const entries = this.read();
    const existing = entries.find((entry) => entry.email === email);
    if (existing) {
      this.write(entries.map((entry) => (entry === existing
        ? { ...entry, name: name ?? entry.name, lastAt: at, attempts: entry.attempts + 1 }
        : entry)));
      return;
    }
    if (entries.length >= WAITLIST_MAX) return;
    this.write([...entries, { email, name: name?.slice(0, 80) ?? null, firstAt: at, lastAt: at, attempts: 1 }]);
  }

  list(): WaitlistEntry[] {
    return [...this.read()].sort((a, b) => b.lastAt - a.lastAt);
  }

  remove(rawEmail: string): boolean {
    const email = rawEmail.trim().toLowerCase();
    const entries = this.read();
    if (!entries.some((entry) => entry.email === email)) return false;
    this.write(entries.filter((entry) => entry.email !== email));
    return true;
  }
}
