// Apps that connect with a key or token the person pastes or authorizes (ManyChat, Figma, Trello). Every
// account is sealed under a key of its own (a 0600 file beside it); keys and tokens never leave the server, and the
// screens only get the account names back.
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";

import { writeFileAtomic } from "./atomic.ts";
import type { BotAccess } from "./bot-audience.ts";
import { decryptBrowserState, encryptBrowserState } from "./browser-sites.ts";
import { AGENTS_NODE_FLAG, SPAWNED_PROXIES } from "./proxy-paths.ts";

export const KEY_APPS = ["manychat", "figma", "trello"] as const;
export type KeyApp = (typeof KEY_APPS)[number];
export const isKeyApp = (value: string): value is KeyApp => (KEY_APPS as readonly string[]).includes(value);

/** Framelink MCP for Figma (MIT, github.com/GLips/Figma-Context-MCP), pinned. */
export const FIGMA_MCP_PACKAGE = "figma-developer-mcp@0.13.2";

const accountSchema = z.object({
  id: z.string(),
  label: z.string().max(200).optional(),
  fields: z.record(z.string(), z.string().max(4_000)),
  connectedAt: z.number(),
  /** Bot ids that may use this account; absent means every bot. */
  bots: z.array(z.string()).optional(),
});
type StoredAccount = z.infer<typeof accountSchema>;
const fileSchema = z.object({
  apps: z.record(z.string(), z.object({ accounts: z.array(accountSchema) })),
  /** Nordus's own Trello API key (Power-Up admin); public by Trello's design, kept here beside the tokens it signs. */
  trelloKey: z.string().max(200).optional(),
});
type StoreFile = z.infer<typeof fileSchema>;

export interface KeyAccountSummary { id: string; label: string | null; connectedAt: number; bots: string[] | null }
export interface KeyAppSummary { app: KeyApp; accounts: KeyAccountSummary[] }

export class KeyVault {
  private readonly file: string;
  private readonly keyFile: string;
  private cache: StoreFile | null = null;

  constructor(dataDir: string) {
    this.file = join(dataDir, "key-connectors.json.enc");
    this.keyFile = join(dataDir, "key-connectors-key");
  }

  private key(create: boolean): string | null {
    try {
      const existing = readFileSync(this.keyFile, "utf8").trim();
      if (/^[0-9a-f]{64}$/u.test(existing)) return existing;
    } catch {
    }
    if (!create) return null;
    const key = randomBytes(32).toString("hex");
    mkdirSync(dirname(this.keyFile), { recursive: true });
    writeFileAtomic(this.keyFile, `${key}\n`, { mode: 0o600 });
    return key;
  }

  private read(): StoreFile {
    if (this.cache) return this.cache;
    let data: StoreFile = { apps: {} };
    if (existsSync(this.file)) {
      const key = this.key(false);
      try {
        if (!key) throw new Error("missing key");
        data = fileSchema.parse(JSON.parse(decryptBrowserState(readFileSync(this.file), key)));
      } catch {
        // Never log an unreadable file's contents.
        console.warn("key connectors: the saved keys could not be opened; they will be replaced on the next save");
      }
    }
    this.cache = data;
    return data;
  }

  private write(data: StoreFile): void {
    const parsed = fileSchema.parse(data);
    const key = this.key(true)!;
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileAtomic(this.file, encryptBrowserState(JSON.stringify(parsed), key), { mode: 0o600 });
    this.cache = parsed;
  }

  list(): { apps: KeyAppSummary[]; trelloReady: boolean } {
    const data = this.read();
    return {
      apps: KEY_APPS.map((app) => ({
        app,
        accounts: (data.apps[app]?.accounts ?? []).map((entry) => ({ id: entry.id, label: entry.label ?? null, connectedAt: entry.connectedAt, bots: entry.bots ?? null })),
      })),
      trelloReady: Boolean(data.trelloKey),
    };
  }

  /** The same account (same label) connected again replaces its key in place and keeps its bots. */
  addAccount(app: KeyApp, fields: Record<string, string>, label?: string): string {
    const data = structuredClone(this.read());
    const accounts = data.apps[app]?.accounts ?? [];
    const same = label ? accounts.find((entry) => entry.label === label) : undefined;
    const id = same?.id ?? randomUUID();
    const next: StoredAccount = { id, ...(label ? { label } : {}), fields, connectedAt: Date.now(), ...(same?.bots ? { bots: same.bots } : {}) };
    data.apps[app] = { accounts: same ? accounts.map((entry) => entry.id === id ? next : entry) : [...accounts, next] };
    this.write(data);
    return id;
  }

