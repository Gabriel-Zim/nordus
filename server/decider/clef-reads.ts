// Readings the decision model (CLEF in production) makes where a fixed rule used to be the only judge. Each one only
// ever helps the rule: it is asked when the rule could not decide, answers null on any failure, and the caller keeps
// today's behaviour then. None of them chooses who may approve, retries anything, or reads the critical-action list.
import { redactSecretsInText } from "../../shared/redact.ts";
import type { TurnErrorClass } from "../../shared/turn-error.ts";
import type { Decider } from "./index.ts";
import type { AskOptions } from "./types.ts";

/** A reading counts as yes only from this probability up. */
export const CLEF_YES_MIN = 0.85;
/** Silencing a routine or calling the Chief needs more: a wrong one hides news or wakes someone for nothing. */
export const CLEF_QUIET_MIN = 0.9;
export const CLEF_NEEDS_INPUT_MIN = 0.9;
export const CLEF_CHOICE_MIN = 0.85;
export const CLEF_CHOICE_MARGIN = 0.3;
export const CLEF_ERROR_MIN = 0.8;

/** Secrets never leave in a question; long text is cut. */
const clip = (raw: string, max: number) => {
  const text = redactSecretsInText(raw);
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
};

type Asker = Pick<Decider, "ask">;
type Chooser = Pick<Decider, "choose">;

async function yesProbability(
  decider: Asker,
  seam: Parameters<Decider["ask"]>[0],
  state: unknown,
  instructions: string,
  criteria: { yes: string; no: string },
  options?: AskOptions,
): Promise<number | null> {
  try {
    const result = await decider.ask(seam, state, { answer: { type: "yesno", instructions, criteria } }, options);
    return result.ok ? result.answers.answer.p : null;
  } catch {
    return null;
  }
}

const APPROVAL_INSTRUCTIONS =
  "A pessoa respondeu à pergunta do robô com um sim claro, autorizando exatamente o que foi perguntado, sem condição, sem troca, sem dúvida e sem pedir para esperar?";
const APPROVAL_CRITERIA = {
  yes: "Um sim claro para o que foi perguntado, do jeito que foi perguntado.",
  no: "Um não, uma espera, uma dúvida, uma condição, um pedido de mudança, ou outro assunto.",
};

/** The probability that a typed reply is a plain yes to the bot's question; null when the model could not say. */
export function readApprovalReply(decider: Asker, reply: string, question: string, options?: AskOptions): Promise<number | null> {
  return yesProbability(decider, "replyReading", { pergunta_do_robo: clip(question, 1_500), resposta_da_pessoa: clip(reply, 600) },
    APPROVAL_INSTRUCTIONS, APPROVAL_CRITERIA, options);
}

/** The same for words heard on a call, in any language. */
export function readSpokenConsent(decider: Asker, said: string, asked: string, options?: AskOptions): Promise<number | null> {
  return yesProbability(decider, "voiceConsent", { pedido_do_robo: clip(asked, 600), fala_da_pessoa: clip(said, 400) },
    "A pessoa, em qualquer idioma, autorizou com um sim claro exatamente o que o robô pediu, sem condição, sem troca, sem dúvida e sem pedir para esperar?",
    APPROVAL_CRITERIA, options);
}

/** Which offered option a 👍 or 👎 on a question card means; null when none clearly does. */
export async function readReactionOption(
  decider: Chooser,
  input: { question: string; options: readonly string[]; answer: "yes" | "no" },
  options?: AskOptions,
): Promise<string | null> {
  const labels = input.options.slice(0, 50);
  if (labels.length === 0) return null;
  const criteria: Record<string, string> = Object.fromEntries(labels.map((label, index) => [`o${index}`, clip(label, 200)]));
  criteria.nenhuma = "Nenhuma opção corresponde a essa reação.";
  try {
    const result = await decider.choose("reactionReading", {
      pergunta: clip(input.question, 1_000),
      reacao: input.answer === "yes" ? "👍 (concordo, sim)" : "👎 (discordo, não)",
    }, {
      instructions: "A pessoa reagiu à pergunta com esse emoji em vez de escolher. Qual opção a reação quer dizer?",
      options: criteria,
    }, options);
    if (!result.ok || result.answers.choice === "nenhuma") return null;
    if (result.answers.pTop < CLEF_CHOICE_MIN || result.answers.margin < CLEF_CHOICE_MARGIN) return null;
    return labels[Number(result.answers.choice.slice(1))] ?? null;
  } catch {
    return null;
  }
}

