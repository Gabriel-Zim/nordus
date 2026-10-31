// A critical action (spend, send outside, deploy, settings, deleting for good) by a bot on its own runs only after
// an admin person typed a clear yes in the same conversation, to a question from that bot that showed what the
// action does, and only with the exact parameters that question was about. The bot writes the question in its own
// words; this module stores what the action really is and reads the conversation to decide.
import { createHash, randomUUID } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { fromMarkdown, type Options as MarkdownOptions } from "mdast-util-from-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { z } from "zod";

import { isShellTool, type CriticalReason } from "../shared/critical-action.ts";
import { plainChatText, splitImagePaths } from "../shared/plain-chat-text.ts";
import { stripLeakedSystemHarnessMessages } from "../shared/system-message-guard.ts";
import { redactSecretsInText } from "../shared/redact.ts";
import type { WireMessage } from "../shared/wire.ts";
import { writeFileAtomic } from "./atomic.ts";

const PROPOSAL_TTL_MS = 24 * 60 * 60_000;
const YES_TTL_MS = 30 * 60_000;
const MAX_ANCHORS = 10;
const MAX_ID_SHOWN = 80;
const MAX_PROPOSALS = 2_000;
const MAX_PROPOSALS_PER_CONVERSATION = 50;
const MAX_STORE_BYTES = 1024 * 1024;
const MAX_READINGS = 200;

const readingKey = (answer: WireMessage, question: WireMessage) =>
  `${answer.id}\u0000${createHash("sha256").update(JSON.stringify([answer.text ?? "", question.text ?? ""])).digest("hex").slice(0, 32)}`;
const REASONS = ["spend", "config", "delete", "send", "deploy"] as const satisfies readonly CriticalReason[];

const LABELS: Record<CriticalReason, string> = {
  spend: "gastar dinheiro ou crédito",
  config: "mudar configuração",
  delete: "apagar de vez",
  send: "enviar para fora",
  deploy: "publicar",
};

/** One critical tool call as the hook saw it. `input` is null when the hook could not send all of it. */
export interface CriticalCall {
  threadId: string;
  botId: string;
  reason: CriticalReason;
  tool: string;
  input: Readonly<Record<string, unknown>> | null;
}

export type Reply = "yes" | "no" | "unclear";

/** `card`: today's approval card. `pass` with `approval`: an admin's yes in the conversation; without it, Jev's. */
export type Decision =
  | { kind: "card" }
  | { kind: "pass"; approval?: { by: string; answerId: string } }
  | { kind: "ask"; botText: string };

const anchorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("email"), value: z.string().min(3).max(320) }).strict(),
  z.object({ kind: z.literal("phone"), digits: z.string().regex(/^\d{8,20}$/), shown: z.string().max(40) }).strict(),
  z.object({ kind: z.literal("amount"), value: z.string().regex(/^\d+(?:\.\d+)?$/).max(40), shown: z.string().max(40) }).strict(),
  z.object({ kind: z.literal("action") }).strict(),
  z.object({ kind: z.literal("app"), value: z.string().min(1).max(80) }).strict(),
  z.object({ kind: z.literal("id"), value: z.string().min(1).max(MAX_ID_SHOWN) }).strict(),
  z.object({ kind: z.literal("file"), value: z.string().min(1).max(MAX_ID_SHOWN) }).strict(),
]);
type Anchor = z.infer<typeof anchorSchema>;

const proposalSchema = z.object({
  id: z.string(),
  threadId: z.string().max(128),
  botId: z.string().max(128),
  reason: z.enum(REASONS),
  tool: z.string().max(200),
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  anchors: z.array(anchorSchema).max(MAX_ANCHORS),
  createdAt: z.number().int().nonnegative(),
  consumed: z.object({ at: z.number().int().nonnegative(), answerId: z.string(), by: z.string() }).strict().optional(),
}).strict();
type Proposal = z.infer<typeof proposalSchema>;
const usedSchema = z.object({ answerId: z.string(), at: z.number().int().nonnegative() }).strict();
const storeSchema = z.object({
  version: z.literal(1),
  proposals: z.array(proposalSchema).max(MAX_PROPOSALS),
  used: z.array(usedSchema).max(MAX_PROPOSALS).default([]),
}).strict();
type Used = z.infer<typeof usedSchema>;

