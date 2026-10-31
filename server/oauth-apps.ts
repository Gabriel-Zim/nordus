// Nordus's own OAuth apps (Google, GitHub, Slack, HubSpot): the client id and secret the person creates once on each
// platform, and every account connected through them. Sealed under a key of its own (a 0600 file beside it); the
// secret and the tokens never leave the server, and no bot or screen gets them back.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

import { writeFileAtomic } from "./atomic.ts";
import type { BotAccess } from "./bot-audience.ts";
import { decryptBrowserState, encryptBrowserState } from "./browser-sites.ts";
import { AGENTS_NODE_FLAG, SPAWNED_PROXIES } from "./proxy-paths.ts";

export const OAUTH_APP_PROVIDERS = ["google", "github", "slack", "hubspot"] as const;
export type OAuthAppProvider = (typeof OAUTH_APP_PROVIDERS)[number];
/** Providers whose sign-in Nordus runs itself, each coming back to /oauth/<provider>/callback. */
export const SIGN_IN_PROVIDERS = ["google", "github"] as const;
export type SignInProvider = (typeof SIGN_IN_PROVIDERS)[number];
export const oauthCallbackPath = (provider: SignInProvider) => `/oauth/${provider}/callback`;
export const GOOGLE_CALLBACK_PATH = oauthCallbackPath("google");
export const GITHUB_CALLBACK_PATH = oauthCallbackPath("github");

/** Drive, Gmail, Agenda, Docs and Sheets, plus who signed in. */
export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/spreadsheets",
] as const;
export const GITHUB_SCOPES = ["repo", "read:org", "workflow", "read:user", "user:email"] as const;
export const GITHUB_MCP_URL = "https://api.githubcopilot.com/mcp/";

const accountSchema = z.object({
  id: z.string(),
  access: z.string(),
  refresh: z.string().optional(),
  expiresAt: z.number().optional(),
  scope: z.string().optional(),
  account: z.string().optional(),
  connectedAt: z.number(),
  /** Bot ids that may use this account; absent means every bot. */
  bots: z.array(z.string()).optional(),
});
type StoredAccount = z.infer<typeof accountSchema>;
const legacyConnection = accountSchema.omit({ id: true, bots: true });
const appSchema = z.object({
  clientId: z.string().min(1).max(400),
  clientSecret: z.string().min(1).max(400),
  updatedAt: z.number(),
  accounts: z.array(accountSchema).optional(),
  /** Earlier files kept one connection per app; read once, then written as the first account. */
  connection: legacyConnection.optional(),
});
const fileSchema = z.object({ apps: z.record(z.string(), appSchema) });
type StoreFile = z.infer<typeof fileSchema>;

export interface OAuthAccountSummary { id: string; account: string | null; connectedAt: number; bots: string[] | null }
export interface OAuthAppSummary {
  provider: OAuthAppProvider;
  configured: boolean;
  clientId: string | null;
  updatedAt: number | null;
  connected: boolean;
  /** The first account, for screens that show one. */
  account: string | null;
  accounts: OAuthAccountSummary[];
}

export function isOAuthAppProvider(value: string): value is OAuthAppProvider {
  return (OAUTH_APP_PROVIDERS as readonly string[]).includes(value);
}
export function isSignInProvider(value: string): value is SignInProvider {
  return (SIGN_IN_PROVIDERS as readonly string[]).includes(value);
}

function accountsOf(app: z.infer<typeof appSchema> | undefined): StoredAccount[] {
  if (!app) return [];
  const accounts = [...(app.accounts ?? [])];
  if (app.connection && !accounts.some((entry) => entry.access === app.connection!.access)) {
    accounts.unshift({ id: randomUUID(), ...app.connection });
  }
  return accounts;
}

export class OAuthAppStore {
  private readonly file: string;
  private readonly keyFile: string;
  private cache: StoreFile | null = null;

  constructor(dataDir: string) {
    this.file = join(dataDir, "oauth-apps.json.enc");
    this.keyFile = join(dataDir, "oauth-apps-key");
  }

