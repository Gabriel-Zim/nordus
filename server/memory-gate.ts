// Porteiro da consolidação de memória: decide, sem IA, se uma conversa que ficou quieta merece uma chamada de
// modelo agora, de madrugada em lote, ou nenhuma. Só regras determinísticas, e na dúvida a conversa NÃO é pulada:
// o que a pessoa pediu para lembrar, uma correção ou uma decisão nunca fica de fora.
import { captureSize, worthCapturing, type CaptureTurn } from "./memory-capture.ts";

export type GateVerdict =
  /** Nada a guardar: não custa chamada. */
  | { action: "skip"; reason: "trivial" | "nada-novo" | "cumprimento" | "sem-fala-curta" }
  /** A pessoa pediu para lembrar, corrigiu ou decidiu: consolida já, como antes do porteiro. */
  | { action: "now"; reason: "pedido-de-memoria" }
  /** Pode esperar a madrugada: entra na fila e vira uma chamada só por robô e por conversa. */
  | { action: "night"; reason: "conteudo" | "so-resposta" };

/** Resposta de rotina que não traz fato: "NADA_NOVO", "nada novo", "sem novidades". */
const NOTHING_NEW = /^\W*(?:nada[\s_-]*novo|sem[\s_-]+novidades?|nothing[\s_-]+new|no[\s_-]+news)\W*$/iu;

/**
 * Só cortesia: agradecimento, cumprimento, despedida ou teste. Um "ok", "sim" ou "pode" NÃO entra aqui: respondendo
 * a uma pergunta do robô ("quer que eu guarde isto como regra?") é uma decisão, e ela não pode ser pulada.
 */
const PLEASANTRY = new RegExp(
  `^\\W*(?:(?:${[
    "valeu", "vlw", "obrigad[oa]", "brigad[oa]", "obg", "thanks?", "thank you", "thx", "muito obrigad[oa]",
    "bom dia", "boa tarde", "boa noite", "oi", "ol[áa]", "e a[ií]", "hello", "hi", "hey", "tchau", "at[ée] mais", "falou", "abra[çc]o",
    "teste", "test", "testando", "ping",
  ].join("|")})[\\s,.!?:;~-]*)+\\W*$`,
  "iu",
);

// \b do JavaScript só conhece letras ASCII: depois de "amanhã" ou "decisão" não há fronteira. Aqui valem letras de qualquer língua.
const START = "(?<![\\p{L}\\p{N}_])";
const END = "(?![\\p{L}\\p{N}_])";
const edges = (pattern: string) => (pattern.startsWith("\\b") ? START + pattern.slice(2) : pattern).replace(/\\b$/, END);

/**
 * Pedido de memória, correção ou decisão, em português e inglês. Largo de propósito: acertar uma conversa a mais só
 * custa uma chamada imediata, errar uma a menos perderia o que a pessoa pediu para guardar.
 */
const MEMORY_CUE = new RegExp(
  [
    // pedido explícito de lembrar / guardar / anotar
    "\\blembr(?:a|e|ar|em|ando)\\b", "\\blembre-se\\b", "\\bn[ãa]o (?:se )?esque[çc]", "\\besque[çc]a\\b", "\\bguard(?:a|e|ar)\\b", "\\banot(?:a|e|ar)\\b",
    "\\bmemoriz", "\\bregistr(?:a|e|ar)\\b", "\\bsalv(?:a|e|ar)\\b", "\\bmemoria\\b", "\\bmem[óo]ria\\b", "\\bfica (?:sabendo|ligad)", "\\bsaiba que\\b", "\\bsaiba\\b",
    "\\bremember\\b", "\\bdon'?t forget\\b", "\\bkeep in mind\\b", "\\bnote (?:that|this)\\b", "\\bmake a note\\b", "\\bsave (?:this|that)\\b",
    // duradouro
    "\\ba partir de agora\\b", "\\bdaqui (?:pra|para) frente\\b", "\\bde agora em diante\\b", "\\bsempre\\b", "\\bnunca\\b", "\\bjamais\\b",
    "\\bfrom now on\\b", "\\balways\\b", "\\bnever\\b", "\\bgoing forward\\b",
    // preferência e decisão
    "\\bprefiro\\b", "\\bprefer", "\\bgosto d", "\\bn[ãa]o gosto\\b", "\\bodeio\\b", "\\bi (?:like|love|hate|want|need)\\b",
    "\\bdecidi", "\\bdecidimos\\b", "\\bficou decidido\\b", "\\bvamos (?:usar|fazer|trocar|mudar|adotar|seguir)\\b", "\\bdecided\\b", "\\bdecision\\b", "\\bdecis[ãa]o\\b",
    "\\bfechamos\\b", "\\baprovad[oa]\\b", "\\baprovei\\b", "\\baprovo\\b", "\\bapproved?\\b", "\\bregra\\b", "\\brule\\b", "\\bpadr[ãa]o\\b", "\\bcombinado\\b", "\\bn[ãa]o (?:quero|usa|use|faz|fa[çc]a|fazer)\\b",
    // correção
    "\\bcorrig", "\\bcorre[çc][ãa]o\\b", "\\bna verdade\\b", "\\berrado\\b", "\\berrou\\b", "\\bestá errado\\b", "\\bn[ãa]o [ée] (?:assim|isso|esse|essa)\\b", "\\bn[ãa]o era\\b",
    "\\bo certo [ée]\\b", "\\bcorrection\\b", "\\bthat'?s (?:wrong|not right)\\b", "\\bactually\\b", "\\bi meant\\b", "\\bwrong\\b", "\\bmistake\\b",
    // fato sobre a pessoa ou o trabalho dela
    "\\bmeu nome\\b", "\\bmy name\\b", "\\bmoro\\b", "\\bi live\\b", "\\bsou (?:o|a|um|uma)?\\s*\\p{L}", "\\btrabalho (?:com|na|no|para|pra)\\b", "\\bminha (?:empresa|esposa|filha|filho|m[ãa]e|equipe|conta|agenda)\\b",
    "\\bmeu (?:cliente|marido|pai|filho|time|site|neg[óo]cio|email|e-mail|whatsapp|n[úu]mero)\\b", "\\bmy (?:wife|husband|company|client|team|email|number|birthday)\\b",
    "\\bnasc(?:i|eu)\\b", "\\baniversário\\b", "\\bdiet", "\\balerg", "\\bvegan", "\\bvegetarian",
    // data relativa: lida de madrugada, "amanhã" apontaria para o dia errado
    "\\bhoje\\b", "\\bontem\\b", "\\bagora [àa] pouco\\b", "\\bsemana que vem\\b", "\\best[ae] semana\\b", "\\bm[êe]s que vem\\b", "\\bfim de semana\\b", "\\btoday\\b", "\\byesterday\\b", "\\bthis (?:week|weekend|month)\\b",
    "\\bamanh[ãa]\\b", "\\bsegunda\\b", "\\bter[çc]a\\b", "\\bquarta\\b", "\\bquinta\\b", "\\bsexta\\b", "\\bs[áa]bado\\b", "\\bdomingo\\b", "\\bpr[óo]xim[oa]\\b", "\\bnext (?:week|month|monday|tuesday|wednesday|thursday|friday)\\b", "\\btomorrow\\b",
  ].map(edges).join("|"),
  "iu",
);