type Reading =
  | { state: "unasked" }
  | { state: "notShown"; missing: readonly Anchor[] }
  | { state: "waiting" }
  | { state: "member" }
  | { state: "stale" }
  | { state: "overtaken" }
  | { state: "used" }
  | { state: "early" }
  | { state: "answered"; reply: Reply; line: WireMessage };

/** The hook's JSON body, or null when it is not a critical call. */
export function parseCriticalCall(body: Record<string, unknown> | null, context: { threadId: string; botId: string }): CriticalCall | null {
  const reason = REASONS.find((known) => known === body?.reason);
  const tool = typeof body?.tool === "string" && body.tool.length <= 200 ? body.tool : "";
  if (!reason || !tool) return null;
  let input: Record<string, unknown> | null = null;
  if (body?.inputComplete === true && typeof body.input === "string") {
    try {
      const parsed: unknown = JSON.parse(body.input);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) input = parsed as Record<string, unknown>;
    } catch {
      input = null;
    }
  }
  return { ...context, reason, tool, input };
}

const canonical = (value: unknown): unknown =>
  Array.isArray(value) ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical((value as Record<string, unknown>)[key])]))
      : value;

/** Claude rewrites a shell call's `description` on every retry; everything else in the input is the action. */
function fingerprintOf(tool: string, input: Readonly<Record<string, unknown>>): string {
  const effect = isShellTool(tool) ? Object.fromEntries(Object.entries(input).filter(([key]) => key !== "description")) : input;
  return createHash("sha256").update(JSON.stringify(canonical({ tool, input: effect }))).digest("hex");
}

const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu;
const PHONE = /\+\d[\d\s().-]{8,}\d/g;
const MONEY_KEY = /amount|valor|price|preco|total|quantia|montante|^value$/;
const MONEY_TEXT = /(?:R\$|US\$|USD|BRL|EUR|€|\$)\s?(\d[\d.,]*\d|\d)/gi;

const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** One spelling for a written amount: "2.000", "2.000,00", "2,000.00" and 2000 are all "2000"; "2,5" is "2.5". */
function amountKey(written: string | number): string {
  if (typeof written === "number") return String(Number(written.toFixed(2)));
  const bare = written.replace(/[.,]+$/, "");
  const decimal = /^(.*?)[.,](\d{1,2})$/.exec(bare);
  const whole = (decimal ? decimal[1]! : bare).replace(/[.,]/g, "").replace(/^0+(?=\d)/, "");
  const cents = decimal ? decimal[2]!.replace(/0+$/, "") : "";
  return cents ? `${whole}.${cents}` : whole;
}

const brl = (value: number) => value.toLocaleString("pt-BR", { maximumFractionDigits: 2, minimumFractionDigits: Number.isInteger(value) ? 0 : 2 });

/** Nordus bots never show a raw command, and the chat hides one between backticks; a shell action is shown by the
 * values it acts on: every word after the program that is not a flag, a path by its file name, a link by its host.
 * A secret is left out (the fingerprint still binds it); a value too long to show sends the action to the card. */