  private key(create: boolean): string | null {
    try {
      const existing = readFileSync(this.keyFile, "utf8").trim();
      if (/^[0-9a-f]{64}$/u.test(existing)) return existing;
    } catch {
    }
    if (!create) return null;
    const key = randomBytes(32).toString("hex");
    mkdirSync(join(this.keyFile, ".."), { recursive: true });
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
        console.warn("oauth apps: the saved app credentials could not be opened; they will be replaced on the next save");
      }
    }
    let migrated = false;
    for (const app of Object.values(data.apps)) {
      if (app.connection) migrated = true;
      app.accounts = accountsOf(app);
      delete app.connection;
    }
    this.cache = data;
    if (migrated) this.write(data);
    return data;
  }

  private write(data: StoreFile): void {
    const parsed = fileSchema.parse(data);
    const key = this.key(true)!;
    mkdirSync(join(this.file, ".."), { recursive: true });
    writeFileAtomic(this.file, encryptBrowserState(JSON.stringify(parsed), key), { mode: 0o600 });
    this.cache = parsed;
  }

  list(): OAuthAppSummary[] {
    const apps = this.read().apps;
    return OAUTH_APP_PROVIDERS.map((provider) => {
      const app = apps[provider];
      const accounts = (app?.accounts ?? []).map((entry) => ({
        id: entry.id, account: entry.account ?? null, connectedAt: entry.connectedAt, bots: entry.bots ?? null,
      }));
      return {
        provider,
        configured: Boolean(app),
        clientId: app?.clientId ?? null,
        updatedAt: app?.updatedAt ?? null,
        connected: accounts.length > 0,
        account: accounts[0]?.account ?? null,
        accounts,
      };
    });
  }

  /** The id is not secret and can change alone; a blank secret keeps the saved one. A new client drops the accounts. */
  set(provider: OAuthAppProvider, clientId: string, clientSecret: string | null): void {
    const data = this.read();
    const current = data.apps[provider];
    const secret = clientSecret?.trim() || current?.clientSecret;
    if (!secret) throw Object.assign(new Error("O segredo do cliente é obrigatório."), { status: 400 });
    const sameClient = current?.clientId === clientId.trim();
    data.apps[provider] = {
      clientId: clientId.trim(),
      clientSecret: secret,
      updatedAt: Date.now(),
      accounts: sameClient ? current?.accounts ?? [] : [],
    };
    this.write(data);
  }

  remove(provider: OAuthAppProvider): void {
    const data = this.read();
    delete data.apps[provider];
    this.write(data);
  }

  credentials(provider: OAuthAppProvider): { clientId: string; clientSecret: string } | null {
    const app = this.read().apps[provider];
    return app ? { clientId: app.clientId, clientSecret: app.clientSecret } : null;
  }

  /** Signing in again with the same account refreshes it in place; a new account is added. */
  addAccount(provider: OAuthAppProvider, account: Omit<StoredAccount, "id" | "bots">): void {
    const data = this.read();
    const app = data.apps[provider];
    if (!app) throw new Error("app not configured");
    const accounts = app.accounts ?? [];
    const same = account.account ? accounts.find((entry) => entry.account === account.account) : undefined;
    app.accounts = same
      ? accounts.map((entry) => entry === same ? { ...entry, ...account } : entry)
      : [...accounts, { id: randomUUID(), ...account }];
    this.write(data);
  }

  removeAccount(provider: OAuthAppProvider, accountId: string): void {
    const data = this.read();
    const app = data.apps[provider];
    if (!app) return;
    app.accounts = (app.accounts ?? []).filter((entry) => entry.id !== accountId);
    this.write(data);
  }

  setAccountBots(provider: OAuthAppProvider, accountId: string, bots: string[] | null): void {
    const data = this.read();
    const entry = data.apps[provider]?.accounts?.find((candidate) => candidate.id === accountId);
    if (!entry) throw Object.assign(new Error("Conta não encontrada."), { status: 404 });
    if (bots === null) delete entry.bots;
    else entry.bots = [...new Set(bots)];
    this.write(data);
  }

  /** The accounts a bot may use for an app, with their tokens: server-side only. An account without its own list of
   * bots reaches internal bots only, never a client's bot. */
  accountsForBot(provider: OAuthAppProvider, bot: BotAccess): StoredAccount[] {
    return (this.read().apps[provider]?.accounts ?? []).filter((entry) => entry.bots ? entry.bots.includes(bot.id) : bot.internal);
  }
}

/** Each GitHub account a bot may use reaches it as the official GitHub MCP server, named by the account. */
export function githubMcpServersForBot(store: OAuthAppStore, bot: BotAccess): Record<string, { type: "http"; url: string; headers: Record<string, string> }> {
  const accounts = store.accountsForBot("github", bot);
  const out: Record<string, { type: "http"; url: string; headers: Record<string, string> }> = {};
  for (const entry of accounts) {
    const name = accounts.length === 1 ? "github" : `github-${(entry.account ?? entry.id).toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 24)}`;
    out[name] = { type: "http", url: GITHUB_MCP_URL, headers: { Authorization: `Bearer ${entry.access}` } };
  }
  return out;
}

const accountSlug = (value: string) => value.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 24);

export interface GoogleMcpServer { command: string; args: string[]; env: Record<string, string>; enabled: true }

/** Each Google account a bot may use reaches it as Nordus's own Google connector, named by the account; it renews its access itself. */
export function googleMcpServersForBot(store: OAuthAppStore, bot: BotAccess): Record<string, GoogleMcpServer> {
  const credentials = store.credentials("google");
  const accounts = store.accountsForBot("google", bot);
  const out: Record<string, GoogleMcpServer> = {};
  if (!credentials) return out;
  const script = SPAWNED_PROXIES.google;
  accounts.forEach((entry, index) => {
    const base = accounts.length === 1 ? "google" : `google-${accountSlug(entry.account ?? "") || index + 1}`;
    out[out[base] ? `${base}-${index + 1}` : base] = {
      command: process.execPath,
      args: script.endsWith(".ts") ? ["--experimental-strip-types", script] : [script],
      env: {
        GOOGLE_ACCOUNT: entry.account ?? "",
        GOOGLE_CLIENT_ID: credentials.clientId,
        GOOGLE_CLIENT_SECRET: credentials.clientSecret,
        GOOGLE_ACCESS_TOKEN: entry.access,
        GOOGLE_REFRESH_TOKEN: entry.refresh ?? "",
        GOOGLE_EXPIRES_AT: String(entry.expiresAt ?? 0),
        ...AGENTS_NODE_FLAG,
      },
      enabled: true,
    };
  });
  return out;
}

