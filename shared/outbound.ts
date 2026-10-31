// Outbound actions: calls that reach a person outside the app or move money.
// They get their own confirmation regardless of approval level, and an optional
// daily allowance per bot. Shared by the harness (which enforces it) and the app.

export type OutboundPolicy = {
  /** ask: every outbound call waits for a tap. allow: up to dailyCap a day. */
  policy: "ask" | "allow";
  dailyCap: number;
};

export const OUTBOUND_DEFAULT_CAP = 25;
const OUTBOUND_MAX_CAP = 1_000;

/** Tools whose action is one of these words send something somewhere. */
const SEND_VERBS = new Set([
  "SEND",
  "SENDS",
  "REPLY",
  "RESPOND",
  "FORWARD",
  "POST",
  "PUBLISH",
  "TWEET",
  "RETWEET",
  "BROADCAST",
  "INVITE",
  "SHARE",
  "REFUND",
  "CHARGE",
  "PAY",
  "PAYOUT",
  "TRANSFER",
]);

/** Creating one of these is sending it: a created comment is a comment
 * someone reads, a created invoice is one someone receives. */
const CREATE_VERBS = new Set(["CREATE", "CREATION", "ADD", "NEW"]);
const SENT_NOUNS = new Set(["MESSAGE", "COMMENT", "POST", "EMAIL", "MAIL", "INVOICE", "PAYMENT", "REFUND", "REPLY", "TWEET", "DM"]);

/** A read verb first means the rest of the name is what is being read:
 * REDDIT_GET_POST fetches a post, it does not post. */
const READ_VERBS = new Set(["GET", "LIST", "FETCH", "SEARCH", "READ", "FIND", "RETRIEVE", "LOOKUP", "DOWNLOAD", "VIEW", "CHECK", "COUNT"]);

/** The action part of a tool name, as upper-case word tokens. Composio's
 * TOOLKIT_ACTION drops its toolkit; an MCP server's mcp__server__action
 * drops its server; a bare built-in like Bash stays as it is. */
function actionTokens(name: string): string[] {
  let action = name;
  if (name.startsWith("mcp__")) {
    const [, server = "", ...rest] = name.split("__");
    action = rest.join("_");
    if (server === "composio") return actionTokens(action);
  } else if (/^[A-Z][A-Z0-9]*_[A-Z0-9_]+$/.test(name)) {
    action = name.slice(name.indexOf("_") + 1);
  }
  return action
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);
}

/** Words that make an action sensitive, by why it waits for a person: it pays, deletes, ships or publishes. */
const SENSITIVE_VERBS: Readonly<Record<"spend" | "delete" | "deploy" | "send", ReadonlySet<string>>> = {
  spend: new Set(["PAY", "PAYMENT", "PAYOUT", "CHARGE", "REFUND", "TRANSFER", "PURCHASE", "BUY", "SUBSCRIBE", "CHECKOUT"]),
  delete: new Set(["DELETE", "REMOVE", "DESTROY", "DROP", "PURGE", "ERASE", "TRASH", "WIPE"]),
  deploy: new Set(["DEPLOY", "ROLLBACK", "MERGE", "RELEASE"]),
  send: new Set(["PUBLISH", "POST", "TWEET", "BROADCAST"]),
};

/** Changing one of these is changing how a system or an account is set up. */
const CONFIG_NOUNS = new Set([
  "DNS", "DOMAIN", "DOMAINS", "PERMISSION", "PERMISSIONS", "ROLE", "ROLES", "SECRET", "SECRETS", "KEY", "KEYS", "APIKEY",
  "TOKEN", "TOKENS", "PASSWORD", "FIREWALL", "WEBHOOK", "WEBHOOKS", "BILLING", "SUBSCRIPTION", "PLAN", "SETTINGS", "SETTING",
  "CONFIG", "CONFIGURATION", "INTEGRATION", "INTEGRATIONS", "OAUTH", "MEMBER", "MEMBERS", "ACCESS", "ENV", "ENVIRONMENT",
]);
const CONFIG_VERBS = new Set([
  "UPDATE", "SET", "CHANGE", "MODIFY", "EDIT", "CREATE", "ADD", "ROTATE", "REVOKE", "GRANT", "ENABLE", "DISABLE",
  "CONFIGURE", "RESET", "REGENERATE", "PATCH", "PUT", "UPSERT", "CONNECT", "DISCONNECT", "INVITE",
]);

