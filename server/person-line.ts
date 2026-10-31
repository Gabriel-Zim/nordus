// Nordus: what a bot's own back-office conversation (team incidents, escalations) brings to the person. The bot marks
// the one line that is for the person; only that line reaches the person's conversation, nothing else of the notice.
export const PERSON_LINE_MARKER = "PARA A PESSOA:";
export const PERSON_LINE_MAX = 300;

const MARKED = /^[\s*_>`"-]*para a pessoa\s*:[\s*_`"]*(.*)$/i;

/** The marked line of a reply, as one short line; null when the reply keeps it all backstage. */
export function personLineFrom(text: string | undefined): string | null {
  if (!text?.trim()) return null;
  const lines = text.split(/\r?\n/);
  const at = lines.findIndex((line) => MARKED.test(line));
  if (at < 0) return null;
  const rest = [MARKED.exec(lines[at]!)![1]!, ...lines.slice(at + 1)].join(" ").replace(/[*_`]+$/g, "").replace(/\s+/g, " ").trim();
  if (!rest) return null;
  if (rest.length <= PERSON_LINE_MAX) return rest;
  const cut = rest.slice(0, PERSON_LINE_MAX);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return end > 40 ? cut.slice(0, end + 1) : `${cut.slice(0, PERSON_LINE_MAX - 1).trimEnd()}…`;
}