interface ProviderSpec {
  authorize: string;
  token: string;
  scopes: readonly string[];
  extra: Record<string, string>;
  /** Who signed in, for the account list. */
  account: (tokens: TokenResponse, fetcher: typeof fetch) => Promise<string | undefined>;
}
interface TokenResponse { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; id_token?: string; error?: string }

const PROVIDERS: Record<SignInProvider, ProviderSpec> = {
  google: {
    authorize: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    scopes: GOOGLE_SCOPES,
    // select_account: never reuse the browser's last Google session silently.
    extra: { access_type: "offline", prompt: "consent select_account", include_granted_scopes: "true" },
    account: async (tokens) => {
      const payload = tokens.id_token?.split(".")[1];
      if (!payload) return undefined;
      try { return (JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { email?: string }).email; } catch { return undefined; }
    },
  },
  github: {
    authorize: "https://github.com/login/oauth/authorize",
    token: "https://github.com/login/oauth/access_token",
    scopes: GITHUB_SCOPES,
    extra: { prompt: "select_account", allow_signup: "false" },
    account: async (tokens, fetcher) => {
      try {
        const response = await fetcher("https://api.github.com/user", {
          headers: { authorization: `Bearer ${tokens.access_token}`, accept: "application/vnd.github+json", "user-agent": "Nordus-AI" },
        });
        return response.ok ? (await response.json() as { login?: string }).login : undefined;
      } catch { return undefined; }
    },
  },
};

/** One sign-in in flight: state is the credential, PKCE binds the code to this server. */
interface Pending { provider: SignInProvider; verifier: string; redirectUri: string; createdAt: number }
const pending = new Map<string, Pending>();
const PENDING_TTL_MS = 10 * 60_000;

function base64url(bytes: Buffer): string {
  return bytes.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function startSignIn(store: OAuthAppStore, provider: SignInProvider, origin: string): string {
  const credentials = store.credentials(provider);
  if (!credentials) throw Object.assign(new Error("Falta cadastrar o app da Nordus nessa plataforma."), { status: 409 });
  for (const [state, entry] of pending) if (Date.now() - entry.createdAt > PENDING_TTL_MS) pending.delete(state);
  const spec = PROVIDERS[provider];
  const state = base64url(randomBytes(24));
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  const redirectUri = `${origin}${oauthCallbackPath(provider)}`;
  pending.set(state, { provider, verifier, redirectUri, createdAt: Date.now() });
  const url = new URL(spec.authorize);
  url.search = new URLSearchParams({
    client_id: credentials.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: spec.scopes.join(" "),
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    ...spec.extra,
  }).toString();
  return url.toString();
}

export async function finishSignIn(
  store: OAuthAppStore,
  provider: SignInProvider,
  search: string,
  fetcher: typeof fetch = fetch,
): Promise<{ status: number; text: string }> {
  const params = new URLSearchParams(search);
  const state = params.get("state") ?? "";
  const flow = pending.get(state);
  if (!flow || flow.provider !== provider || Date.now() - flow.createdAt > PENDING_TTL_MS) {
    return { status: 400, text: "Esta conexão expirou. Volte para a Nordus e tente de novo." };
  }
  pending.delete(state);
  if (params.get("error")) return { status: 400, text: "A conexão foi cancelada. Volte para a Nordus." };
  const code = params.get("code");
  const credentials = store.credentials(provider);
  if (!code || !credentials) return { status: 400, text: "Não deu para concluir a conexão. Volte para a Nordus e tente de novo." };
  const response = await fetcher(PROVIDERS[provider].token, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({
      code,
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      redirect_uri: flow.redirectUri,
      grant_type: "authorization_code",
      code_verifier: flow.verifier,
    }).toString(),
  });
  const tokens = response.ok ? await response.json() as TokenResponse : null;
  if (!tokens?.access_token) return { status: 400, text: "A plataforma recusou a conexão. Volte para a Nordus e tente de novo." };
  const account = await PROVIDERS[provider].account(tokens, fetcher);
  store.addAccount(provider, {
    access: tokens.access_token,
    ...(tokens.refresh_token ? { refresh: tokens.refresh_token } : {}),
    ...(tokens.expires_in ? { expiresAt: Date.now() + tokens.expires_in * 1000 } : {}),
    ...(tokens.scope ? { scope: tokens.scope } : {}),
    ...(account ? { account } : {}),
    connectedAt: Date.now(),
  });
  return { status: 200, text: `Pronto, ${account ?? "conta"} conectada. Pode fechar esta aba e voltar para a Nordus.` };
}
