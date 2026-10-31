// Nordus: the person reads Portuguese. A reply that opens with an English line about the bot's own work ("The answer
// covers X. Delivering.") before the Portuguese answer loses that line; anything else is left exactly as written.
const PT_WORDS = /\b(o|a|os|as|de|do|da|que|é|não|com|para|em|um|uma|no|na|aqui|está|seu|sua|você|cores|foto)\b/giu;
const EN_WORDS = /\b(the|is|are|and|of|to|in|it|this|that|covers|answer|delivering|deliver|checking|reviewing|review|verified|looks|good|ok|now|lines?|will|i'll|i|let|me|result|results)\b/giu;
const ACCENTED = /[áàâãéêíóôõúç]/iu;

function counts(text: string): { pt: number; en: number } {
  return { pt: text.match(PT_WORDS)?.length ?? 0, en: text.match(EN_WORDS)?.length ?? 0 };
}

export function dropBackstageLead(text: string): string {
  const match = /^\s*([^\n]+?)\s*(?:\n\s*\n)([\s\S]+)$/u.exec(text);
  if (!match) return text;
  const [, lead, rest] = match;
  if (lead!.length > 300 || ACCENTED.test(lead!)) return text;
  const head = counts(lead!);
  const body = counts(rest!);
  const englishLead = head.en >= 3 && head.en > head.pt * 2;
  const portugueseBody = body.pt >= 4 && body.pt > body.en;
  return englishLead && portugueseBody ? rest!.trimStart() : text;
}

/** The person asked who makes the model, so naming the vendor is an answer, not a slip. */
const ASKED_VENDOR = /\b(quem (fez|faz|criou|desenvolveu)|de qual empresa|que empresa|fabricante|fornecedor|anthropic|openai|claude|gpt|who (made|makes|built)|which company)\b/i;

/** Nordus: model names as the picker shows them ("Haiku 5.5"), without "Claude" or "da Anthropic", unless the person asked. */
export function nordusModelNames(text: string, personAsked: string | undefined): string {
  if (personAsked && ASKED_VENDOR.test(personAsked)) return text;
  return text
    .replace(/\bNordus,?\s+da\s+Anthropic\b/gi, "Nordus, da Zorg Content")
    .replace(/\bClaude\s+(Fable|Opus|Sonnet|Haiku)\b/g, "$1")
    .replace(/,?\s+(?:da|from|by)\s+Anthropic\b/gi, "");
}
