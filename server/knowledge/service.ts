import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { KnowledgeSpaceId, WireKnowledgeSpace } from "../../shared/knowledge.ts";
import { writeFileAtomic } from "../atomic.ts";
import { clientSpace, describeSpace, INTERNAL_SPACE, parseSpace } from "./audience.ts";
import { DriveApi } from "./drive-api.ts";
import { KnowledgeError } from "./errors.ts";
import { DEFAULT_KNOWLEDGE_LIMITS, type KnowledgeLimits } from "./limits.ts";
import { ObsidianImports } from "./obsidian-import.ts";
import { KnowledgeSpace } from "./space.ts";
import { WikiApi } from "./wiki-api.ts";
import type { Requester } from "./wire.ts";

const MAINTENANCE_MS = 60 * 60_000;
const INTERNAL_PEOPLE_MAX = 200;
const ADDRESS = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;

export interface KnowledgeSession {
  space: KnowledgeSpace;
  who: Requester;
  drive: DriveApi;
  wiki: WikiApi;
}

export interface KnowledgeServiceOptions {
  /** Folder that holds every space: `internal/` and `clients/<name>/`. */
  root: string;
  limits?: KnowledgeLimits;
}

/** The door to the Drive and the Wiki: a space is only ever opened for an asker who is allowed in it. */
export class KnowledgeService {
  readonly limits: KnowledgeLimits;
  readonly imports: ObsidianImports;
  private readonly root: string;
  private readonly spaces = new Map<KnowledgeSpaceId, KnowledgeSpace>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private people: string[] | null = null;

  constructor(options: KnowledgeServiceOptions) {
    this.root = options.root;
    this.limits = options.limits ?? DEFAULT_KNOWLEDGE_LIMITS;
    this.imports = new ObsidianImports(this.limits);
  }

  /** Spaces that already hold something on disk, even when no bot points to them any more. */
  knownSpaces(): KnowledgeSpaceId[] {
    const found: KnowledgeSpaceId[] = [];
    if (existsSync(join(this.root, "internal"))) found.push(INTERNAL_SPACE);
    const clients = join(this.root, "clients");
    if (existsSync(clients)) {
      for (const entry of readdirSync(clients, { withFileTypes: true })) {
        const id = entry.isDirectory() ? clientSpace(entry.name) : null;
        if (id) found.push(id);
      }
    }
    return found;
  }

  describe(who: Requester): WireKnowledgeSpace[] {
    return who.access.spaces().map(describeSpace);
  }

  /** The people an admin opened the company's space to. A file that cannot be read opens it to nobody. */
  internalPeople(): readonly string[] {
    if (this.people === null) {
      try {
        const parsed = JSON.parse(readFileSync(join(this.root, "settings.json"), "utf8")) as { internalPeople?: unknown };
        this.people = Array.isArray(parsed.internalPeople) ? parsed.internalPeople.filter((entry): entry is string => typeof entry === "string" && entry.length <= 320 && ADDRESS.test(entry)) : [];
      } catch {
        this.people = [];
      }
    }
    return this.people;
  }

  /** Whole addresses only, so no list can name a domain or "everyone". */
  setInternalPeople(entries: unknown): string[] {
    if (!Array.isArray(entries) || entries.some((entry) => typeof entry !== "string")) throw new KnowledgeError("bad_input", "send a list of email addresses");
    const people = [...new Set((entries as string[]).map((entry) => entry.trim().toLowerCase()).filter(Boolean))];
    const bad = people.find((entry) => entry.length > 320 || !ADDRESS.test(entry));
    if (bad !== undefined) throw new KnowledgeError("bad_input", "each entry must be one full email address", { entry: bad.slice(0, 80) });
    if (people.length > INTERNAL_PEOPLE_MAX) throw new KnowledgeError("limit", `at most ${INTERNAL_PEOPLE_MAX} people can be named`, { max: INTERNAL_PEOPLE_MAX });
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    writeFileAtomic(join(this.root, "settings.json"), JSON.stringify({ version: 1, internalPeople: people }), { mode: 0o600 });
    this.people = people;
    return [...people];
  }

  private open(id: KnowledgeSpaceId): KnowledgeSpace {
    let space = this.spaces.get(id);
    if (!space) {
      space = new KnowledgeSpace(this.root, id, this.limits, () => this.imports.pinned());
      this.spaces.set(id, space);
    }
    return space;
  }

  /** Without a requested space the first one the asker may use; asking for one they may not use is refused the same way as one that does not exist. */
  use(who: Requester, requested?: unknown): KnowledgeSession {
    const asked = typeof requested === "string" && requested !== "";
    const wanted = asked ? parseSpace(requested) : (who.access.spaces()[0] ?? null);
    if (!wanted || !who.access.allows(wanted)) throw new KnowledgeError("no_space", !asked && who.access.closed ? who.access.closed : "you do not have access to this space");
    return this.session(who, wanted);
  }

  /** The space the server itself picked for a conversation: an admin opens it even while it is still empty, anyone else only when it is already theirs. */
  useDecided(who: Requester, space: KnowledgeSpaceId): KnowledgeSession {
    if (!who.access.admin && !who.access.allows(space)) throw new KnowledgeError("no_space", "you do not have access to this space");
    return this.session(who, space);
  }

  private session(who: Requester, id: KnowledgeSpaceId): KnowledgeSession {
    const space = this.open(id);
    return { space, who, drive: new DriveApi(space, who), wiki: new WikiApi(space, who) };
  }

  maintain(now = Date.now()): void {
    this.imports.expire(now);
    for (const space of this.spaces.values()) {
      try {
        space.collect(now);
      } catch (error) {
        console.error(`[knowledge] clean-up of ${space.id} failed:`, error instanceof Error ? error.message : error);
      }
    }
  }

  startMaintenance(everyMs = MAINTENANCE_MS): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.maintain(), everyMs);
    this.timer.unref();
  }

  stopMaintenance(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