function commandAnchors(command: string): Anchor[] | null {
  const anchors: Anchor[] = [];
  for (const segment of command.split(/\n|;|&&|\|\||\||>>?|</)) {
    const words = [...segment.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((match) => match[1] ?? match[2] ?? match[3] ?? "");
    const program = words.findIndex((word) => !/^(?:sudo|env|nohup|time|exec|[A-Za-z_]\w*=.*)$/.test(word));
    for (const word of words.slice(program + 1)) {
      if (!word || word.startsWith("-") || /^\d*>&?\d*$/.test(word) || redactSecretsInText(word) !== word) continue;
      const host = /^[a-z][\w+.-]*:\/\/([^/\s:?#]+)/i.exec(word)?.[1];
      const file = !host && word.includes("/") ? word.replace(/\/+$/, "").split("/").pop() : undefined;
      const value = (host ?? file ?? word).toLowerCase();
      if (!value) continue;
      if (value.length > MAX_ID_SHOWN) return null;
      anchors.push(file !== undefined ? { kind: "file", value } : { kind: "id", value });
    }
  }
  for (const email of command.match(EMAIL) ?? []) anchors.push({ kind: "email", value: email.toLowerCase() });
  return anchors;
}

/** The word a person reads as "which app": the last word of the MCP server's name. */
const appOf = (tool: string): string | undefined =>
  /^mcp__(.+?)__/.exec(tool)?.[1]?.split(/[-_\s]+/).filter(Boolean).at(-1)?.toLowerCase();

/** What the question must visibly show, taken from the parameters, never from the bot's words; null when it cannot. */
function anchorsOf(call: CriticalCall & { input: Readonly<Record<string, unknown>> }): Anchor[] | null {
  const found: Anchor[] = [{ kind: "action" }];
  if (isShellTool(call.tool)) {
    const values = commandAnchors(typeof call.input.command === "string" ? call.input.command : "");
    return values?.length ? distinct([...found, ...values]) : null;
  }
  const strings: string[] = [];
  const ids: Anchor[] = [];
  const walk = (value: unknown, key: string) => {
    if (typeof value === "string") {
      strings.push(value);
      if (value.trim() && value.length <= MAX_ID_SHOWN) ids.push({ kind: "id", value: value.trim().toLowerCase() });
      for (const match of value.matchAll(MONEY_TEXT)) found.push({ kind: "amount", value: amountKey(match[1]!), shown: match[1]! });
      const written = MONEY_KEY.test(fold(key)) ? value.match(/\d[\d.,]*/)?.[0] : undefined;
      if (written && /(cents|centavos)$/.test(fold(key))) {
        const amount = Number(amountKey(written)) / 100;
        found.push({ kind: "amount", value: amountKey(amount), shown: brl(amount) });
      } else if (written) {
        found.push({ kind: "amount", value: amountKey(written), shown: written.replace(/[.,]+$/, "") });
      }
    } else if (typeof value === "number" && MONEY_KEY.test(fold(key))) {
      const amount = /(cents|centavos)$/.test(fold(key)) ? value / 100 : value;
      found.push({ kind: "amount", value: amountKey(amount), shown: brl(amount) });
    } else if (typeof value === "number") {
      ids.push({ kind: "id", value: String(value) });
    } else if (Array.isArray(value)) {
      for (const item of value) walk(item, key);
    } else if (value && typeof value === "object") {
      for (const [child, item] of Object.entries(value)) walk(item, child);
    }
  };
  walk(call.input, "");
  for (const text of strings) {
    for (const email of text.match(EMAIL) ?? []) found.push({ kind: "email", value: email.toLowerCase() });
    for (const phone of text.match(PHONE) ?? []) found.push({ kind: "phone", digits: phone.replace(/\D/g, ""), shown: phone.trim() });
  }
  const app = appOf(call.tool);
  // Security invariant: an action with no address, phone or amount is shown by its app and every short value it carries.
  // A spend inside one of the person's own apps is shown by the app alone: its values are internal ids (avatar, voice,
  // asset) the chat never shows a person, so asking for them made every first yes fail. The fingerprint still binds them.
  const internalIds = call.reason === "spend" && app !== undefined;
  if (found.length === 1) found.push(...(app ? [{ kind: "app", value: app } as const] : []), ...(internalIds ? [] : ids));
  return distinct(found);
}

function distinct(found: readonly Anchor[]): Anchor[] | null {
  const seen = new Set<string>();
  const anchors = found.filter((anchor) => {
    const key = JSON.stringify(anchor.kind === "amount" ? { kind: "amount", value: anchor.value } : anchor);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return anchors.length <= MAX_ANCHORS ? anchors : null;
}

/** The chat's own syntax: ChatMarkdown renders with remark-gfm and remark-math, read here the way remark registers it. */
const CHAT_SYNTAX: MarkdownOptions = (() => {
  const data: { micromarkExtensions?: MarkdownOptions["extensions"]; fromMarkdownExtensions?: MarkdownOptions["mdastExtensions"] } = {};
  for (const plugin of [remarkGfm, remarkMath]) Reflect.apply(plugin, { data: () => data }, []);
  return { extensions: data.micromarkExtensions, mdastExtensions: data.fromMarkdownExtensions };
})();

type MarkdownNode = { type: string; value?: string; children?: MarkdownNode[] };

/** Rendered as a hidden spoiler (strikethrough), folded until clicked (code blocks), not rendered at all (raw HTML,
 * link definitions), or not text (images). */
const UNSEEN = new Set(["delete", "html", "definition", "image", "imageReference", "code"]);

/** What a person reads in a bot line as the chat renders it: the chat's plain text first (a command between backticks
 * reads "o comando", a path its file name), then Markdown. A formula with a command (\phantom, \color) may hide text. */
function visibleText(text: string): string {
  const parts: string[] = [];
  const walk = (node: MarkdownNode) => {
    if (UNSEEN.has(node.type)) return;
    if ((node.type === "math" || node.type === "inlineMath") && node.value?.includes("\\")) return;
    // The chat shows a path in prose by its file name (remarkPlainPaths).
    if (node.value !== undefined) parts.push(node.type === "text" ? node.value.replace(/(?<![\w:/])(?:~|\.{1,2})?\/[\w.@~/-]+/g, (path) => path.replace(/\/+$/, "").split("/").pop() ?? "") : node.value);
    for (const child of node.children ?? []) walk(child);
  };
  walk(fromMarkdown(splitImagePaths(plainChatText(stripLeakedSystemHarnessMessages(text))).text, CHAT_SYNTAX));
  return fold(parts.join(" ").replace(/[\u200B-\u200D\u2060\uFEFF\u00AD]/g, ""));
}

/** The verbs a person reads as each kind of action, as word beginnings. */
const ACTION_WORDS: Record<CriticalReason, RegExp> = {
  send: /(?<![\p{L}\p{N}])(envi|mand|dispar|public|post|compartilh|encaminh|respond|notific|send)/u,
  spend: /(?<![\p{L}\p{N}])(gast|pag|cobr|compr|ger|cri|produz|assin|contrat|invest|anunci|impulsion|credit|spend|pay)/u,
  delete: /(?<![\p{L}\p{N}])(apag|exclu|delet|remov|limp|destru|elimin|descart|drop)/u,
  deploy: /(?<![\p{L}\p{N}])(public|sub|deploy|lanc|coloc|push|atualiz|libera|envi|mand)/u,
  config: /(?<![\p{L}\p{N}])(mud|alter|configur|ativ|desativ|reinici|troc|ajust|instal|desinstal|permiss|restart|deslig|lig|interromp)/u,
};

/** True when `needle` appears in `text` as a whole value, not as part of a longer address, path or word. */
function standsAlone(text: string, needle: string): boolean {
  for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + 1)) {
    const before = text.slice(0, at);
    const after = text.slice(at + needle.length);
    if (/[\p{L}\p{N}_%+@/.-]$/u.test(before)) continue;
    if (/^[\p{L}\p{N}_%+@/-]/u.test(after) || /^\.[\p{L}\p{N}_/]/u.test(after)) continue;
    return true;
  }
  return false;
}

function shows(anchor: Anchor, visible: string, reason: CriticalReason): boolean {
  switch (anchor.kind) {
    case "email": return standsAlone(visible, fold(anchor.value));
    case "id": case "app": return standsAlone(visible, fold(anchor.value));
    case "file": return standsAlone(visible, fold(anchor.value));
    case "action": return ACTION_WORDS[reason].test(visible);
    case "phone": return (visible.match(/\+?\d[\d\s().-]{6,}\d/g) ?? []).map((run) => run.replace(/\D/g, ""))
      .some((digits) => digits === anchor.digits || (digits.length >= 10 && anchor.digits.endsWith(digits)));
    case "amount": return (visible.match(/\d[\d.,]*/g) ?? []).some((written) => amountKey(written) === anchor.value);
  }
}

function named(anchor: Anchor, reason: CriticalReason): string {
  switch (anchor.kind) {
    case "email": return anchor.value;
    case "phone": return `o telefone ${anchor.shown}`;
    case "amount": return `o valor ${anchor.shown}`;
    case "action": return `que vai ${LABELS[reason]}`;
    case "app": return `o app ${anchor.value}`;
    case "id": case "file": return `"${anchor.value}"`;
  }
}

function listed(anchors: readonly Anchor[], reason: CriticalReason): string {
  const names = anchors.map((anchor) => named(anchor, reason));
  return names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}`;
}

const isPersonLine = (message: WireMessage): boolean =>
  message.role === "user" && message.kind === "text" && Boolean(message.text) && !message.peerAsk && !message.aside &&
  !message.relayed && message.via === undefined && !message.imported && !message.queued && !message.webhookPost && !message.answersAsk;

const isBotText = (message: WireMessage): boolean =>
  message.role === "bot" && message.kind === "text" && Boolean(message.text) && !message.quickAck && !message.webhookPost;

const isOwnQuestionLine = (message: WireMessage, botId: string): boolean =>
  isBotText(message) && !message.interrupted && !message.fromTask && !message.textAsk && (message.from?.botId ?? botId) === botId;

/** The last line a person (or something speaking for one) put in the conversation, whatever route it took. */
const lastHumanLine = (path: readonly WireMessage[]): WireMessage | undefined =>
  path.findLast((message) => message.role === "user" && message.kind === "text" && !message.peerAsk && !message.aside && !message.imported);

/** What the decision model said about one reply to one question: the probability it is a plain yes. */
type ReplyAssist = (answer: WireMessage, question: WireMessage) => number | undefined;

/** `usedAnswers`: the lines that already freed an action. One yes frees one action, never two. */
/** `strict`: any line of this bot from another turn between the question and the yes overtakes the question. */
function read(proposal: Proposal, path: readonly WireMessage[], now: number, usedAnswers: ReadonlySet<string>, strict = false, assist?: ReplyAssist): Reading {
  const after = path.filter((message) => message.at > proposal.createdAt);
  const own = after.filter((message) => isOwnQuestionLine(message, proposal.botId));
  if (own.length === 0) return { state: "unasked" };
  const isQuestion = (message: WireMessage) => {
    const visible = visibleText(message.text!);
    return visible.includes("?") && proposal.anchors.every((anchor) => shows(anchor, visible, proposal.reason));
  };
  const asked = after.findLastIndex((message) => isOwnQuestionLine(message, proposal.botId) && isQuestion(message));
  if (asked < 0) {
    const visible = visibleText(own[own.length - 1]!.text!);
    return { state: "notShown", missing: proposal.anchors.filter((anchor) => !shows(anchor, visible, proposal.reason)) };
  }
  const question = after[asked]!;
  const rest = after.slice(asked + 1);
  const fromAdmin = (message: WireMessage) => isPersonLine(message) && message.sender?.admin === true;
  // Security invariant: a queued line is stamped when it is delivered, so it may have been typed before the question showed.
  if (rest.findLast(fromAdmin)?.queueId !== undefined) return { state: "early" };
  const answered = rest.findLastIndex(fromAdmin);
  if (answered < 0) return { state: rest.some(isPersonLine) ? "member" : "waiting" };
  const sameTurn = (message: WireMessage) => question.turnId !== undefined && message.turnId === question.turnId;
  const askedSomethingElse = (message: WireMessage) => isBotText(message) && !sameTurn(message) && (strict || visibleText(message.text!).includes("?"));
  if (rest.slice(0, answered).some(askedSomethingElse)) return { state: "overtaken" };
  const line = rest[answered]!;
  if (usedAnswers.has(line.id)) return { state: "used" };
  if (now - line.at > YES_TTL_MS) return { state: "stale" };
  return { state: "answered", reply: assistedReply(line.text!, question.text!, assist?.(line, question)), line };
}

const RETRY = " Você não precisa saber quem é administrador: quando vier um sim, de quem for, chame de novo esta mesma ferramenta com exatamente os mesmos parâmetros, e o servidor confere quem respondeu.";

function botText(reading: Exclude<Reading, { state: "answered"; reply: "yes" }>, proposal: Proposal): string {
  const show = `, mostrando ${listed(proposal.anchors, proposal.reason)},`;
  const showAgain = ` mostrando ${listed(proposal.anchors, proposal.reason)}`;
  switch (reading.state) {
    case "unasked":
      return `Não rodou: esta ação (${LABELS[proposal.reason]}) precisa do sim de um administrador nesta conversa. ` +
        `Escreva agora uma mensagem curta, do seu jeito, dizendo exatamente o que vai fazer${show} e termine perguntando se pode. ` +
        "Depois encerre sua vez e espere a resposta. Quando a pessoa disser sim, chame esta mesma ferramenta de novo com exatamente os mesmos parâmetros. " +
        "Se mudar qualquer coisa, vai ter de perguntar de novo.";
    case "notShown":
      return `Não rodou: sua pergunta não mostrou ${listed(reading.missing, proposal.reason)}, então nenhuma resposta vale para esta ação. ` +
        `Pergunte de novo${showAgain} e termine perguntando se pode. Depois encerre sua vez.${RETRY}`;
    case "waiting":
      return `Não rodou: ainda não há resposta de um administrador à sua pergunta. Encerre sua vez e espere. Não pergunte de novo nem tente outro caminho.${RETRY}`;
    case "member":
      return `Não rodou: quem respondeu não pode liberar esta ação. Só um administrador pode. Diga isso em uma frase na conversa e encerre sua vez. Não tente outro caminho.${RETRY}`;
    case "stale":
      return `Não rodou: o sim da pessoa tem mais de 30 minutos. Pergunte de novo${showAgain} e encerre sua vez.${RETRY}`;
    case "early":
      return `Não rodou: a resposta chegou enquanto você ainda trabalhava, antes de a pergunta aparecer. Pergunte de novo${showAgain} e encerre sua vez.${RETRY}`;
    case "used":
      return `Não rodou: esse sim já liberou outra ação, e cada sim vale para uma ação só. Pergunte de novo${showAgain} e encerre sua vez.${RETRY}`;
    case "overtaken":
      return `Não rodou: depois da sua pergunta houve outra pergunta na conversa, então não dá para saber a qual delas a pessoa respondeu. Pergunte de novo${showAgain} e encerre sua vez.${RETRY}`;
    case "answered":
      return reading.reply === "no"
        ? "Não rodou: a pessoa respondeu que não. Não tente de novo nem por outro caminho. Se ela pediu uma mudança, faça a mudança e pergunte de novo mostrando os dados novos. Se não, pergunte como ela prefere seguir." + RETRY
        : `Não rodou: a resposta não foi um sim claro. Se a pessoa pediu uma mudança, ajuste e pergunte de novo mostrando os dados novos. Se não, pergunte de novo${showAgain} e peça um sim ou um não.${RETRY}`;
  }
}

const NO_OPENERS = [
  "nao", "n", "nem", "negativo", "nunca", "jamais", "espera", "espere", "pera", "perai", "aguarda", "aguarde", "segura", "calma",
  "para", "pare", "cancela", "cancele", "esquece", "deixa", "melhor nao", "agora nao", "ainda nao",
];
const HOLD = new Set([
  ...NO_OPENERS.filter((opener) => !opener.includes(" ")),
  "?", "mas", "porem", "so", "antes", "depois", "troca", "troque", "muda", "mude", "altera", "altere", "corrige", "corrija", "outro", "outra",
]);
const YES = new Set([
  "sim", "s", "ss", "pode", "podes", "manda", "mande", "mandar", "envia", "envie", "enviar", "publica", "publique", "publicar", "faz", "faca",
  "fazer", "roda", "rode", "rodar", "segue", "siga", "seguir", "vai", "bora", "ok", "okay", "beleza", "blz", "fechado", "confirmo",
  "confirmado", "confirma", "autorizo", "autorizado", "aprovo", "aprovado", "aprovada", "isso", "perfeito", "certo", "claro", "positivo", "yes",
]);
const FILLER = new Set([
  "por", "favor", "pfv", "pf", "obrigado", "obrigada", "valeu", "vlw", "ja", "agora", "entao", "la", "com", "certeza", "ver", "bala", "ai",
  "mesmo", "tudo", "bem", "top", "show", "a", "o", "as", "os", "e", "de", "da", "do", "das", "dos", "no", "na", "pro", "pra", "um", "uma",
  "essa", "esse", "ele", "ela",
]);
const MAX_REPLY_TOKENS = 12;

const tokens = (text: string): string[] =>
  fold(text).replace(/[👍✅👌]/gu, " sim ").replace(/\?/g, " ? ").replace(/[^a-z0-9?]+/g, " ").trim().split(" ").filter(Boolean);

/** The approval rule for a typed reply, with no model: anything but a short, plain yes or no asks again. */
export function classifyReply(reply: string, question: string): Reply {
  const words = tokens(reply);
  if (words.length === 0) return "unclear";
  const joined = words.join(" ");
  if (NO_OPENERS.some((opener) => joined === opener || joined.startsWith(`${opener} `))) return "no";
  if (words.some((word) => HOLD.has(word)) || words.length > MAX_REPLY_TOKENS) return "unclear";
  const asked = new Set(tokens(question));
  return words.some((word) => YES.has(word)) && words.every((word) => YES.has(word) || FILLER.has(word) || asked.has(word)) ? "yes" : "unclear";
}

/** The decision model's yes counts only from here up. */
export const ASSISTED_YES_MIN = 0.85;
/** A longer reply is a conversation, not an answer: the model is not asked about it. */
const MAX_ASSISTED_TOKENS = 40;

/** A word that holds or refuses ("mas", "só", "espera", "não", "?"...) anywhere in the reply. */
export function replyHolds(reply: string): boolean {
  return tokens(reply).some((word) => HOLD.has(word));
}

/** Whether the decision model may be asked about this reply at all: the rule left it unclear, it is short, and no
 * word in it holds or refuses. */
export function replyNeedsReading(reply: string, question: string): boolean {
  const words = tokens(reply);
  return words.length > 0 && words.length <= MAX_ASSISTED_TOKENS && !replyHolds(reply) && classifyReply(reply, question) === "unclear";
}

/** The rule first. Security invariant: the model only ever turns an unclear reply into a yes, at `pYes` of at least
 * ASSISTED_YES_MIN and with no holding or refusing word in it; it never turns a yes or a no into anything else, and it
 * has no say in who answered. */
export function assistedReply(reply: string, question: string, pYes?: number): Reply {
  const ruled = classifyReply(reply, question);
  if (ruled !== "unclear" || pYes === undefined || !(pYes >= ASSISTED_YES_MIN)) return ruled;
  return replyNeedsReading(reply, question) ? "yes" : "unclear";
}

/** Installation-local proposals; callers keep this file out of workspace backups. */
export class ConversationApprovals {
  private proposals: Proposal[] = [];
  private used: Used[] = [];
  private unreadable = false;
  private readonly file: string;
  private readonly available: () => boolean;
  private readonly now: () => number;
  private readonly readReply?: (reply: string, question: string) => Promise<number | null>;
  /** The model's readings, by answer line and question text: filled before judging so the judging stays synchronous. */
  private readonly readings = new Map<string, number>();

  /** `available` is false where people have no sessions (the desktop app), since nobody could answer as an admin there.
   * `readReply`: the decision model's probability that a reply is a plain yes (null when it could not say). */
  constructor(file: string, options: {
    available: () => boolean; now?: () => number; readReply?: (reply: string, question: string) => Promise<number | null>;
  }) {
    this.file = file;
    this.available = options.available;
    this.now = options.now ?? Date.now;
    this.readReply = options.readReply;
    try {
      const stat = lstatSync(file);
      if (!stat.isFile() || stat.size > MAX_STORE_BYTES) throw new Error("Invalid conversation approval store.");
      ({ proposals: this.proposals, used: this.used } = storeSchema.parse(JSON.parse(readFileSync(file, "utf8"))));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        this.unreadable = true;
        console.error("[conversation-approval] The proposal store could not be read; critical actions fall back to the card.");
      }
    }
  }

  /** `jev` is the decision model's auto-approval; it is consulted only where no person's word could reach it. */
  async decide(call: CriticalCall, path: readonly WireMessage[], jev: () => Promise<boolean>): Promise<Decision> {
    if (!this.available()) return call.reason !== "delete" && await jev() ? { kind: "pass" } : { kind: "card" };
    if (this.unreadable) return this.jevMayDecide(call, path) && await jev() ? { kind: "pass" } : { kind: "card" };
    const fingerprint = call.input ? fingerprintOf(call.tool, call.input) : null;
    const live = fingerprint ? this.live(call, fingerprint) : undefined;
    await this.readLatestReply(call.botId, path);
    if (live) return this.judge(live, path);
    if (this.jevMayDecide(call, path) && await jev()) return { kind: "pass" };
    if (!fingerprint || !call.input) return { kind: "card" };
    const raced = this.live(call, fingerprint);
    if (raced) return this.judge(raced, path);
    const anchors = anchorsOf({ ...call, input: call.input });
    if (!anchors) return { kind: "card" };
    const now = this.now();
    const proposal: Proposal = {
      id: randomUUID(), threadId: call.threadId, botId: call.botId, reason: call.reason, tool: call.tool, fingerprint, anchors, createdAt: now,
    };
    const sameConversation = (old: Proposal) => old.threadId === call.threadId && old.botId === call.botId;
    const kept = this.proposals.filter((old) => now - old.createdAt <= PROPOSAL_TTL_MS);
    const crowded = kept.filter(sameConversation).length >= MAX_PROPOSALS_PER_CONVERSATION
      ? kept.find(sameConversation) : undefined;
    this.save([...kept.filter((old) => old !== crowded), proposal].slice(-MAX_PROPOSALS), this.used);
    return this.askedEarly(proposal, path, kept.filter(sameConversation)) ?? { kind: "ask", botText: botText({ state: "unasked" }, proposal) };
  }

  /** The bot asked before trying. Security invariant: that question counts only while no other action of this bot is
   * open in the conversation (a question after an open proposal is that proposal's), only after the last action it
   * freed, only within the window a yes lasts, and only when no other turn of the bot came between the question and
   * the yes; everything else about it is read exactly as for a proposal. */
  private askedEarly(proposal: Proposal, path: readonly WireMessage[], conversation: readonly Proposal[]): Decision | undefined {
    if (conversation.some((old) => !old.consumed)) return undefined;
    const since = Math.max(proposal.createdAt - YES_TTL_MS, ...conversation.map((old) => old.consumed!.at));
    const reading = read({ ...proposal, createdAt: since }, path, this.now(), new Set(this.used.map((entry) => entry.answerId)), true, this.assist);
    return reading.state === "answered" && reading.reply === "yes" ? this.consume(proposal, reading.line) : undefined;
  }

  /** Security invariant: Jev never decides deleting for good, work anyone but an admin asked for last, or a conversation
   * where this bot already asked. */
  private jevMayDecide(call: CriticalCall, path: readonly WireMessage[]): boolean {
    if (call.reason === "delete") return false;
    if (this.proposals.some((proposal) => proposal.threadId === call.threadId && proposal.botId === call.botId &&
      this.now() - proposal.createdAt <= PROPOSAL_TTL_MS)) return false;
    const speaker = lastHumanLine(path);
    return speaker !== undefined && isPersonLine(speaker) && speaker.sender?.admin === true;
  }

  private live(call: CriticalCall, fingerprint: string): Proposal | undefined {
    return this.proposals.find((proposal) => proposal.threadId === call.threadId && proposal.botId === call.botId &&
      proposal.fingerprint === fingerprint && !proposal.consumed && this.now() - proposal.createdAt <= PROPOSAL_TTL_MS);
  }

  /** Synchronous from reading to consuming, so two identical calls cannot share one yes. */
  private judge(proposal: Proposal, path: readonly WireMessage[]): Decision {
    const reading = read(proposal, path, this.now(), new Set(this.used.map((entry) => entry.answerId)), false, this.assist);
    if (reading.state !== "answered" || reading.reply !== "yes") return { kind: "ask", botText: botText(reading, proposal) };
    return this.consume(proposal, reading.line);
  }

  private readonly assist: ReplyAssist = (answer, question) => this.readings.get(readingKey(answer, question));

  /** Asks the model about the newest admin reply and the bot's last questions before it, once each, so `judge` can
   * read the answer without waiting. Which question that reply answers, and whether it counts, is still decided by
   * `read`; a reading only matters for the exact pair it was made for. */
  private async readLatestReply(botId: string, path: readonly WireMessage[]): Promise<void> {
    if (!this.readReply) return;
    const answerAt = path.findLastIndex((message) => isPersonLine(message) && message.sender?.admin === true);
    const answer = path[answerAt];
    if (!answer || this.now() - answer.at > YES_TTL_MS) return;
    const questions = path.slice(0, answerAt)
      .filter((message) => isOwnQuestionLine(message, botId) && answer.at - message.at <= PROPOSAL_TTL_MS && visibleText(message.text!).includes("?"))
      .slice(-2);
    await Promise.all(questions.map(async (question) => {
      const key = readingKey(answer, question);
      if (this.readings.has(key) || !replyNeedsReading(answer.text!, question.text!)) return;
      try {
        const p = await this.readReply!(answer.text!, question.text!);
        if (typeof p !== "number" || !Number.isFinite(p)) return;
        this.readings.set(key, p);
        if (this.readings.size > MAX_READINGS) this.readings.delete(this.readings.keys().next().value!);
      } catch {
        // Today's rule decides.
      }
    }));
  }

  private consume(proposal: Proposal, answer: WireMessage): Decision {
    const now = this.now();
    const by = answer.sender?.email ?? answer.sender?.name ?? "admin";
    const used = [...this.used.filter((entry) => now - entry.at <= YES_TTL_MS), { answerId: answer.id, at: now }].slice(-MAX_PROPOSALS);
    this.save(this.proposals.map((stored) => stored === proposal ? { ...stored, consumed: { at: now, answerId: answer.id, by } } : stored), used);
    return { kind: "pass", approval: { by, answerId: answer.id } };
  }

  private save(proposals: Proposal[], used: Used[]): void {
    writeFileAtomic(this.file, `${JSON.stringify({ version: 1, proposals, used })}\n`, { mode: 0o600 });
    this.proposals = proposals;
    this.used = used;
  }
}