/** Video generation spends a lot of credit at once. */
const VIDEO_VERBS = new Set(["GERAR", "GENERATE", "EDITAR", "EDIT", "ESTENDER", "EXTEND", "UPSCALE", "CREATE", "RENDER", "ANIMATE"]);

export type SensitiveReason = "spend" | "config" | "delete" | "send" | "deploy";

/** Why an action waits for a person whatever the approval level, or null. */
export function sensitiveReason(name: string): SensitiveReason | null {
  // The app's own team tools (posting in a room, closing a thread) stay inside the workspace.
  if (name.startsWith("mcp__agents__")) return null;
  const tokens = actionTokens(name);
  if (tokens.length === 0 || isReadOnlyTool(name)) return null;
  if (tokens.includes("DRAFT") || tokens.includes("PROPOSE") || tokens.includes("SCHEDULE")) return null;
  for (const reason of ["spend", "delete", "deploy", "send"] as const) {
    if (tokens.some((token) => SENSITIVE_VERBS[reason].has(token))) return reason;
  }
  if (tokens.some((token) => CONFIG_VERBS.has(token)) && tokens.some((token) => CONFIG_NOUNS.has(token))) return "config";
  if ((tokens.includes("VIDEO") || tokens.includes("VIDEOS")) && tokens.some((token) => VIDEO_VERBS.has(token))) return "spend";
  if (tokens.includes("MIRAGE") || (tokens.includes("ZORG") && tokens.includes("CLONE"))) return "spend";
  return null;
}

/** Publishing, deleting, deploying, payments, account settings and video generation always wait for a person. */
export function isSensitiveTool(name: string): boolean {
  return sensitiveReason(name) !== null;
}

/** Servers whose making calls charge the account's credit; their free calls start with one of these words. */
const CREDIT_SERVERS = new Set(["zim", "higgsfield", "heygen"]);
const FREE_ON_CREDIT_SERVER = new Set([
  "CONSULTAR", "LISTAR", "BUSCAR", "ESTIMAR", "SALDO", "EXTRATO", "VER", "SONDAR", "ACOMPANHAR", "INTERPRETAR", "ORIENTAR",
  "PLANEJAR", "RELATORIO", "RECEBER", "SOLICITAR", "CONFIRMAR", "IMPORTAR", "ORGANIZAR", "CADASTRAR", "DESATIVAR",
]);
const MAKE_VERBS = new Set([
  "GERAR", "GENERATE", "GENERATION", "CREATE", "CRIAR", "EDIT", "EDITAR", "ESTENDER", "EXTEND", "RENDER", "ANIMATE", "UPSCALE",
  "APROVAR", "DESIGN", "CLONE", "MIRAGE", "IMAGEGEN",
]);
const MEDIA_NOUNS = new Set([
  "IMAGE", "IMAGES", "IMAGEM", "IMAGENS", "PHOTO", "FOTO", "VIDEO", "VIDEOS", "AUDIO", "SPEECH", "MUSIC", "AVATAR", "LIPSYNC", "VOICE", "IMAGEGEN",
]);

/** Making one of these organizes the account; it generates nothing. */
const ORGANIZING_NOUNS = new Set(["UPLOAD", "PROJETO", "PROJECT", "FOLDER", "PASTA"]);

/** Does a finished call of this tool spend generation credit (an image, a video, a voice)? */
export function isCreditTool(name: string): boolean {
  const tokens = actionTokens(name);
  if (tokens.length === 0 || isReadOnlyTool(name) || tokens.some(token => ORGANIZING_NOUNS.has(token))) return false;
  const server = name.startsWith("mcp__") ? name.split("__")[1]?.toLowerCase() ?? "" : "";
  if (CREDIT_SERVERS.has(server)) return !FREE_ON_CREDIT_SERVER.has(tokens[0]!) && tokens.some(token => MAKE_VERBS.has(token) || MEDIA_NOUNS.has(token));
  return tokens.some(token => MAKE_VERBS.has(token)) && tokens.some(token => MEDIA_NOUNS.has(token));
}

/** "other": a call that did more than look, with no known effect. */
export type ActionEffect = SensitiveReason | "other";

