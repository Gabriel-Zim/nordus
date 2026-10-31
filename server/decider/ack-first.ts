// Nordus: a person's request that needs work gets an immediate short line from the bot that fits the request
// ("Anotado, te lembro." for a reminder, "Deixa eu checar." for a question), then the result. One decision-model call
// says whether work is needed and what kind of request it is; the line comes from a bank of phrases in rotation,
// so it costs nothing to write. Never throws.
import type { Decider } from "./index.ts";

export const ACK_TIMEOUT_MS = 1_200;
export const ACK_MIN_PROBABILITY = 0.6;
/** Below this the kind is a guess: the neutral "check" phrases are used. */
export const ACK_KIND_MIN_PROBABILITY = 0.5;
export const ACK_INSTRUCTIONS = "Before it can answer `new_message`, will the bot need to do some work: look something up, use a tool or an app, make or change something (a text, an image, a post, a file), schedule something, or work for more than a few seconds? No for greetings, thanks, small talk, and answers it already knows.";
export const ACK_KIND_INSTRUCTIONS = "What kind of request is `new_message`?";

export type AckKind = "action" | "reminder" | "check" | "creative" | "fix" | "urgent";
const KIND_OPTIONS: Record<AckKind, string> = {
  action: "A task to do now: send, schedule or post something, organize, update or set up something.",
  reminder: "A reminder, or something to schedule or remember for later.",
  check: "A question that needs looking something up, checking or consulting.",
  creative: "A long or creative piece to make: a text, an art, a plan, a carousel, a video.",
  fix: "A correction or change to something already done.",
  urgent: "Something urgent, or a problem happening right now.",
};

/** Plain thanks, greetings and okays never get a line, without asking. */
const QUICK = /^\s*(ok(ay)?|blz|beleza|valeu|vlw|obrigad[oa]|brigad[oa]|tks|thanks|bom dia|boa tarde|boa noite|oi|ol[aá]|e a[ií]|tudo bem\??|show|top|perfeito|massa|isso|sim|n[aã]o|👍|🙏|❤️)[\s!.?,]*$/iu;

export function quickMessage(text: string): boolean {
  return QUICK.test(text) || text.trim().length < 4;
}

/** The way a person answers: short, no name, no dash, no jargon. Fifty phrases in six kinds. */
export const ACK_LINES: Record<AckKind, readonly string[]> = {
  action: [
    "Fechado, já faço.", "Beleza, vou fazer.", "Deixa comigo.", "Certo, já cuido disso.", "Combinado, faço agora.",
    "Ok, já começo.", "Tá, vou resolver.", "Pode deixar, faço já.", "Ok, vou fazer agora.", "Entendido, já vou.",
  ],
  reminder: [
    "Anotado, te lembro.", "Combinado, vou agendar.", "Fechado, fica marcado.", "Ok, vou deixar agendado.",
    "Anotado, não esqueço.", "Certo, vou programar.", "Beleza, te aviso na hora.", "Combinado, deixo lembrado.",
  ],
  check: [
    "Deixa eu checar.", "Vou verificar isso.", "Um segundo, já vejo.", "Vou olhar aqui.", "Já confiro.",
    "Deixa eu ver.", "Vou consultar e te falo.", "Só um instante, vou ver.", "Já dou uma olhada.", "Vou conferir agora.",
  ],
  creative: [
    "Entendi, vou montar.", "Bora, já começo.", "Boa, vou preparar.", "Ok, vou criar isso.",
    "Fechado, vou desenhar.", "Certo, vou escrever.", "Gostei, já começo a montar.", "Entendi a ideia, vou fazer.",
  ],
  fix: [
    "Ok, entendi. Já ajusto.", "Certo, corrijo.", "Entendi, vou ajustar.", "Beleza, já mudo.",
    "Pode deixar, eu arrumo.", "Ok, vou corrigir isso.", "Anotado, ajusto agora.", "Certo, refaço.",
  ],
  urgent: ["Já estou vendo.", "Vou agora mesmo.", "Já estou nisso.", "Na hora, já vejo.", "Já estou cuidando.", "Indo agora."],
};

/** The next phrase of the kind in rotation, never the same as the last line in this conversation. */
export function ackLine(kind: AckKind, turn: number, last?: string): string {
  const lines = ACK_LINES[kind];
  const start = Math.abs(Math.trunc(turn)) % lines.length;
  for (let step = 0; step < lines.length; step++) {
    const line = lines[(start + step) % lines.length]!;
    if (line !== last) return line;
  }
  return lines[start]!;
}

/** The kind of request when it needs work, or null when it needs no line (or Jev could not say). */
export async function needsWork(decider: Pick<Decider, "ask">, text: string, options: { timeoutMs?: number } = {}): Promise<AckKind | null> {
  try {
    if (quickMessage(text)) return null;
    const result = await decider.ask("ackFirst", { new_message: text.trim().slice(0, 2_000) }, {
      work: { type: "yesno", instructions: ACK_INSTRUCTIONS },
      kind: { type: "choice", instructions: ACK_KIND_INSTRUCTIONS, options: KIND_OPTIONS },
    }, { timeoutMs: options.timeoutMs ?? ACK_TIMEOUT_MS });
    if (!result.ok) return null;
    const answers = result.answers as { work: { p: number }; kind: { choice: AckKind; pTop: number } };
    if ((answers.work?.p ?? 0) < ACK_MIN_PROBABILITY) return null;
    const kind = answers.kind;
    return kind && kind.pTop >= ACK_KIND_MIN_PROBABILITY && kind.choice in ACK_LINES ? kind.choice : "check";
  } catch {
    return null;
  }
}

/** What the bot reads so it does not say it again. */
export function ackNote(line: string): string {
  return `Nordus already sent the person this line from you: "${line}". Do not write another acknowledgement such as "um momento" or "vou checar"; your next words are the result itself.`;
}
