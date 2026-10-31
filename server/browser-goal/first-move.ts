import { completeJson, type TextModel } from "./model.ts";
import { goalMet } from "./tool.ts";

/** Words that make a message worth asking the planner about; everything else goes straight to the bot. */
export const BROWSE_HINT = /https?:\/\/|\bwww\.|\.(?:com|br|net|org|io)\b|\b(?:airbnb|booking|google|amazon|mercado ?livre|youtube|decolar|expedia|trivago|kayak|skyscanner|tripadvisor|olx|zillow|linkedin|instagram)\b|\b(?:entr[ae]|abr[ae]|acess[ae]|naveg[ae]|visit[ae]|open|go to|browse)\b.{0,40}\b(?:site|p[aá]gina|no|na|em|page|website)\b/iu;

const PLAN = `You decide whether a person's message asks a bot to use a website right now, and if so you plan the first browser move.
Answer JSON only: {"browse": false} or {"browse": true, "url": "...", "results": "...", "goal": "..."}.
browse is true only when the message asks to open, search or check something on a website now.
url: the https page where a person would start, usually the site's home page, so the search is typed there.
results: the https page with the results already open, built with every value from the message when the site has a
known search URL, for example:
- Airbnb: https://www.airbnb.com.br/s/<City>/homes?checkin=YYYY-MM-DD&checkout=YYYY-MM-DD&adults=N
- Booking: https://www.booking.com/searchresults.pt-br.html?ss=<City>&checkin=YYYY-MM-DD&checkout=YYYY-MM-DD&group_adults=N&no_rooms=1&group_children=0
- Google: https://www.google.com/search?q=<terms>
When no such URL is known, results is the same as url.
Dates without a year are the next time that date comes after today. Never put a password, card or personal document in the url.
goal: one short English sentence with every value to type or pick on the page (place, dates without the year, guests) and
where to stop, ending on the list of results.
Never ask to book, buy, pay, sign in or send anything.`;

export interface BrowsePlan { url: string; results: string; goal: string }

/** The built-in browser beside the turn's computer: always for a browsing request, which the fast pilot serves, unless
 * the bot has its computer and browser off; otherwise only when no computer was mounted by the turn's own choice. */
export function builtInBrowserBeside(plan: { computer?: string; browser: boolean }, autoComputer: boolean, message: string): boolean {
  if (plan.computer === "off" && !plan.browser) return false;
  if (BROWSE_HINT.test(message)) return true;
  return plan.browser && !(plan.computer === undefined && autoComputer);
}

function httpsPage(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && parsed.hostname.includes(".") ? parsed.toString() : null;
  } catch { return null; }
}

export async function planBrowse(model: TextModel, message: string, today: Date, options: { timeoutMs: number; fetch?: typeof fetch }): Promise<BrowsePlan | null> {
  if (!BROWSE_HINT.test(message)) return null;
  const answer = await completeJson(model, PLAN, { today: today.toISOString().slice(0, 10), message: message.slice(0, 2000) }, options);
  if (!answer || answer.filtered || answer.output.browse !== true) return null;
  const { goal } = answer.output;
  const given = httpsPage(answer.output.url);
  if (!given || typeof goal !== "string" || !goal.trim() || goal.length > 500) return null;
  const results = upcoming(httpsPage(answer.output.results) ?? given, today);
  return { url: startPage(given, results), results, goal: goal.trim() };
}

/** A search starts at the site's home, so the person sees it typed, even when the planner started on a results page. */
function startPage(url: string, results: string): string {
  const parsed = new URL(url);
  const searching = results !== url && new URL(results).origin === parsed.origin;
  return parsed.search || searching ? `${parsed.origin}/` : url;
}

/** A date the planner wrote in the past means the next time it comes. */
function upcoming(url: string, today: Date): string {
  const parsed = new URL(url);
  const now = today.toISOString().slice(0, 10);
  for (const [key, value] of parsed.searchParams) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value) && value < now) parsed.searchParams.set(key, `${Number(value.slice(0, 4)) + 1}${value.slice(4)}`);
  }
  return parsed.toString();
}

const resultsKind = (url: string) => new URL(url).pathname.split("/")[1]?.split(".")[0] ?? "";

/** Only a met goal on a results page stands; anywhere else the planned results page is opened. */
export function needsResults(plan: BrowsePlan, resultText: string): boolean {
  if (plan.results === plan.url) return false;
  if (!goalMet(resultText)) return true;
  const reached = /^Page: .* · (https?:\/\/\S+)$/m.exec(resultText)?.[1];
  if (!reached) return false;
  const kind = resultsKind(plan.results);
  return !kind || new URL(reached).origin !== new URL(plan.results).origin || resultsKind(reached) !== kind;
}

export function browseNote(plan: BrowsePlan, result: string): string {
  return [
    "The browser already started on this message, before your turn: the fast pilot worked on",
    `the goal "${plan.goal}" from ${plan.url}. The person watched it live. Its outcome:`,
    result.trim(),
    "The page is still open in your browser. Answer now from the results above: pick the best options by the price, rating and",
    "reviews the list shows, with their links. Do not open listings, search the web or call the browser again unless the person",
    "asked for a detail the list does not show.",
  ].join("\n");
}