  removeAccount(app: KeyApp, id: string): void {
    const data = structuredClone(this.read());
    const accounts = data.apps[app]?.accounts ?? [];
    data.apps[app] = { accounts: accounts.filter((entry) => entry.id !== id) };
    this.write(data);
  }

  setAccountBots(app: KeyApp, id: string, bots: string[] | null): void {
    const data = structuredClone(this.read());
    const account = data.apps[app]?.accounts.find((entry) => entry.id === id);
    if (!account) throw Object.assign(new Error("Essa conta não está mais conectada."), { status: 404 });
    if (bots === null) delete account.bots; else account.bots = [...new Set(bots)];
    this.write(data);
  }

  trelloKey(): string | null {
    return this.read().trelloKey ?? null;
  }

  setTrelloKey(key: string | null): void {
    const data = structuredClone(this.read());
    if (key) data.trelloKey = key; else delete data.trelloKey;
    this.write(data);
  }

  /** An account without its own list of bots reaches internal bots only, never a client's bot. */
  accountsForBot(app: KeyApp, bot: BotAccess): StoredAccount[] {
    return (this.read().apps[app]?.accounts ?? []).filter((entry) => entry.bots ? entry.bots.includes(bot.id) : bot.internal);
  }
}

export interface StdioServer { command: string; args: string[]; env: Record<string, string> }

function nodeScript(script: string): { command: string; args: string[] } {
  return { command: process.execPath, args: script.endsWith(".ts") ? ["--experimental-strip-types", script] : [script] };
}

function npxCommand(): { command: string; pathDir: string } {
  const pathDir = dirname(process.execPath);
  const beside = join(pathDir, "npx");
  return { command: existsSync(beside) ? beside : "npx", pathDir };
}

export function launchFor(app: KeyApp, fields: Record<string, string>, trelloKey: string | null): StdioServer | null {
  if (app === "manychat") return { ...nodeScript(SPAWNED_PROXIES.manychat), env: { MANYCHAT_API_KEY: fields.apiKey ?? "", ...AGENTS_NODE_FLAG } };
  if (app === "trello") {
    if (!trelloKey) return null;
    return { ...nodeScript(SPAWNED_PROXIES.trello), env: { TRELLO_API_KEY: trelloKey, TRELLO_TOKEN: fields.token ?? "", ...AGENTS_NODE_FLAG } };
  }
  const npx = npxCommand();
  // Image downloads write to any folder the model names; bots read designs only.
  return {
    command: npx.command,
    args: ["-y", FIGMA_MCP_PACKAGE, "--stdio", "--skip-image-downloads"],
    env: { FIGMA_API_KEY: fields.token ?? "", FRAMELINK_TELEMETRY: "off", DO_NOT_TRACK: "1", PATH: `${npx.pathDir}:${process.env.PATH ?? "/usr/bin:/bin"}` },
  };
}

const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 24);

export function keyMcpServersForBot(vault: KeyVault, bot: BotAccess): Record<string, StdioServer & { enabled: true }> {
  const out: Record<string, StdioServer & { enabled: true }> = {};
  const trelloKey = vault.trelloKey();
  for (const app of KEY_APPS) {
    const accounts = vault.accountsForBot(app, bot);
    accounts.forEach((entry, index) => {
      const launch = launchFor(app, entry.fields, trelloKey);
      if (!launch) return;
      const name = accounts.length === 1 ? app : `${app}-${slug(entry.label ?? "") || index + 1}`;
      out[out[name] ? `${name}-${index + 1}` : name] = { ...launch, enabled: true };
    });
  }
  return out;
}

/** Keys saved by earlier versions straight into config.json move into the vault once. */
export function migrateConfigKeys(servers: Record<string, unknown>, vault: KeyVault): Record<string, unknown> | null {
  let next: Record<string, unknown> | null = null;
  const envOf = (id: string) => (servers[id] as { env?: Record<string, string> } | undefined)?.env;
  const manychat = envOf("manychat");
  if (manychat?.MANYCHAT_API_KEY) {
    vault.addAccount("manychat", { apiKey: manychat.MANYCHAT_API_KEY });
    next = { ...(next ?? servers) };
    delete next.manychat;
  }
  return next;
}