/** A reply the model may be asked about at all: short, asking nothing. */
export function nothingNewAskable(reply: string): boolean {
  const text = reply.trim();
  return Boolean(text) && text.length <= 1_200 && !text.includes("?") && !/needs input:/i.test(text);
}

/** Whether a news-only routine's reply says only that nothing changed. Never for a reply that asks something. */
export async function readNothingNew(decider: Asker, input: { reply: string; prompt: string }, options?: AskOptions): Promise<boolean> {
  const reply = input.reply.trim();
  if (!nothingNewAskable(reply)) return false;
  const p = await yesProbability(decider, "routineNews", { pedido_da_rotina: clip(input.prompt, 2_000), resposta_do_robo: reply },
    "Esta rotina só deve avisar quando houver novidade. A resposta do robô diz apenas que nada mudou, sem novidade, sem erro, sem pendência e sem nada que precise de uma pessoa?",
    { yes: "Só diz que não há nada novo.", no: "Traz uma novidade, um dado, um erro, um aviso, uma pendência ou uma pergunta." }, options);
  return p !== null && p >= CLEF_QUIET_MIN;
}

/** The question a bot's last reply stopped on, when the model says the work waits on the person; undefined otherwise. */
export async function readNeedsInput(decider: Asker, reply: string, options?: AskOptions): Promise<string | undefined> {
  const text = reply.trim();
  if (!text) return undefined;
  const p = await yesProbability(decider, "needsInput", { resposta_do_robo: clip(text, 3_000) },
    "O robô terminou parado, esperando uma resposta, um arquivo ou uma decisão da pessoa para conseguir continuar o trabalho que ela pediu?",
    {
      yes: "O trabalho está travado até a pessoa responder.",
      no: "O trabalho terminou, ou o robô só oferece algo opcional (\"quer que eu…?\"), ou só informa.",
    }, options);
  if (p === null || p < CLEF_NEEDS_INPUT_MIN) return undefined;
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return clip(lines.findLast((line) => line.includes("?")) ?? lines.at(-1) ?? text, 300);
}

/** Classes the model may pick for an unclassified failure: only to choose the sentence the app shows. Usage limits
 * stay with the rule, since their reset time drives what the app offers. */
const ERROR_OPTIONS = {
  "engine-unreachable": "O motor de IA não pôde ser alcançado (conexão recusada, rede, serviço parado).",
  "signed-out": "A conta do motor saiu, a sessão expirou ou a chave foi recusada.",
  "engine-down": "O motor respondeu, mas está sobrecarregado, deu erro interno ou caiu.",
  "disk-full": "O computador que roda o Nordus ficou sem espaço em disco.",
  interrupted: "O turno foi interrompido (reinício, parada, troca de configuração, sem atividade).",
  outro: "Nenhuma dessas: outro tipo de falha.",
} as const satisfies Partial<Record<TurnErrorClass | "outro", string>>;

export async function readTurnErrorClass(decider: Chooser, cause: string, options?: AskOptions): Promise<Exclude<TurnErrorClass, "usage-limit"> | null> {
  const text = cause.trim();
  if (!text) return null;
  try {
    const result = await decider.choose("turnError", { erro: clip(text, 1_500) }, {
      instructions: "Que tipo de falha parou o turno do robô?",
      options: ERROR_OPTIONS,
    }, options);
    if (!result.ok || result.answers.choice === "outro" || result.answers.pTop < CLEF_ERROR_MIN) return null;
    return result.answers.choice;
  } catch {
    return null;
  }
}