/** What a finished call of this tool did that running it again would do twice, or null for a read or a step inside the app. */
export function actionEffect(name: string): ActionEffect | null {
  if (name.startsWith("mcp__agents__")) return null;
  return sensitiveReason(name) ?? (isOutboundTool(name) ? "send" : isCreditTool(name) ? "spend" : null);
}

/** One thing a turn already did. `uncertain`: the call started and no result came back, so it may have happened. */
export interface DoneAction {
  tool: string;
  effect: ActionEffect;
  uncertain: boolean;
}

/** The action in plain Brazilian Portuguese, for a person: "gerou um vídeo", "pode ter enviado uma mensagem". */
export function doneActionPhrase(action: DoneAction): string {
  const [done, maybe] = phrasePair(action);
  return action.uncertain ? maybe : done;
}

function phrasePair({ tool, effect }: DoneAction): [string, string] {
  const name = tool.toLowerCase();
  if (effect === "spend") {
    if (/v[ií]deo|mirage|clone|lipsync|avatar/.test(name)) return ["gerou um vídeo", "pode ter gerado um vídeo"];
    if (/imag|photo|foto/.test(name)) return ["gerou uma imagem", "pode ter gerado uma imagem"];
    if (/audio|áudio|speech|voice|music|voz/.test(name)) return ["gerou um áudio", "pode ter gerado um áudio"];
    return ["fez um pagamento ou gastou crédito", "pode ter feito um pagamento ou gastado crédito"];
  }
  if (effect === "send") {
    if (/mail/.test(name)) return ["enviou um e-mail", "pode ter enviado um e-mail"];
    if (/post|publish|tweet/.test(name)) return ["publicou algo", "pode ter publicado algo"];
    return ["enviou uma mensagem", "pode ter enviado uma mensagem"];
  }
  if (effect === "delete") return ["apagou algo", "pode ter apagado algo"];
  if (effect === "deploy") {
    if (/commit/.test(name)) return ["salvou uma mudança de código", "pode ter salvo uma mudança de código"];
    return ["publicou uma versão", "pode ter publicado uma versão"];
  }
  if (effect === "other") return ["fez uma ação que pode ter mudado algo", "começou uma ação e não viu se terminou"];
  return ["mudou uma configuração", "pode ter mudado uma configuração"];
}

/** Does the tool name describe a read-only action? This is deliberately
 * narrower than "not outbound": updates, deletes and other writes do not
 * become reads merely because they send nothing to another person. */
export function isReadOnlyTool(name: string): boolean {
  const tokens = actionTokens(name);
  return tokens.length > 0 && READ_VERBS.has(tokens[0]);
}

/** Built-in tools that only look: reading files, searching, fetching a page. */
const READ_BUILTINS = new Set(["Read", "Grep", "Glob", "LS", "WebFetch", "WebSearch", "NotebookRead", "TodoWrite", "TodoRead", "ToolSearch"]);
/** Portuguese read verbs (the Zim server names its tools in Portuguese). */
const READ_VERBS_PT = new Set([
  "CONSULTAR", "LISTAR", "BUSCAR", "VER", "OBTER", "LER", "PESQUISAR", "SONDAR", "ACOMPANHAR", "ESTIMAR", "SALDO", "EXTRATO",
  "RELATORIO", "INTERPRETAR", "ORIENTAR", "PLANEJAR",
]);

/** The app's own tools that only read or only report progress; a rerun repeats nothing anyone sees twice. */
const APP_LOOK_TOOLS = new Set([
  "informar_etapa", "session_search", "session_read", "tool_result_read", "skills_list", "assignment_status", "memory_log",
]);

/** A call a restart may run again on its own: it only looks. Any other call could have changed something. */
export function isLookOnlyTool(name: string): boolean {
  if (READ_BUILTINS.has(name) || isReadOnlyTool(name)) return true;
  const [, server, ...rest] = name.startsWith("mcp__") ? name.split("__") : [];
  if (APP_LOOK_TOOLS.has(server === undefined ? name : server === "agents" ? rest.join("__") : "")) return true;
  const first = actionTokens(name)[0];
  return first !== undefined && READ_VERBS_PT.has(first);
}
/** The built-in agents server's X research tools only read X: x_post reads a post, it does not post one. */
const AGENTS_X_READS = /^(?:mcp__agents__|agents__|agents_)?x_(?:search|user_posts|post|profile)$/;