/** Texto de rotina automática que chega como se a pessoa tivesse falado (lembrete, verificação programada). */
const AUTOMATED = /^\s*(?:\[(?:routine|rotina|automation|automa[çc][ãa]o|system|sistema)\b|<(?:routine|automation|system)\b)/iu;

function personTexts(turn: CaptureTurn): string[] {
  if (turn.room) return turn.room.filter((line) => line.by !== "peer").map((line) => line.text);
  return [turn.person];
}

function squash(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Verdadeiro quando a pessoa pediu para lembrar, corrigiu, decidiu ou disse algo duradouro sobre si ou o trabalho. */
export function hasMemoryCue(turns: readonly CaptureTurn[]): boolean {
  return turns.some((turn) => personTexts(turn).some((text) => MEMORY_CUE.test(squash(text))));
}

/** Verdadeiro quando tudo o que a pessoa disse é cumprimento, aceno ou teste. */
function onlyPleasantries(turns: readonly CaptureTurn[]): boolean {
  const spoken = turns.flatMap(personTexts).map(squash).filter(Boolean);
  return spoken.length > 0 && spoken.every((text) => text.length <= 80 && PLEASANTRY.test(text));
}

function nothingNew(text: string): boolean {
  const line = squash(text);
  return NOTHING_NEW.test(line) || /\bNADA_NOVO\s*$/u.test(line);
}

/** Fala curta da pessoa e resposta curta do robô: nada que um modelo extraísse e que o robô já não tenha guardado. */
const SHORT_REPLY_BYTES = 200;

/**
 * O porteiro. Ordem: a pessoa pediu para lembrar → agora (nunca pulada); sem nada de conteúdo → pula; o resto espera a
 * madrugada. Uma regra só pula quando não há nenhuma pista de memória em todas as falas da pessoa.
 */
export function gateCapture(turns: readonly CaptureTurn[]): GateVerdict {
  if (!worthCapturing(turns)) return { action: "skip", reason: "trivial" };
  if (hasMemoryCue(turns)) return { action: "now", reason: "pedido-de-memoria" };
  const { said, replied } = captureSize(turns);
  if (turns.every((turn) => !turn.bot.trim() || nothingNew(turn.bot)) && (said === 0 || turns.every((turn) => AUTOMATED.test(turn.person)))) {
    return { action: "skip", reason: "nada-novo" };
  }
  if (said > 0 && onlyPleasantries(turns)) return { action: "skip", reason: "cumprimento" };
  if (said === 0) {
    // ninguém falou: só a resposta do robô conta, e uma curta ou de rotina não traz resultado verificado
    return replied < SHORT_REPLY_BYTES || turns.every((turn) => nothingNew(turn.bot))
      ? { action: "skip", reason: "sem-fala-curta" }
      : { action: "night", reason: "so-resposta" };
  }
  return { action: "night", reason: "conteudo" };
}

/** A janela da madrugada em que a fila de consolidação e a arrumação noturna rodam, em hora cheia de um fuso. */
export interface NightWindow {
  /** Hora de início (0-23), inclusive. */
  startHour: number;
  /** Hora de fim (0-23), exclusive. Menor que o início cruza a meia-noite. */
  endHour: number;
  /** Fuso IANA, como "America/Sao_Paulo". */
  timeZone: string;
}

export const DEFAULT_NIGHT_WINDOW: NightWindow = { startHour: 2, endHour: 5, timeZone: "America/Sao_Paulo" };

/** A hora (0-23) em que `now` cai no fuso; cai para o fuso do servidor se o nome do fuso for inválido. */
export function hourIn(now: Date, timeZone: string): number {
  try {
    const hour = new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone }).formatToParts(now).find((part) => part.type === "hour")?.value;
    const parsed = Number(hour);
    if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 23) return parsed;
  } catch {
    // fuso desconhecido: usa o do servidor
  }
  return now.getHours();
}

export function inNightWindow(now: Date, window: NightWindow): boolean {
  const hour = hourIn(now, window.timeZone);
  if (window.startHour === window.endHour) return true;
  return window.startHour < window.endHour ? hour >= window.startHour && hour < window.endHour : hour >= window.startHour || hour < window.endHour;
}
