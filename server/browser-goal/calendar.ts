import type { PageAction, PageState } from "./model.ts";

const MONTHS = [
  ["january", "janeiro", "enero"], ["february", "fevereiro", "febrero"], ["march", "março", "marzo"],
  ["april", "abril"], ["may", "maio", "mayo"], ["june", "junho", "junio"], ["july", "julho", "julio"],
  ["august", "agosto"], ["september", "setembro", "septiembre"], ["october", "outubro", "octubre"],
  ["november", "novembro", "noviembre"], ["december", "dezembro", "diciembre"],
];
const FORWARD = /pr[oó]xim[oa] m[eê]s|next month|mes siguiente|forward.{0,30}month|avan[cç]\w*.{0,30}m[eê]s/iu;
const word = (name: string) => `(?<!\\p{L})${name}(?!\\p{L})`;

/** The names of the month a dated goal starts in, or null when the goal names no day of a month. */
export function goalMonth(goal: string): string[] | null {
  let first: { at: number; names: string[] } | null = null;
  for (const names of MONTHS) {
    const any = names.map(word).join("|");
    const at = goal.search(new RegExp(`(?:${any})\\s+\\d{1,2}(?!\\d)|(?<!\\d)\\d{1,2}(?:st|nd|rd|th)?\\s+(?:de\\s+|of\\s+)?(?:${any})`, "iu"));
    if (at >= 0 && (!first || at < first.at)) first = { at, names };
  }
  return first?.names ?? null;
}

/** An open date picker's next-month control, when the month the goal starts in is not on screen yet. */
export function monthForward(page: PageState, goal: string): PageAction | null {
  const month = goalMonth(goal);
  if (!month) return null;
  const forward = page.actions.find((action) => action.kind === "click" && action.node !== undefined && FORWARD.test(action.label));
  if (!forward) return null;
  const shown = [page.text, ...page.actions.map((action) => action.label)].join("\n");
  return month.some((name) => new RegExp(word(name), "iu").test(shown)) ? null : forward;
}
