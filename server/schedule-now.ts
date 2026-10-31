// "Esse aqui é da EVERGREEN, pode já agendar": an admin's order, typed in any bot's chat, to schedule on Metricool now. The
// server acts on it by itself, with no card and no question, through the portal's own command. Security invariant: only
// an admin's line can start it, only after a cheap word filter passes, only on a clear yes from the decision model, and
// only for a client from the fixed list; the model never names a command, an argument or a file, and any doubt leaves
// the line to the bot as before.
import { execFile } from "node:child_process";
import { z } from "zod";

import { redactSecretsInText } from "../shared/redact.ts";
import type { Decider } from "./decider/index.ts";
import type { AskOptions } from "./decider/types.ts";

export const SCHEDULE_CLIENTS = ["lumon", "fabrikam", "evergreen", "averymercer"] as const;
export type ScheduleClient = (typeof SCHEDULE_CLIENTS)[number];
export const SCHEDULE_NOW_COMMAND = "portal-agendar-agora";
export const SCHEDULE_NOW_TIMEOUT_MS = 120_000;
/** The model must be this sure of the order and of the client. */
export const SCHEDULE_NOW_MIN = 0.85;

const CLIENT_LABELS: Record<ScheduleClient, string> = { lumon: "LUMON", fabrikam: "FABRIKAM", evergreen: "EVERGREEN", averymercer: "Avery Mercer" };
const CLIENT_WORDS: Record<ScheduleClient, RegExp> = {
  lumon: /\blumon\b/i,
  fabrikam: /\bfabrikam\b/i,
  evergreen: /\bevergreen\b/i,
  averymercer: /\bavery\s*mercer\b|\baverymercer\b/i,
};

/** The words that can make a line an order to schedule; anything else never reaches the model. */
const PREFILTER = /agend|metricool|pode\s+post|libera/i;
export const scheduleNowPrefilter = (text: string): boolean => PREFILTER.test(text);

/** The one client a text names; null when it names none or more than one. */
export function clientMentioned(text: string): ScheduleClient | null {
  const found = SCHEDULE_CLIENTS.filter((client) => CLIENT_WORDS[client].test(text));
  return found.length === 1 ? found[0]! : null;
}

