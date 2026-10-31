// A short message from the person that only says "stop" ("para", "esquece isso", "cancela", "chega") ends the bot's
// running turn, the way the Stop button does. Anything longer, or with another request in it, is not a stop.

export type StopReply = "stop" | "other";

/** What the bot says once a message stopped it. */
export const STOPPED_REPLY = "Parei. Quer que eu retome depois?";

const STOP_WORDS = new Set(["para", "pare", "parar", "paralisa", "esquece", "esqueca", "cancela", "cancele", "cancelar", "chega", "interrompe", "interrompa", "stop"]);
/** Words that may sit around the stop word without asking for anything else. */
const AROUND = new Set([
  "por", "favor", "pf", "pfv", "ok", "okay", "ta", "beleza", "blz", "ai", "agora", "isso", "tudo", "entao", "pode", "ja",
  "mais", "com", "so", "e", "o", "a", "pra", "la", "deixa", "esse", "essa", "aqui", "logo", "mesmo", "ei", "opa", "ow", "oi",
]);
const MAX_WORDS = 7;

function words(text: string): string[] {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/@\S+/g, " ").match(/[a-z]+/g) ?? [];
}

/** "stop" when the message is a plain request to stop; the bot's own names, if given, are ignored around it. */
export function isStopRequest(text: string, names: readonly string[] = []): StopReply {
  const own = new Set(names.flatMap(words));
  const said = words(text).filter((word) => !own.has(word));
  if (said.length === 0 || said.length > MAX_WORDS) return "other";
  const deixaPraLa = /\bdeixa (?:pra|para) la\b/.test(said.join(" "));
  if (!deixaPraLa && !said.some((word) => STOP_WORDS.has(word))) return "other";
  return said.every((word) => STOP_WORDS.has(word) || AROUND.has(word)) ? "stop" : "other";
}
