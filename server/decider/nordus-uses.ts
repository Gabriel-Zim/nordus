// The Nordus uses of the decision model beyond room routing. Every helper never throws and answers null when the
// decision model is off, slow, unsure or failing: the caller then does what it did before.
import type { ModelCatalog } from "../contracts.ts";
import type { Decider } from "./index.ts";
import { BOT_TAG_AREAS, tagSearchKey, tagSuggestionRequest, type BotTagSuggestionRequest } from "../../shared/bot-tags.ts";

/** Each use waits at most this long; a turn never waits on Jev for more. */
export const NORDUS_USE_TIMEOUT_MS = 1_200;
const NAME_MAX = 80;
const ABOUT_MAX = 400;
const TEXT_MAX = 4_000;

type Asker = Pick<Decider, "choose" | "score" | "yesNo">;
type Opts = { signal?: AbortSignal; timeoutMs?: number };

function clip(value: string | undefined, max: number): string {
  const flat = (value ?? "").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

const ask = (opts: Opts) => ({ timeoutMs: opts.timeoutMs ?? NORDUS_USE_TIMEOUT_MS, ...(opts.signal ? { signal: opts.signal } : {}) });

// ---- Which bot owns an inbox item (the Boss hand-off itself lives in boss-dispatch.ts) ----

export const OWNER_NONE_OPTION = "__none__";
export const OWNER_MIN_PROBABILITY = 0.7;

export interface DispatchMember { id: string; name: string; title?: string; description?: string }

export async function chooseOwner(
  decider: Asker,
  seam: "emailTriage" | "portalRouting",
  input: { members: DispatchMember[]; text: string; instructions: string },
  opts: Opts = {},
): Promise<{ botId: string; probability: number } | null> {
  try {
    if (!input.members.length || !input.text.trim()) return null;
    const options: Record<string, string> = { [OWNER_NONE_OPTION]: "No bot clearly fits." };
    for (const member of input.members) {
      const title = clip(member.title, NAME_MAX);
      const about = clip(member.description, ABOUT_MAX);
      options[member.id] = `${clip(member.name, NAME_MAX) || "Unnamed bot"}${title ? `, ${title}` : ""}.${about ? ` ${about}` : ""}`;
    }
    const result = await decider.choose(seam, { new_message: input.text.trim().slice(0, TEXT_MAX) }, { instructions: input.instructions, options }, ask(opts));
    if (!result.ok) return null;
    const { choice, pTop } = result.answers;
    if (choice === OWNER_NONE_OPTION || pTop < OWNER_MIN_PROBABILITY) return null;
    return input.members.some((member) => member.id === choice) ? { botId: choice, probability: pTop } : null;
  } catch {
    return null;
  }
}

// ---- 4. Right-size the model ----

export type TurnSize = "light" | "normal" | "heavy";
export const TURN_SIZE_LEVELS = [
  "Light: a greeting, a thanks, a yes or no, a quick fact or a one-line answer.",
  "Normal: an ordinary request, a short text, a summary, a simple change or a question that needs some thought.",
  "Heavy: long or careful work, several steps, code, analysis, strategy, a full piece of writing or anything with tools and files.",
] as const;
export const TURN_SIZE_INSTRUCTIONS = "How much thinking does the bot's reply to `new_message` need?";
const SIZES: TurnSize[] = ["light", "normal", "heavy"];
/** Below this the size is a guess: the bot keeps its own model. */
export const TURN_SIZE_MIN_PROBABILITY = 0.55;

export async function sizeTurn(
  decider: Asker,
  input: { text: string; previous?: string; attachments?: number },
  opts: Opts = {},
): Promise<TurnSize | null> {
  try {
    if (!input.text.trim()) return null;
    const state = {
      new_message: input.text.trim().slice(0, TEXT_MAX),
      ...(input.previous?.trim() ? { previous_bot_reply: clip(input.previous, 600) } : {}),
      ...(input.attachments ? { attachments: input.attachments } : {}),
    };
    const result = await decider.score("modelSize", state, { instructions: TURN_SIZE_INSTRUCTIONS, levels: [...TURN_SIZE_LEVELS] }, ask(opts));
    if (!result.ok) return null;
    const { level, probabilities } = result.answers;
    if ((probabilities[level] ?? 0) < TURN_SIZE_MIN_PROBABILITY) return null;
    return SIZES[level] ?? null;
  } catch {
    return null;
  }
}

const LIGHT = /(^|[-_/. ])(haiku|flash|mini|nano|lite|small|fast|instant|spark|turbo|air)(?=$|[-_/. \d])/i;
const HEAVY = /(^|[-_/. ])(opus|max|ultra|large|pro|heavy)(?=$|[-_/. \d])/i;
/** Above the heavy tier (Claude Fable sits above Opus): never picked for a size, only kept as the bot's own model. */
const TOP = /(^|[-_/. ])(fable)(?=$|[-_/. \d])/i;

/** 0 light, 1 normal, 2 heavy, 3 above heavy, read from the model's name. */
export function modelRank(id: string): 0 | 1 | 2 | 3 {
  if (TOP.test(id)) return 3;
  if (LIGHT.test(id)) return 0;
  if (HEAVY.test(id)) return 2;
  return 1;
}

/** The model for this size from the same provider, never above the bot's own; null keeps the bot's model. An engine
 * that pins a conversation to its first model is never sized down: the next turn would be refused. */
export function modelForSize(catalog: ModelCatalog | undefined, botModel: string, size: TurnSize, engine: { pinnedSessionModel?: boolean } = {}): string | null {
  if (!catalog || engine.pinnedSessionModel) return null;
  return pickForSize(catalog, botModel, size);
}

/** Bots with a fixed model and the Boss: only a light request moves, and it goes to the newest Sonnet of the same
 * engine and account (never Haiku); normal and heavy keep the bot's own. Claude bots only. */
export function sonnetForSimple(catalog: ModelCatalog | undefined, botModel: string, size: TurnSize, engine: { pinnedSessionModel?: boolean } = {}): string | null {
  if (!catalog || engine.pinnedSessionModel || size !== "light") return null;
  if (!botModel.toLowerCase().startsWith("claude-")) return null;
  return pickForSize(catalog, botModel, "normal");
}

/** Whether this bot is on the list that never gets Sonnet for simple requests (EDITORDEVIDEO by default); matches id or name. */
export function excludedFromSonnet(bot: { id: string; name: string }, list: readonly string[] | undefined): boolean {
  const names = (list ?? ["EDITORDEVIDEO"]).map((entry) => entry.trim().toLowerCase());
  return names.includes(bot.id.toLowerCase()) || names.includes(bot.name.trim().toLowerCase());
}

type SizedBot = { id: string; name: string; modelFixed?: boolean; chiefOfStaff?: boolean };
type SizeSettings = { simpleToSonnetForFixed?: boolean; simpleToSonnetExclude?: string[] };

/** Whether this bot's request is worth sizing at all: ordinary bots always; the Boss and fixed-model bots only when
 * light requests may go to Sonnet for them (switch on, bot not excluded). */
export function sizesTurns(bot: SizedBot, settings: SizeSettings | undefined): boolean {
  if (!bot.modelFixed && !bot.chiefOfStaff) return true;
  return settings?.simpleToSonnetForFixed !== false && !excludedFromSonnet(bot, settings?.simpleToSonnetExclude);
}

/** The model for a sized turn, or null to keep the bot's own: ordinary bots by `modelForSize`, the Boss and
 * fixed-model bots by `sonnetForSimple`. */
export function modelForBotTurn(
  bot: SizedBot, settings: SizeSettings | undefined, catalog: ModelCatalog | undefined, botModel: string, size: TurnSize,
  engine: { pinnedSessionModel?: boolean } = {},
): string | null {
  if (!sizesTurns(bot, settings)) return null;
  return bot.modelFixed || bot.chiefOfStaff ? sonnetForSimple(catalog, botModel, size, engine) : modelForSize(catalog, botModel, size, engine);
}

function pickForSize(catalog: ModelCatalog, botModel: string, size: TurnSize): string | null {
  // A heavy request keeps the bot's own model; a lighter one never goes above it.
  if (size === "heavy") return null;
  const want = SIZES.indexOf(size) as 0 | 1;
  const ceiling = modelRank(botModel);
  if (want >= ceiling) return null;
  const provider = catalog.options.find((option) => option.id === botModel)?.provider;
  // Engines list their newest first.
  const pick = catalog.options.find((option) =>
    !option.custom && option.id !== botModel && modelRank(option.id) === want && (option.provider ?? undefined) === (provider ?? undefined) &&
    sameFamily(option.id, botModel));
  return pick?.id ?? null;
}

/** claude-* stays claude-*, gpt-* stays gpt-*: the vendor prefix before the first dash or slash. */
function sameFamily(a: string, b: string): boolean {
  const head = (id: string) => id.toLowerCase().split(/[-/]/)[0];
  return head(a) === head(b);
}

// ---- 5. Notifications ----

export type NotifyPriority = "urgent" | "normal" | "noise";
export const NOTIFY_INSTRUCTIONS = "How should the person be told about this `event`? urgent: they must see it now (a client waiting, money, something broke, a deadline today, a bot blocked waiting for them). normal: worth knowing, can wait for the daily summary. noise: routine progress, confirmations and chatter they never need.";
const NOTIFY_OPTIONS: Record<NotifyPriority, string> = {
  urgent: "Urgent: send a push notification to the phone now.",
  normal: "Normal: put it in the daily summary.",
  noise: "Noise: do not notify at all.",
};
export const NOTIFY_MIN_PROBABILITY = 0.55;

export async function notifyPriority(
  decider: Asker,
  input: { kind: string; title: string; body?: string; from?: string },
  opts: Opts = {},
): Promise<NotifyPriority | null> {
  try {
    const event = { kind: clip(input.kind, 60), title: clip(input.title, 200), ...(input.body ? { body: clip(input.body, 1_000) } : {}), ...(input.from ? { from: clip(input.from, NAME_MAX) } : {}) };
    const result = await decider.choose("notifications", { event }, { instructions: NOTIFY_INSTRUCTIONS, options: NOTIFY_OPTIONS }, ask(opts));
    if (!result.ok || result.answers.pTop < NOTIFY_MIN_PROBABILITY) return null;
    return result.answers.choice;
  } catch {
    return null;
  }
}

// ---- 6. Critical actions ----

/** Groups the decision model may wave through; spending, deleting for good and sending outside always ask. */
export const CRITICAL_CHECK_GROUPS = new Set(["config", "deploy"]);
export const CRITICAL_INSTRUCTIONS = "A bot wants to run `action`. Is it really critical, so the person must approve it first? Yes when it changes money, accounts, access, security, production systems or public content, or cannot be undone. No when it is routine and safe, for example reading, a local test, a restart of the bot's own dev server or a change inside its own workspace.";
/** Waved through only when the decision model is this sure it is not critical. */
export const CRITICAL_SAFE_MAX_P = 0.15;

export async function actionReallyCritical(
  decider: Asker,
  input: { group: string; tool: string; summary: string; bot?: string },
  opts: Opts = {},
): Promise<boolean> {
  try {
    if (!CRITICAL_CHECK_GROUPS.has(input.group)) return true;
    const action = { group: input.group, tool: clip(input.tool, 120), what: clip(input.summary, 1_500), ...(input.bot ? { bot: clip(input.bot, NAME_MAX) } : {}) };
    const result = await decider.yesNo("criticalCheck", { action }, CRITICAL_INSTRUCTIONS, ask(opts));
    if (!result.ok) return true;
    return result.answers.p > CRITICAL_SAFE_MAX_P;
  } catch {
    return true;
  }
}

// ---- 7. Skills ----

export const NO_SKILL_OPTION = "__none__";
export const SKILL_INSTRUCTIONS = "Which of the bot's skills fits `new_message`? Choose __none__ when no skill clearly covers it.";
export const SKILL_MIN_PROBABILITY = 0.6;

export async function pickSkill(
  decider: Asker,
  input: { text: string; skills: Array<{ name: string; description?: string }> },
  opts: Opts = {},
): Promise<string | null> {
  try {
    const skills = input.skills.filter((skill) => skill.name.trim()).slice(0, 200);
    if (!skills.length || !input.text.trim()) return null;
    const options: Record<string, string> = { [NO_SKILL_OPTION]: "No skill: the bot answers on its own." };
    for (const skill of skills) options[skill.name] = `${clip(skill.name, NAME_MAX)}: ${clip(skill.description, ABOUT_MAX) || "no description"}`;
    const result = await decider.choose("skillPick", { new_message: input.text.trim().slice(0, TEXT_MAX) }, { instructions: SKILL_INSTRUCTIONS, options }, ask(opts));
    if (!result.ok || result.answers.choice === NO_SKILL_OPTION || result.answers.pTop < SKILL_MIN_PROBABILITY) return null;
    return result.answers.choice;
  } catch {
    return null;
  }
}

export function skillNote(name: string): string {
  return `The decision model points to the skill "${clip(name, NAME_MAX)}" for this message: read its SKILL.md from the skills index before you start, unless it clearly does not fit.`;
}

// ---- 8. Email and client portal ----

export type InboxCategory = "important" | "newsletter" | "spam" | "bot";
export const INBOX_INSTRUCTIONS = "What is this incoming `email`? important: a person or client who needs Avery or the team. newsletter: bulk news, marketing or notifications. spam: unwanted or a scam. bot: work one of the listed bots should take.";
export const INBOX_MIN_PROBABILITY = 0.55;

export interface InboxItem {
  from: string;
  to?: string;
  subject: string;
  text: string;
  source?: "email" | "portal";
}

export interface InboxVerdict {
  category: InboxCategory | "unsure";
  /** For `bot`: which bot; absent when no bot is sure enough. */
  botId?: string;
  probability: number;
}

export async function triageInbox(
  decider: Asker,
  input: { item: InboxItem; bots: DispatchMember[] },
  opts: Opts = {},
): Promise<InboxVerdict | null> {
  try {
    const email = {
      source: input.item.source ?? "email",
      from: clip(input.item.from, 200),
      ...(input.item.to ? { to: clip(input.item.to, 200) } : {}),
      subject: clip(input.item.subject, 300),
      text: input.item.text.trim().slice(0, TEXT_MAX),
    };
    const bots = input.bots.map((bot) => ({ name: clip(bot.name, NAME_MAX), role: clip(bot.title, NAME_MAX) }));
    const seam = input.item.source === "portal" ? "portalRouting" as const : "emailTriage" as const;
    const category = await decider.choose(seam, { email, bots }, {
      instructions: INBOX_INSTRUCTIONS,
      options: {
        important: "Important: a real person or client who needs an answer.",
        newsletter: "Newsletter: bulk news, marketing, automatic notifications.",
        spam: "Spam: unwanted, phishing or a scam.",
        bot: "Bot: a task one of the bots should take.",
      } satisfies Record<InboxCategory, string>,
    }, ask(opts));
    if (!category.ok) return null;
    const { choice, pTop } = category.answers;
    if (pTop < INBOX_MIN_PROBABILITY) return { category: "unsure", probability: pTop };
    if (choice !== "bot" || !input.bots.length) return { category: choice, probability: pTop };
    const target = await chooseOwner(decider, seam, {
      members: input.bots,
      text: `${email.subject}\n\n${email.text}`,
      instructions: "Which bot should take this as work? Choose __none__ when no bot clearly fits.",
    }, opts);
    return target ? { category: "bot", botId: target.botId, probability: pTop } : { category: "bot", probability: pTop };
  } catch {
    return null;
  }
}

// ---- 9. The bot's tag ----

export const TAG_INSTRUCTIONS = "Which role tag best describes the job of the bot in `bot`? Choose the tag for its main work.";
export const TAG_MIN_PROBABILITY = 0.15;
export const TAG_EXTRA_MIN_PROBABILITY = 0.08;
export const TAG_SUGGESTIONS_MAX = 3;
export const TAG_SUGGEST_TIMEOUT_MS = 4_000;

/** Up to three catalog tags, likeliest first. Empty when Jev is off, unsure or the bot says nothing about its job. */
export async function suggestBotTags(decider: Pick<Decider, "choose">, input: BotTagSuggestionRequest, opts: Opts = {}): Promise<string[]> {
  try {
    const asked = tagSuggestionRequest(input);
    if (!asked) return [];
    const bot = {
      name: clip(asked.name, NAME_MAX),
      title: clip(asked.title, NAME_MAX),
      description: clip(asked.description, ABOUT_MAX),
    };
    const byKey = new Map<string, string>();
    const options: Record<string, string> = {};
    for (const { area, tags } of BOT_TAG_AREAS) {
      for (const tag of tags) {
        const key = tagSearchKey(tag);
        byKey.set(key, tag);
        options[key] = `${tag} (${area})`;
      }
    }
    const state = Object.fromEntries(Object.entries(bot).filter(([, value]) => value));
    const result = await decider.choose("tagSuggest", { bot: state }, { instructions: TAG_INSTRUCTIONS, options }, {
      ...ask(opts), timeoutMs: opts.timeoutMs ?? TAG_SUGGEST_TIMEOUT_MS,
    });
    if (!result.ok || result.answers.pTop < TAG_MIN_PROBABILITY || !byKey.has(result.answers.choice)) return [];
    const others = Object.entries(result.answers.probabilities)
      .filter(([key, p]) => key !== result.answers.choice && byKey.has(key) && (p ?? 0) >= TAG_EXTRA_MIN_PROBABILITY)
      .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
      .map(([key]) => key);
    return [result.answers.choice, ...others].slice(0, TAG_SUGGESTIONS_MAX).map((key) => byKey.get(key)!);
  } catch {
    return [];
  }
}
