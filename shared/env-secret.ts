/**
 * Nordus: a key the bot asks for by its environment variable name (CLOUDFLARE_API_TOKEN, APIFY_TOKEN…), beyond the
 * fixed credential ids. The person types it into a hidden field on the card; it is saved in the settings (section
 * botEnv, where Settings shows its name) and handed to the bot's next runs as that variable. The value never enters
 * the chat, the model's context or a log.
 */

/** The `target` of a secret card that asks for an environment variable instead of a fixed credential id. */
export const ENV_SECRET_TARGET = "env" as const;
export type EnvSecretTarget = typeof ENV_SECRET_TARGET;
export type EnvSecretScope = "bot" | "shared";

export const ENV_SECRET_NAME = /^[A-Z][A-Z0-9_]{1,63}$/;
export const ENV_SECRET_VALUE_MAX = 8_192;
/** Saved keys one bot can carry; past this a save is refused instead of growing the environment. */
export const ENV_SECRET_LIMIT = 100;

/** Names the shell, the runtime or the engine itself reads: a value there would change how the bot runs, not what it can reach. */
const FORBIDDEN_NAMES = new Set([
  "PATH", "HOME", "USER", "LOGNAME", "SHELL", "PWD", "OLDPWD", "TMPDIR", "TMP", "TEMP", "TERM", "LANG", "LANGUAGE", "TZ",
  "ENV", "BASH_ENV", "IFS", "PS1", "PS2", "PS4", "PROMPT_COMMAND", "CDPATH", "GLOBIGNORE", "HISTFILE", "MAIL", "MAILPATH",
  "EDITOR", "VISUAL", "PAGER", "BROWSER", "DISPLAY", "WAYLAND_DISPLAY", "SSH_AUTH_SOCK", "SSH_ASKPASS", "SUDO_ASKPASS",
  "PYTHONPATH", "PYTHONHOME", "PYTHONSTARTUP", "PYTHONUSERBASE", "PERL5LIB", "PERL5OPT", "PERLLIB", "RUBYOPT", "RUBYLIB",
  "GEM_HOME", "GEM_PATH", "CLASSPATH", "JAVA_TOOL_OPTIONS", "JDK_JAVA_OPTIONS", "_JAVA_OPTIONS", "GOPATH", "GOFLAGS",
  "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "FTP_PROXY",
  "SSL_CERT_FILE", "SSL_CERT_DIR", "REQUESTS_CA_BUNDLE", "CURL_CA_BUNDLE", "CURL_HOME", "WGETRC",
  "CLAUDECODE", "BOT_ID", "THREAD_ID",
  // Provider keys the engines read as their own billing identity: a pasted one would move a subscription onto API billing.
  "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "XAI_API_KEY", "MISTRAL_API_KEY",
  "CEREBRAS_API_KEY", "GROQ_API_KEY", "META_API_KEY", "CLINE_API_KEY", "FACTORY_API_KEY", "KIMI_API_KEY",
  "MOONSHOT_API_KEY", "MINIMAX_API_KEY", "CURSOR_API_KEY", "CURSOR_AUTH_TOKEN", "OPENCODE_API_KEY", "BOX_TOKEN",
  "COMPOSIO_API_KEY", "OPENAI_COMPAT_API_KEY", "OPENAI_COMPAT_URL", "OPENROUTER_API_KEY",
]);

/** Families of names owned by the loader, the runtimes, the engines or Nordus itself. */
const FORBIDDEN_PREFIXES = [
  "LD_", "DYLD_", "LC_", "BASH_", "ZSH_", "XDG_", "NODE_", "NPM_CONFIG_", "ELECTRON_", "GIT_", "SSH_", "SUDO_",
  "NORDUS_", "CLAUDE_", "ANTHROPIC_", "CODEX_", "OPENCODE_", "GEMINI_", "GROK_",
  "XAI_", "CURSOR_", "PI_", "AGY_", "ANTIGRAVITY_", "MCP_", "DWEB_",
];

/** Why this name cannot hold a saved key, in the words the bot gets back; undefined when it can. */
export function envSecretNameRefusal(name: unknown): string | undefined {
  if (typeof name !== "string" || !ENV_SECRET_NAME.test(name)) {
    return "env_name must be the variable the tool reads: capital letters, digits and _, starting with a letter, 2 to 64 characters, such as CLOUDFLARE_API_TOKEN.";
  }
  if (FORBIDDEN_NAMES.has(name) || FORBIDDEN_PREFIXES.some((prefix) => name.startsWith(prefix))) {
    return `${name} is reserved by the system or by the engine you run on, so it cannot hold a saved key. Pick the name the service's own tool documents, such as CLOUDFLARE_API_TOKEN.`;
  }
  return undefined;
}

