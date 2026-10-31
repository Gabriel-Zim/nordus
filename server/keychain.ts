// Chaveiro: sites the person signed in to once, in a browser of their own on this server, lent to the bots they choose.
// Each bot keeps its own Chrome; before a bot's browser call its Chrome gets the site's sign-in, and a sign-in the site renewed
// in a bot's Chrome comes back here, so the next bot gets the renewed one. Signing out of a site here takes it out of every bot.
// The sign-in is encrypted with the browser engine's key and never reaches a bot, a page or a screen.
import { createHmac, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";

import { writeFileAtomic } from "./atomic.ts";
import {
  decryptBrowserState,
  encryptBrowserState,
  inSite,
  siteState,
  type BrowserSitesTarget,
  type SavedBrowserState,
} from "./browser-sites.ts";

export interface KeychainEntry {
  id: string;
  /** What the person sees: "Instagram", "httpbin". */
  name: string;
  /** The site the sign-in covers, as wide as its cookies: `instagram.com`. */
  site: string;
  /** Bots that may use it; none until the person turns one on. */
  bots: string[];
  createdAt: string;
  updatedAt: string;
  /** Goes up whenever the stored sign-in changes, so each bot's browser knows when it is behind. */
  version: number;
  /** Keyed digest of the sign-in, to tell a renewal from an unchanged one. */
  digest: string;
}

export type PublicKeychainEntry = Omit<KeychainEntry, "digest">;

const ID = /^[a-z0-9]{12}$/u;
const SITE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/u;

export function isKeychainSite(site: string): boolean {
  return site.length <= 253 && SITE.test(site);
}

/** "accounts.instagram.com" → "instagram.com"; a sign-in in a cookie for `.instagram.com` is wider than the page's host. */
export function keychainSiteFor(host: string, state: SavedBrowserState): string {
  const clean = host.toLowerCase().replace(/^www\./u, "");
  const labels = clean.split(".");
  const domains = new Set<string>();
  for (const cookie of state.cookies) {
    const domain = (cookie as { domain?: unknown })?.domain;
    if (typeof domain === "string") domains.add(domain.replace(/^\./u, "").toLowerCase());
  }
  for (let count = 2; count <= labels.length; count += 1) {
    const candidate = labels.slice(-count).join(".");
    if ([...domains].some((domain) => inSite(domain, candidate))) return candidate;
  }
  const tld2 = labels.length >= 3 && /^(com|co|org|net|gov|edu)$/u.test(labels[labels.length - 2]!) ? 3 : 2;
  return labels.slice(-tld2).join(".");
}

export function keychainNameFor(site: string): string {
  const labels = site.split(".");
  const tld2 = labels.length >= 3 && /^(com|co|org|net|gov|edu)$/u.test(labels[labels.length - 2]!) ? 3 : 2;
  const core = labels[labels.length - tld2] ?? site;
  return core.charAt(0).toUpperCase() + core.slice(1);
}

export class Keychain {
  private readonly dir: string;
  private readonly key: () => string;
  private entries: KeychainEntry[];

  constructor(dataDir: string, key: () => string) {
    this.dir = join(dataDir, "keychain");
    this.key = key;
    this.entries = this.load();
  }

  private load(): KeychainEntry[] {
    try {
      const value = JSON.parse(readFileSync(join(this.dir, "index.json"), "utf8")) as { entries?: unknown };
      return Array.isArray(value.entries) ? value.entries.filter((entry): entry is KeychainEntry => ID.test((entry as KeychainEntry)?.id ?? "")) : [];
    } catch { return []; }
  }

  private persist(): void {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    writeFileAtomic(join(this.dir, "index.json"), `${JSON.stringify({ entries: this.entries }, null, 2)}\n`, { mode: 0o600 });
  }

  private digest(state: SavedBrowserState): string {
    const cookies = state.cookies.map((cookie) => {
      const c = cookie as { name?: unknown; domain?: unknown; path?: unknown; value?: unknown };
      return [c.domain, c.path, c.name, c.value].map(String).join("\u0000");
    }).sort();
    const origins = state.origins.map((origin) => JSON.stringify([(origin as { origin?: unknown }).origin, (origin as { localStorage?: unknown }).localStorage])).sort();
    return createHmac("sha256", this.key()).update(JSON.stringify([cookies, origins])).digest("hex");
  }

  list(): PublicKeychainEntry[] {
    return this.entries.map(({ digest: _digest, ...entry }) => ({ ...entry, bots: [...entry.bots] }));
  }

  get(id: string): KeychainEntry | undefined {
    return this.entries.find((entry) => entry.id === id);
  }

  forBot(botId: string): KeychainEntry[] {
    return this.entries.filter((entry) => entry.bots.includes(botId));
  }

  /** The stored sign-in; read only on this server, to hand it to a bot's browser. */
  state(id: string): SavedBrowserState | null {
    const entry = this.get(id);
    if (!entry) return null;
    try {
      const value = JSON.parse(decryptBrowserState(readFileSync(join(this.dir, `${id}.enc`)), this.key())) as SavedBrowserState;
      return Array.isArray(value?.cookies) && Array.isArray(value?.origins) ? value : null;
    } catch { return null; }
  }

  private writeState(id: string, state: SavedBrowserState): void {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    writeFileAtomic(join(this.dir, `${id}.enc`), encryptBrowserState(JSON.stringify(state), this.key()), { mode: 0o600 });
  }

  /** A new sign-in for `site`; signing in again to a site already here replaces its sign-in and keeps who may use it. */
  save(input: { site: string; name?: string; state: SavedBrowserState }): KeychainEntry {
    if (!isKeychainSite(input.site)) throw new Error("Endereço de site inválido.");
    const part = siteState(input.state, input.site);
    if (!part.cookies.length && !part.origins.length) throw new Error("Nenhum login foi encontrado nesse site. Entre na conta e tente de novo.");
    const now = new Date().toISOString();
    const existing = this.entries.find((entry) => entry.site === input.site);
    const entry: KeychainEntry = existing
      ? { ...existing, name: input.name?.trim() || existing.name, updatedAt: now, version: existing.version + 1, digest: this.digest(part) }
      : { id: randomBytes(9).toString("base64url").toLowerCase().replace(/[^a-z0-9]/gu, "0").slice(0, 12), name: input.name?.trim() || keychainNameFor(input.site), site: input.site, bots: [], createdAt: now, updatedAt: now, version: 1, digest: this.digest(part) };
    this.writeState(entry.id, part);
    this.entries = existing ? this.entries.map((candidate) => candidate.id === entry.id ? entry : candidate) : [...this.entries, entry];
    this.persist();
    return entry;
  }

  /** A sign-in a bot's browser came back with; a new version only when the site actually changed it. */
  renew(id: string, state: SavedBrowserState): KeychainEntry | null {
    const entry = this.get(id);
    if (!entry) return null;
    const part = siteState(state, entry.site);
    if (!part.cookies.length) return null;
    const digest = this.digest(part);
    if (digest === entry.digest) return null;
    const next = { ...entry, version: entry.version + 1, digest, updatedAt: new Date().toISOString() };
    this.writeState(id, part);
    this.entries = this.entries.map((candidate) => candidate.id === id ? next : candidate);
    this.persist();
    return next;
  }

  setBots(id: string, bots: string[]): KeychainEntry | null {
    const entry = this.get(id);
    if (!entry) return null;
    const next = { ...entry, bots: [...new Set(bots)] };
    this.entries = this.entries.map((candidate) => candidate.id === id ? next : candidate);
    this.persist();
    return next;
  }

  rename(id: string, name: string): KeychainEntry | null {
    const entry = this.get(id);
    const clean = name.trim().slice(0, 60);
    if (!entry || !clean) return null;
    const next = { ...entry, name: clean };
    this.entries = this.entries.map((candidate) => candidate.id === id ? next : candidate);
    this.persist();
    return next;
  }

  remove(id: string): KeychainEntry | null {
    const entry = this.get(id);
    if (!entry) return null;
    this.entries = this.entries.filter((candidate) => candidate.id !== id);
    this.persist();
    try { unlinkSync(join(this.dir, `${id}.enc`)); } catch {}
    return entry;
  }

  /** A deleted bot loses its place on every site. */
  forgetBot(botId: string): void {
    if (!this.entries.some((entry) => entry.bots.includes(botId))) return;
    this.entries = this.entries.map((entry) => ({ ...entry, bots: entry.bots.filter((bot) => bot !== botId) }));
    this.persist();
  }

  exists(): boolean { return existsSync(this.dir); }
}

export interface KeychainBrowserDeps {
  /** The bot's own browser, or null when it has none (temporary browser, the person's Chrome, browser off). */
  target: (botId: string) => BrowserSitesTarget | null;
  running: (target: BrowserSitesTarget) => Promise<SavedBrowserState | null>;
  load: (target: BrowserSitesTarget, part: SavedBrowserState) => Promise<boolean>;
  replaceSaved: (target: BrowserSitesTarget, site: string, part: SavedBrowserState | null) => void;
  signOut: (target: BrowserSitesTarget, site: string) => Promise<unknown>;
  log?: (line: string) => void;
}

/** Which version of each site every bot's browser holds, kept in memory: after a restart each bot gets the current one again. */
export class KeychainBrowsers {
  private readonly held = new Map<string, Map<string, number>>();
  private readonly inFlight = new Map<string, number>();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly settleMs: number;
  private readonly keychain: Keychain;
  private readonly deps: KeychainBrowserDeps;

  constructor(keychain: Keychain, deps: KeychainBrowserDeps, options: { settleMs?: number } = {}) {
    this.keychain = keychain;
    this.deps = deps;
    this.settleMs = options.settleMs ?? 4_000;
  }

  private heldBy(session: string): Map<string, number> {
    let held = this.held.get(session);
    if (!held) this.held.set(session, held = new Map());
    return held;
  }

  /** Before a bot's browser call: every site it may use, at the current version, in its own Chrome. */
  async before(botId: string): Promise<void> {
    const target = this.deps.target(botId);
    if (!target) return;
    this.inFlight.set(target.session, (this.inFlight.get(target.session) ?? 0) + 1);
    const held = this.heldBy(target.session);
    for (const entry of this.keychain.forBot(botId)) {
      if (held.get(entry.id) === entry.version) continue;
      const part = this.keychain.state(entry.id);
      if (!part) continue;
      try {
        if (!await this.deps.load(target, part)) this.deps.replaceSaved(target, entry.site, part);
        held.set(entry.id, entry.version);
      } catch (error) {
        this.deps.log?.(`chaveiro: não entregou ${entry.site} ao navegador de ${botId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  /** After the call: once the browser settles, a sign-in the site renewed goes back to the keychain. */
  after(botId: string): void {
    const target = this.deps.target(botId);
    if (!target) return;
    const left = Math.max(0, (this.inFlight.get(target.session) ?? 1) - 1);
    this.inFlight.set(target.session, left);
    if (left > 0 || !this.keychain.forBot(botId).length) return;
    clearTimeout(this.timers.get(target.session));
    const timer = setTimeout(() => {
      this.timers.delete(target.session);
      if ((this.inFlight.get(target.session) ?? 0) > 0) return;
      void this.collect(botId).catch((error) => this.deps.log?.(`chaveiro: não leu o navegador de ${botId}: ${error instanceof Error ? error.message : String(error)}`));
    }, this.settleMs);
    timer.unref?.();
    this.timers.set(target.session, timer);
  }

  /** Reads the bot's running browser and keeps any renewed sign-in; exported for tests and for a bot's last call. */
  async collect(botId: string): Promise<string[]> {
    const target = this.deps.target(botId);
    if (!target) return [];
    const entries = this.keychain.forBot(botId);
    if (!entries.length) return [];
    const live = await this.deps.running(target);
    if (!live) return [];
    const held = this.heldBy(target.session);
    const renewed: string[] = [];
    for (const entry of entries) {
      // A browser behind the current version still has the old sign-in: that is not a renewal.
      if (held.get(entry.id) !== entry.version) continue;
      const next = this.keychain.renew(entry.id, live);
      if (next) { held.set(entry.id, next.version); renewed.push(entry.site); }
    }
    return renewed;
  }

  /** A bot that may no longer use a site loses it from its browser too. */
  async revoke(botId: string, entry: Pick<KeychainEntry, "id" | "site">): Promise<void> {
    const target = this.deps.target(botId);
    this.forget(botId, entry.id);
    if (target) await this.deps.signOut(target, entry.site);
  }

  /** Signing out of a site: gone from the keychain's bots, and from every bot's browser, used or not. */
  async signOutEverywhere(entry: Pick<KeychainEntry, "id" | "site">, botIds: string[]): Promise<string[]> {
    const failed: string[] = [];
    for (const held of this.held.values()) held.delete(entry.id);
    await Promise.all(botIds.map(async (botId) => {
      const target = this.deps.target(botId);
      if (!target) return;
      try { await this.deps.signOut(target, entry.site); }
      catch (error) {
        failed.push(botId);
        this.deps.log?.(`chaveiro: não saiu de ${entry.site} no navegador de ${botId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }));
    return failed;
  }

  forget(botId: string, entryId?: string): void {
    const target = this.deps.target(botId);
    if (!target) return;
    if (entryId) this.held.get(target.session)?.delete(entryId);
    else this.held.delete(target.session);
  }

  /** The browser closed or restarted: it restores its saved state, which may be older than the keychain's. */
  browserClosed(session: string): void { this.held.delete(session); }
}