/** Does this tool send something to someone, or move money? */
export function isOutboundTool(name: string): boolean {
  // A raw API call from the workbench can do anything an app tool can, and
  // nothing here can read which; it is treated as a send.
  if (name === "COMPOSIO_PROXY_EXECUTE") return true;
  if (AGENTS_X_READS.test(name)) return false;
  const tokens = actionTokens(name);
  if (tokens.length === 0) return false;
  if (isReadOnlyTool(name)) return false;
  if (tokens.some((token) => SEND_VERBS.has(token))) return true;
  if (tokens.includes("DRAFT")) return false;
  return tokens.some((token) => CREATE_VERBS.has(token)) && tokens.some((token) => SENT_NOUNS.has(token));
}

/** The stored shape, or null when the value is not one. */
export function normalizeOutboundPolicy(value: unknown): OutboundPolicy | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { policy, dailyCap } = value as { policy?: unknown; dailyCap?: unknown };
  if (policy !== "ask" && policy !== "allow") return null;
  if (dailyCap === undefined) return { policy, dailyCap: OUTBOUND_DEFAULT_CAP };
  if (typeof dailyCap !== "number" || !Number.isInteger(dailyCap) || dailyCap < 1 || dailyCap > OUTBOUND_MAX_CAP) return null;
  return { policy, dailyCap };
}

/** What a bot without a stored policy does: ask, every time. */
export const DEFAULT_OUTBOUND_POLICY: OutboundPolicy = { policy: "ask", dailyCap: OUTBOUND_DEFAULT_CAP };

/** One app tool a connector request would run, with its arguments when the
 * request carries them. */
export interface ConnectorCall {
  slug: string;
  arguments?: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** Composio's session exposes a handful of meta tools and runs the app
 * tools inside them: a multi-execute call carries a list of slugs with
 * arguments. Arbitrary workbench/bash code is opaque: it requires an
 * explicit unrestricted approval, never an inferred app or send count.
 * Search, schema lookup, and connection management run no app tools. */
export function connectorCallsIn(name: string, args: unknown): ConnectorCall[] {
  if (name === "COMPOSIO_MULTI_EXECUTE_TOOL") {
    const tools = isRecord(args) && Array.isArray(args.tools) ? args.tools
      : isRecord(args) && typeof args.tool_slug === "string" ? [args] : [];
    if (!tools.length) return [{ slug: "COMPOSIO_PROXY_EXECUTE", arguments: args }];
    const calls: ConnectorCall[] = [];
    for (const item of tools) {
      if (!isRecord(item)) return [{ slug: "COMPOSIO_PROXY_EXECUTE", arguments: args }];
      const slug = [item.tool_slug, item.slug, item.name, item.tool].find((value) => typeof value === "string" && value);
      if (typeof slug !== "string") return [{ slug: "COMPOSIO_PROXY_EXECUTE", arguments: args }];
      calls.push({ slug, ...(item.arguments !== undefined ? { arguments: item.arguments } : {}) });
    }
    return calls;
  }
  if (name === "COMPOSIO_REMOTE_WORKBENCH" || name === "COMPOSIO_REMOTE_BASH_TOOL") {
    // Arbitrary code can compute tool names and repeat calls. Its app and
    // outbound count cannot be inferred from literals in the source.
    return [{ slug: "COMPOSIO_PROXY_EXECUTE", arguments: args }];
  }
  if (["COMPOSIO_SEARCH_TOOLS", "COMPOSIO_GET_TOOL_SCHEMAS", "COMPOSIO_MANAGE_CONNECTIONS", "COMPOSIO_WAIT_FOR_CONNECTIONS"].includes(name)) return [];
  if (name.startsWith("COMPOSIO_")) return [{ slug: "COMPOSIO_PROXY_EXECUTE", arguments: args }];
  return [{ slug: name, ...(args !== undefined ? { arguments: args } : {}) }];
}

/** The subset of a request's app tools that would send something. */
export function outboundCallsIn(name: string, args: unknown): ConnectorCall[] {
  return connectorCallsIn(name, args).filter((call) => isOutboundTool(call.slug));
}