/** Items the person named ("post 3", "item 12", "#7"); the model never writes an argument. */
export function itemsMentioned(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(/\b(?:posts?|itens?|item)\s*#?\s*([\w-]{1,40}(?:\s*(?:,|e)\s*#?[\w-]{1,40})*)|#([\w-]{1,40})/gi)) {
    const group = match[1] ?? match[2] ?? "";
    for (const part of group.split(/\s*(?:,|\be\b)\s*/i)) {
      const id = part.replace(/^#/, "").trim();
      if (/^[\w-]{1,40}$/.test(id) && !/^(e|de|do|da|dos|das|os|as|na|no|pra|para)$/i.test(id)) found.add(id);
    }
  }
  return [...found].slice(0, 20);
}

export interface ScheduleReading {
  order: "yes" | "no" | "unsure";
  /** The client the model chose; null for "nenhum" or when it was not sure. */
  client: ScheduleClient | null;
  pOrder: number;
}

const clip = (raw: string, max: number) => {
  const text = redactSecretsInText(raw);
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
};

const ORDER_OPTIONS = {
  sim: "A pessoa está mandando agendar agora no Metricool (ordem direta: 'pode agendar', 'já pode agendar', 'agenda os da Fabrikam', 'esse é da EVERGREEN, pode agendar').",
  nao: "Não é uma ordem de agendar agora: pergunta ('quando você vai agendar?'), pedido para esperar ('não agenda ainda'), comentário, ou outro assunto.",
  incerto: "Não dá para saber se é uma ordem de agendar agora.",
};
const CLIENT_OPTIONS = {
  lumon: "O cliente LUMON.", fabrikam: "O cliente FABRIKAM.", evergreen: "O cliente EVERGREEN.", averymercer: "O cliente Avery Mercer.",
  nenhum: "A mensagem e o contexto não deixam claro de qual cliente é.",
};

/** The decision model's reading of an admin's line; null when it could not say. */
export async function readScheduleNow(
  decider: Pick<Decider, "ask">,
  input: { text: string; recent: readonly string[] },
  options?: AskOptions,
): Promise<ScheduleReading | null> {
  try {
    const result = await decider.ask("scheduleNow", {
      mensagem_da_pessoa: clip(input.text, 600),
      ultimas_mensagens: input.recent.slice(-6).map((line) => clip(line, 300)),
    }, {
      ordem: { type: "choice", instructions: "A mensagem da pessoa é uma ordem para agendar agora os posts no Metricool?", options: ORDER_OPTIONS },
      cliente: { type: "choice", instructions: "De qual cliente são os posts que a pessoa quer agendar?", options: CLIENT_OPTIONS },
    }, options);
    if (!result.ok) return null;
    const { ordem, cliente } = result.answers;
    const sure = ordem.pTop >= SCHEDULE_NOW_MIN && ordem.margin >= 0.3;
    const order = sure ? (ordem.choice === "sim" ? "yes" : ordem.choice === "nao" ? "no" : "unsure") : "unsure";
    const picked = cliente.pTop >= SCHEDULE_NOW_MIN && cliente.choice !== "nenhum" ? cliente.choice : null;
    return { order, client: picked as ScheduleClient | null, pOrder: ordem.pTop };
  } catch {
    return null;
  }
}

/** The client of an order: what the line itself names, then the model's pick, then the bot's own client, then the last
 * message that named one. Null leaves the line to the bot. */
export function resolveScheduleClient(
  text: string, reading: ScheduleReading, botClient: string | undefined, recent: readonly string[],
): ScheduleClient | null {
  const named = clientMentioned(text);
  if (named) return named;
  if (reading.client) return reading.client;
  const own = botClient?.trim().toLowerCase();
  const fromBot = SCHEDULE_CLIENTS.find((client) => client === own);
  if (fromBot) return fromBot;
  for (const line of [...recent].reverse()) {
    const near = clientMentioned(line);
    if (near) return near;
  }
  return null;
}

const settingsSchema = z.object({
  command: z.string().trim().min(1).optional(),
  timeoutSeconds: z.number().int().min(5).max(900).optional(),
}).strict();

export interface RunResult { ok: boolean; stdout: string }
export type RunCommand = (command: string, args: string[], timeoutMs: number) => Promise<RunResult>;

/** The same way the server runs the portal's other commands: execFile, no shell, no model. */
export const runPortalCommand: RunCommand = (command, args, timeoutMs) => new Promise((resolve) => {
  execFile(command, args, { timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (error, stdout) => resolve({ ok: !error, stdout: String(stdout ?? "") }));
});

const of = (client: ScheduleClient) => `${client === "averymercer" ? "do" : "da"} ${CLIENT_LABELS[client]}`;
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
const plain = (text: string) => redactSecretsInText(text).replace(/\s+/g, " ").trim().slice(0, 120);

/** What the command printed, said in a sentence. The command prints JSON with `agendados` (a count or a list) and
 * `falhas` (a list of { item, motivo }); anything else counts by whether it exited cleanly. */
export function resultSentence(client: ScheduleClient, run: RunResult, requested: readonly string[]): string {
  let scheduled: number | undefined;
  let failures: { item: string; reason: string }[] = [];
  try {
    const parsed = z.object({
      agendados: z.union([z.number(), z.array(z.unknown())]).optional(),
      falhas: z.array(z.object({ item: z.union([z.string(), z.number()]).optional(), motivo: z.string().optional() }).passthrough()).optional(),
    }).passthrough().parse(JSON.parse(run.stdout));
    scheduled = typeof parsed.agendados === "number" ? parsed.agendados : parsed.agendados?.length;
    failures = (parsed.falhas ?? []).map((f) => ({ item: f.item === undefined ? "" : String(f.item), reason: f.motivo ?? "" }));
  } catch {
    // Not JSON: the exit decides.
  }
  if (failures.length > 0) {
    const first = failures[0]!;
    const what = first.item && failures.length === 1 ? `o post ${plain(first.item)} ${of(client)}` : `${failures.length} ${plural(failures.length, "post", "posts")} ${of(client)}`;
    const why = first.reason ? `: ${plain(first.reason).replace(/[.]+$/, "")}` : "";
    const done = scheduled ? ` Agendei ${scheduled} ${plural(scheduled, "post", "posts")}.` : "";
    return `Não consegui agendar ${what}${why}.${done}`;
  }
  if (!run.ok) return `Não consegui agendar os posts ${of(client)} agora.`;
  if (scheduled === 0) return `Não havia posts ${of(client)} liberados para agendar.`;
  const count = scheduled ?? (requested.length || undefined);
  if (count !== undefined) return `Agendei ${count} ${plural(count, "post", "posts")} ${of(client)} no Metricool.`;
  return `Agendei os posts ${of(client)} no Metricool.`;
}

export interface ScheduleNowDeps {
  decider: Pick<Decider, "ask">;
  /** config.json's `scheduleNow`: `{ command, timeoutSeconds }`; absent or invalid falls back to the defaults. */
  settings: () => unknown;
  run?: RunCommand;
  /** Puts a line in the conversation as the bot, and tells the bot's next turn about it. */
  say: (target: { botId: string; threadId: string }, text: string) => void;
  now?: () => number;
}

export interface ScheduleNowInput {
  botId: string;
  /** The bot's `client` in bots.json. */
  botClient?: string;
  threadId: string;
  text: string;
  /** Whether the sender is an admin person; anything else never starts this. */
  admin: boolean;
  /** The last lines of the conversation, oldest first, without this one. */
  recent: readonly string[];
  sendId?: string;
}

export interface ScheduleNowOutcome {
  dispatched: boolean;
  client?: ScheduleClient;
  /** Resolves with the sentence said in the conversation. */
  done?: Promise<string>;
}

const SEEN_TTL_MS = 60_000;

export class ScheduleNow {
  private readonly deps: ScheduleNowDeps;
  private readonly seen = new Map<string, number>();

  constructor(deps: ScheduleNowDeps) {
    this.deps = deps;
  }

  private command(): { command: string; timeoutMs: number } {
    const parsed = settingsSchema.safeParse(this.deps.settings() ?? {});
    const settings = parsed.success ? parsed.data : {};
    return { command: settings.command ?? SCHEDULE_NOW_COMMAND, timeoutMs: (settings.timeoutSeconds ?? SCHEDULE_NOW_TIMEOUT_MS / 1000) * 1000 };
  }

  /** Reads the line and, on a clear order for a known client, starts the command at once. The command and the sentence
   * that follows it run in the background (`done`); a failure of any kind leaves the line to the bot. */
  async handle(input: ScheduleNowInput): Promise<ScheduleNowOutcome> {
    if (!input.admin || !scheduleNowPrefilter(input.text)) return { dispatched: false };
    const now = (this.deps.now ?? Date.now)();
    const key = `${input.threadId}|${input.sendId ?? input.text}`;
    for (const [old, at] of this.seen) if (now - at > SEEN_TTL_MS) this.seen.delete(old);
    if (this.seen.has(key)) return { dispatched: false };
    const reading = await readScheduleNow(this.deps.decider, { text: input.text, recent: input.recent });
    if (!reading || reading.order !== "yes") return { dispatched: false };
    const client = resolveScheduleClient(input.text, reading, input.botClient, input.recent);
    if (!client) return { dispatched: false };
    this.seen.set(key, now);
    const items = itemsMentioned(input.text);
    const { command, timeoutMs } = this.command();
    const run = this.deps.run ?? runPortalCommand;
    // Said before the bot's turn starts, so the bot reads that the order is already running.
    try { this.deps.say({ botId: input.botId, threadId: input.threadId }, `Agendando agora os posts ${of(client)} no Metricool.`); } catch { /* the command still runs */ }
    const done = run(command, [client, ...items], timeoutMs)
      .catch((): RunResult => ({ ok: false, stdout: "" }))
      .then((result) => {
        const sentence = resultSentence(client, result, items);
        try { this.deps.say({ botId: input.botId, threadId: input.threadId }, sentence); } catch (error) { console.warn("[schedule-now] could not say the result", error); }
        return sentence;
      });
    return { dispatched: true, client, done };
  }
}
