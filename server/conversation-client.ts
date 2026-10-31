// Nordus: one internal bot works for several clients (one social media for EVERGREEN, Fabrikam and Lumon). Each turn knows
// which client it is for: a room's own client, always; in a private chat, the client the person named, kept until
// another is named. That client's ficha (marcas/<client>/FICHA.md) enters the system prompt, its work goes to its
// folder, what the bot learns about it goes to its own memory topic, and nothing of another client reaches the turn.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { CLIENT_SLUG } from "../shared/wire.ts";
import type { TopicHeader } from "./memory-topics.ts";
import { LruMap } from "./lru-map.ts";

export const FICHA_FILE = "FICHA.md";
export const RULES_FILE = "regras.md";
export const WORK_FOLDER = "trabalho";
const FICHA_MAX_CHARS = 12_000;
const RULES_MAX_CHARS = 4_000;
export const CLIENT_MEMORY_MAX_CHARS = 6_000;

/** One client of ZORG as its ficha describes it. */
export interface ClientProfile {
  slug: string;
  name: string;
  /** Every name the person may use for it: the slug, the name and the ficha's apelidos. */
  aliases: string[];
  /** Names that are also everyday words ("fabrikam"): they count only capitalized or after "da", "pra", "cliente"… */
  ambiguous: string[];
  dir: string;
  ficha: string;
  rules: string;
}

/** Where the clients' folders live: NORDUS_CLIENTS_DIR, or ~/zorg/marcas. */
export function clientsDir(): string {
  return process.env.NORDUS_CLIENTS_DIR?.trim() || join(homedir(), "zorg", "marcas");
}

export const clientWorkDir = (client: ClientProfile): string => join(client.dir, WORK_FOLDER);

const cache = new LruMap<string, { mtimeMs: number; size: number; profile: ClientProfile | null }>(500);