export const isEnvSecretName = (name: unknown): name is string => envSecretNameRefusal(name) === undefined;

/** The value as saved: trimmed, one line, no control characters, within the size limit. */
export function cleanEnvSecretValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > ENV_SECRET_VALUE_MAX) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/u.test(trimmed)) return null;
  return trimmed;
}

export const envSecretScope = (value: unknown): EnvSecretScope => (value === "shared" ? "shared" : "bot");

/** The card's short explanation: the bot's own purpose line, then where the key goes. */
export function envSecretDescription(purpose: string, scope: EnvSecretScope, botName: string): string {
  const where = scope === "shared"
    ? "Fica salva nas Configurações para os robôs da casa."
    : `Fica salva nas Configurações, só para ${botName}.`;
  const lead = purpose.trim().replace(/\s+/g, " ").replace(/[.\s]+$/u, "");
  return `${lead ? `${lead}. ` : ""}${where} Ninguém lê a chave de volta, nem a conversa.`;
}

/** Adds the saved keys to an engine's environment, re-checking each name so a bad entry never reaches a process. */
export function applySecretEnv(env: Record<string, string | undefined>, secretEnv: Record<string, string> | undefined): void {
  if (!secretEnv) return;
  for (const [name, value] of Object.entries(secretEnv)) {
    if (isEnvSecretName(name) && cleanEnvSecretValue(value) === value) env[name] = value;
  }
}

/** Nordus: the keys live in the settings (config.json, owner-only), section `botEnv`. `env` holds the values (an audit row
 * hides anything under an `env` map); `bots` limits a key to some bots, otherwise every internal bot gets it. */
export interface BotEnvSection {
  env?: Record<string, string>;
  bots?: Record<string, string[]>;
  purposes?: Record<string, string>;
}

/** A settings change: a value of "" deletes the key; an empty `bots` list shares it; names not in the change stay as they are. */
export type BotEnvPatch = BotEnvSection;

export interface BotEnvKeySummary { name: string; purpose: string | null; bots: string[] | null }

export function mergeBotEnvPatch(current: BotEnvSection | undefined, patch: BotEnvPatch): { ok: true; section: BotEnvSection } | { ok: false; error: string } {
  const env = { ...current?.env };
  const bots = { ...current?.bots };
  const purposes = { ...current?.purposes };
  for (const [name, raw] of Object.entries(patch.env ?? {})) {
    if (typeof raw !== "string") return { ok: false, error: "A chave precisa ser texto." };
    if (raw.trim() === "") {
      delete env[name]; delete bots[name]; delete purposes[name];
      continue;
    }
    const refusal = envSecretNameRefusal(name);
    if (refusal) return { ok: false, error: refusal };
    const value = cleanEnvSecretValue(raw);
    if (!value) return { ok: false, error: "A chave precisa ser uma linha só, com até 8192 caracteres." };
    env[name] = value;
  }
  for (const [name, list] of Object.entries(patch.bots ?? {})) {
    if (!Object.hasOwn(env, name)) continue;
    if (Array.isArray(list) && list.length === 0) delete bots[name];
    else if (Array.isArray(list) && list.every((id) => typeof id === "string" && /^[\w-]{1,128}$/.test(id))) bots[name] = [...new Set(list)];
    else return { ok: false, error: "Lista de robôs inválida." };
  }
  for (const [name, text] of Object.entries(patch.purposes ?? {})) {
    if (!Object.hasOwn(env, name) || typeof text !== "string") continue;
    const clean = text.trim().replace(/\s+/g, " ").slice(0, 240);
    if (clean) purposes[name] = clean; else delete purposes[name];
  }
  if (Object.keys(env).length > ENV_SECRET_LIMIT) {
    return { ok: false, error: `Cabem até ${ENV_SECRET_LIMIT} chaves. Apague alguma que não usa mais antes de salvar outra.` };
  }
  return { ok: true, section: { env, bots, purposes } };
}

/** The variables a bot's runs get: a key limited to some bots reaches those only, any other key every internal bot. */
export function botEnvForBot(section: BotEnvSection | undefined, bot: { id: string; internal: boolean }): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(section?.env ?? {})) {
    if (!isEnvSecretName(name) || cleanEnvSecretValue(value) !== value) continue;
    const only = section?.bots?.[name];
    if (only ? only.includes(bot.id) : bot.internal) out[name] = value;
  }
  return out;
}

/** Names, purposes and who gets each key, for the settings screen: never a value. */
export function botEnvSummary(section: BotEnvSection | undefined): BotEnvKeySummary[] {
  return Object.keys(section?.env ?? {}).filter(isEnvSecretName).sort().map((name) => ({
    name,
    purpose: section?.purposes?.[name] ?? null,
    bots: section?.bots?.[name] ?? null,
  }));
}
