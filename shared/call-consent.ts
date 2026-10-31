// Spoken answers to a permission card, shared by both call modes. Anything
// else is read as a reply to the bot, not as consent — an approval must
// never be granted by a sentence that merely contained the word "sure".
export const YES = /^(yes|yeah|yep|yup|sure|ok|okay|go ahead|do it|allow|approve|approved|fine|please do)\b/i;
export const NO = /^(no|nope|don'?t|do not|stop|deny|denied|cancel|never|skip it)\b/i;

const FILLER = /^(?:(?:um+|uh+|er+|so|well|hmm+)[\s,.!?-]+)+/i;
/** On a Live call these only hedge: "okay…" then a pause then "wait, what
 * does it delete?", a bystander's "okay", or the voice's own "Okay, I need
 * your permission" heard back through a phone's speaker. They are filler
 * there, never the answer; a clear yes or no after them still counts. */
const LIVE_HEDGES = /^(?:(?:um+|uh+|er+|so|well|hmm+|ok|okay|sure|fine)(?:[\s,.!?-]+|$))+/i;
// A Live approval grants the entire action on the card. Extra conditions,
// questions or corrections are not permission for that unchanged action.
const LIVE_YES = /^(?:yes|yeah|yep|yup|go ahead|do it|allow(?: it)?|approve(?: it)?|approved|please do)(?:[\s,]+(?:please|go ahead|do it))*[.!]*$/i;

/** "allow", "deny", or null when the words are not a clear decision. The
 * answer must open the utterance; filler before it ("uh, yes") is dropped.
 * `live`: a Live call, whose microphone stays open while the voice speaks
 * and which decides after a short quiet window — hedges never decide there.
 * `turns` (take turns) keeps its own rule: its microphone is closed while
 * the bot talks. */
export function spokenConsent(text: string, mode: "turns" | "live" = "turns"): "allow" | "deny" | null {
  const said = text.trim().replace(mode === "live" ? LIVE_HEDGES : FILLER, "");
  if ((mode === "live" ? LIVE_YES : YES).test(said)) return "allow";
  if (NO.test(said)) return "deny";
  return null;
}

const WRAP_UP_LEAD = /^(?:(?:ok|okay|certo|beleza|entao|ah|bom|bem|olha|acho que|eu acho que|i think|well|yeah|yes|sim)\s+)+/;
const WRAP_UP_TAIL = /(?:\s+(?:obrigado|obrigada|brigado|valeu|thanks|thank you|mesmo|ai|por hoje|por agora|pra mim|para mim|por enquanto|for now|for today|ok|okay|ta bom))+$/;
const WRAP_UP_CORE = /^(?:so isso|e so isso|era so isso|e isso|e isso ai|isso mesmo|isso e tudo|e tudo|e tudo por hoje|nada mais|mais nada|nao preciso de mais nada|ta otimo|esta otimo|ta bom assim|esta bom assim|ta bom|esta bom|ta tudo certo|pode ir|pode desligar|pode encerrar|pode fechar|ta fechado|fechado|that is all|thats all|thats it|that is it|nothing else|nothing more|im good|i am good|we are good|were good|all good|you can go|go ahead and hang up)$/;

/** True when the whole utterance only says the person has nothing more to ask
 * ("por enquanto tá ótimo", "só isso", "pode ir", "that's all"). A sentence
 * that carries any other content is a request, never a goodbye. */
export function spokenWrapUp(text: string): boolean {
  let said = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2019']/g, "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  if (!said || said.length > 60) return false;
  said = said.replace(WRAP_UP_LEAD, "");
  let previous = "";
  while (previous !== said) {
    previous = said;
    said = said.replace(WRAP_UP_TAIL, "").trim();
  }
  said = said.replace(WRAP_UP_LEAD, "").replace(/^por enquanto\s+/, "");
  return WRAP_UP_CORE.test(said);
}