function list(value: string): string[] {
  return value.replace(/^\[|\]$/g, "").split(",").map((item) => item.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
}

/** `---` front matter with `nome`, `apelidos` and `apelidos_ambiguos`, then the ficha itself. */
export function parseFicha(slug: string, dir: string, text: string, rules = ""): ClientProfile {
  const front = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  const fields = new Map<string, string>();
  for (const line of front?.[1].split(/\r?\n/) ?? []) {
    const field = /^([a-z_]+)\s*:\s*(.*)$/.exec(line.trim());
    if (field) fields.set(field[1], field[2].trim());
  }
  const name = fields.get("nome")?.replace(/^["']|["']$/g, "") || slug.toUpperCase();
  const ambiguous = list(fields.get("apelidos_ambiguos") ?? "");
  const aliases = [...new Set([slug, name, ...list(fields.get("apelidos") ?? ""), ...ambiguous].map((alias) => alias.trim()).filter((alias) => alias.length >= 2))];
  const body = (front ? text.slice(front[0].length) : text).trim();
  return {
    slug, name, aliases, ambiguous: ambiguous.map(fold), dir,
    ficha: body.length > FICHA_MAX_CHARS ? `${body.slice(0, FICHA_MAX_CHARS)}\n[ficha cortada]` : body,
    rules: rules.trim().slice(0, RULES_MAX_CHARS),
  };
}

function readProfile(root: string, slug: string): ClientProfile | null {
  const dir = join(root, slug);
  const path = join(dir, FICHA_FILE);
  let stat;
  try {
    stat = statSync(path);
    if (!stat.isFile()) return null;
  } catch {
    return null;
  }
  let rulesStamp = 0;
  try { rulesStamp = statSync(join(dir, RULES_FILE)).mtimeMs; } catch {}
  const key = `${path}`;
  const cached = cache.get(key);
  const stamp = stat.mtimeMs + rulesStamp;
  if (cached && cached.mtimeMs === stamp && cached.size === stat.size) return cached.profile;
  let profile: ClientProfile | null = null;
  try {
    let rules = "";
    try { rules = readFileSync(join(dir, RULES_FILE), "utf8"); } catch {}
    profile = parseFicha(slug, dir, readFileSync(path, "utf8"), rules);
  } catch {
    profile = null;
  }
  cache.set(key, { mtimeMs: stamp, size: stat.size, profile });
  return profile;
}

/** Every client with a ficha, by slug. A folder without FICHA.md is not a client yet. */
export function loadClients(root = clientsDir()): ClientProfile[] {
  let names: string[];
  try {
    names = readdirSync(root);
  } catch {
    return [];
  }
  return names.filter((name) => CLIENT_SLUG.test(name)).sort().flatMap((slug) => readProfile(root, slug) ?? []);
}

export function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Before an everyday word, these make it the client's name: "post da fabrikam", "pra fabrikam", "cliente fabrikam". */
const CUE = /(?:^|[^\p{L}\p{N}])(?:cliente|da|do|pra|pro|para|pela|pelo|na|no)(?:\s+(?:a|o))?\s+$/u;

function occurrences(text: string, alias: string): number[] {
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}@_])${escape(fold(alias))}(?![\\p{L}\\p{N}_])`, "gu");
  const folded = fold(text);
  const out: number[] = [];
  for (const match of folded.matchAll(pattern)) out.push(match.index);
  return out;
}

/** Where the text names this client first, or -1. */
export function firstMention(text: string, client: ClientProfile): number {
  let first = -1;
  for (const alias of client.aliases) {
    const ambiguous = client.ambiguous.includes(fold(alias));
    for (const at of occurrences(text, alias)) {
      // Folding keeps every index here: NFD of pt-BR letters only adds marks, removed again, so lengths match.
      if (ambiguous) {
        const initial = text.charAt(at);
        const capitalized = initial !== initial.toLowerCase();
        if (!capitalized && !CUE.test(fold(text.slice(Math.max(0, at - 24), at)))) continue;
      }
      if (first < 0 || at < first) first = at;
      break;
    }
  }
  return first;
}

/** The clients a text names, in the order it names them. */
export function mentionedClients(text: string, clients: readonly ClientProfile[]): string[] {
  if (!text.trim()) return [];
  return clients
    .map((client) => ({ slug: client.slug, at: firstMention(text, client) }))
    .filter((hit) => hit.at >= 0)
    .sort((a, b) => a.at - b.at)
    .map((hit) => hit.slug);
}

export type ClientSource = "bot" | "room" | "mentioned" | "previous" | "none";

export interface ConversationClients {
  /** The clients this turn works for: one, or the several a private message named. */
  active: string[];
  /** Clients the message named that this conversation does not switch to (a room's or a client bot's own is fixed). */
  outside: string[];
  source: ClientSource;
}

/** The order the turn's client is decided in: the bot's own client, the room's, the ones the message names, the ones
 * named earlier in the same conversation. Unknown slugs never count. */
export function resolveConversationClients(input: {
  botClient?: string;
  roomClient?: string;
  previous?: readonly string[];
  mentioned: readonly string[];
  known: ReadonlySet<string>;
}): ConversationClients {
  const mentioned = [...new Set(input.mentioned.filter((slug) => input.known.has(slug)))];
  const fixed = input.botClient ?? input.roomClient;
  if (fixed) {
    return { active: [fixed], outside: mentioned.filter((slug) => slug !== fixed), source: input.botClient ? "bot" : "room" };
  }
  if (mentioned.length) return { active: mentioned, outside: [], source: "mentioned" };
  const previous = [...new Set((input.previous ?? []).filter((slug) => input.known.has(slug)))];
  if (previous.length) return { active: previous, outside: [], source: "previous" };
  return { active: [], outside: [], source: "none" };
}

/** A room or a client's bot may name a client whose ficha does not exist yet: it is still that client's. */
export function missingFicha(slug: string, root = clientsDir()): ClientProfile {
  return {
    slug, name: slug.toUpperCase(), aliases: [slug], ambiguous: [], dir: join(root, slug), rules: "",
    ficha: `Este cliente ainda não tem ficha (${join(root, slug, FICHA_FILE)}). Não invente cores, fabrikam, @ nem destinos: pergunte o que faltar.`,
  };
}

const nameOf = (clients: readonly ClientProfile[], slug: string) => clients.find((client) => client.slug === slug)?.name ?? slug.toUpperCase();

/** Hides what belongs to another client: a line naming one, and a topic file of one. */
export class ClientLens {
  readonly active: readonly string[];
  private readonly others: ClientProfile[];
  constructor(active: readonly string[], clients: readonly ClientProfile[]) {
    this.active = active;
    this.others = clients.filter((client) => !active.includes(client.slug));
  }

  /** The client a text belongs to when it names one this turn does not work for. */
  otherIn(text: string): string | undefined {
    return this.others.find((client) => firstMention(text, client) >= 0)?.slug;
  }

  hidesText(text: string): boolean {
    return this.otherIn(text) !== undefined;
  }

  hidesTopic(name: string, header: TopicHeader): boolean {
    const owner = topicClient(name);
    if (owner) return !this.active.includes(owner);
    return this.hidesText([name.replace(/\.md$/i, "").replace(/[-_]+/g, " "), header.title ?? "", header.description ?? "", ...header.aliases].join(" · "));
  }

  /** MEMORY.md as this turn may read it: without the lines of another client. */
  filterLines(text: string): string {
    if (!this.others.length) return text;
    return text.split("\n").filter((line) => !this.hidesText(line)).join("\n");
  }
}

/** A client's memory topic in a bot's notebook: memory/cliente-<slug>.md. */
export const clientTopicName = (slug: string): string => `cliente-${slug}.md`;

export function topicClient(name: string): string | undefined {
  const match = /^cliente-([a-z0-9][a-z0-9-]{0,39})\.md$/.exec(name);
  return match?.[1];
}

const SOURCE_LINE: Record<ClientSource, string> = {
  bot: "este robô trabalha só para este cliente",
  room: "esta sala é deste cliente, sempre",
  mentioned: "a pessoa citou este cliente na mensagem",
  previous: "a pessoa citou este cliente antes nesta conversa e ainda não trocou",
  none: "",
};

/** The client part of a turn's system prompt. Empty when there is no client to speak of. */
export function clientContextPrompt(input: {
  resolved: ConversationClients;
  clients: readonly ClientProfile[];
  /** Internal bots may hear the other clients' names, to ask which one; a client's bot never does. */
  internal: boolean;
  room: boolean;
  memory: (slug: string) => string;
}): string {
  const { resolved, clients } = input;
  const active = resolved.active.map((slug) => clients.find((client) => client.slug === slug) ?? missingFicha(slug));
  if (!active.length) {
    if (!input.internal || !clients.length) return "";
    return [
      "\n\n## Cliente desta conversa",
      `Nenhum cliente definido nesta conversa. Clientes da ZORG com ficha: ${clients.map((client) => client.name).join(", ")}.`,
      "Se o pedido depende de marca (post, legenda, arte, carrossel, roteiro, campanha, publicar, agendar, site), pergunte primeiro \"Para qual cliente?\" e não chute nem escolha um sozinho.",
      "Se o pedido não depende de marca, responda normalmente, sem usar material de nenhum cliente.",
    ].join("\n");
  }
  const several = active.length > 1;
  const names = active.map((client) => client.name);
  const lines = [
    "\n\n## Cliente desta conversa",
    several
      ? `Clientes ativos: ${names.join(" e ")} (${SOURCE_LINE[resolved.source]}). Trate cada parte do pedido com a ficha do cliente certo, sem misturar tom, cores, @ ou destinos; se não estiver claro qual parte é de qual cliente, pergunte.`
      : `Cliente ativo: ${names[0]} (${SOURCE_LINE[resolved.source]}).`,
    "- Trabalhe no tom, nas cores, nas fontes e com os @ da ficha abaixo.",
    "- Nunca cite, compare nem use material, exemplos, números ou contas de outro cliente da ZORG.",
    "- Publicar, agendar ou usar domínio: só os destinos da ficha. Se a ficha não tiver o destino pedido, pergunte antes de fazer.",
    ...active.map((client) => `- Arquivos de ${client.name}: salve em ${JSON.stringify(clientWorkDir(client))}.`),
    "- O que você aprender sobre o cliente fica na memória dele: memory_update guarda lá. Uma nota que vale para todo cliente (o jeito de trabalhar da pessoa) começa com \"Geral:\" e fica na sua memória geral.",
  ];
  if (resolved.outside.length) {
    const own = names[0];
    const cited = resolved.outside.map((slug) => nameOf(clients, slug)).join(" e ");
    lines.push(input.room
      ? `- A mensagem cita ${cited}, mas esta sala é de ${own}. Não troque de cliente nem use nada de ${cited}: avise em uma frase que esta sala é de ${own} e que o pedido de ${cited} vai na sala de ${cited} ou no privado.`
      : `- A mensagem cita ${cited}, mas você trabalha só para ${own}. Não use nada de ${cited}; diga em uma frase que isso não é com você.`);
  }
  for (const client of active) {
    lines.push(`\n### Ficha de ${client.name}\n${client.ficha}`);
    if (client.rules) lines.push(`\n### Regras de ${client.name}\n${client.rules}`);
    const memory = input.memory(client.slug).trim();
    if (memory) lines.push(`\n### O que você já aprendeu sobre ${client.name}\n${memory.length > CLIENT_MEMORY_MAX_CHARS ? `${memory.slice(0, CLIENT_MEMORY_MAX_CHARS)}…` : memory}`);
  }
  return lines.join("\n");
}
