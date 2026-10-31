import { activeLocale, t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";

export type ChatStepId = "company" | "about" | "import" | "agents" | "tools" | "team";
export type ChatPosition = ChatStepId | "done";

export const COMPANY_MAX = 80;
export const ABOUT_MAX = 600;
export const AGENT_NAME_MAX = 40;
export const AGENT_TITLE_MAX = 60;

const CORE_STEPS: readonly ChatStepId[] = ["company", "about", "import", "agents", "tools"];

/** The invite step is offered only where a link to this server can reach a coworker; see `teamBeatDue`. */
export function chatSteps(options: { team: boolean }): ChatStepId[] {
  return options.team ? [...CORE_STEPS, "team"] : [...CORE_STEPS];
}

/** The first run in simple mode: not a hosted workspace, not a deliberate replay, not advanced mode. */
export function chatOnboardingDue(options: { hosted: boolean; replay: boolean; advanced: boolean }): boolean {
  return !options.hosted && !options.replay && !options.advanced;
}

export interface StepRecord {
  outcome: "done" | "skipped";
  value?: string;
  count?: number;
  names?: string[];
}

export type ChatProgress = Partial<Record<ChatStepId, StepRecord>>;

export const CHAT_PROGRESS_KEY = "nordus.onboarding.chat.v1";

export interface ChatStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStorage(): ChatStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

const STEP_IDS: readonly ChatStepId[] = [...CORE_STEPS, "team"];
const MAX_NAMES = 8;
const MAX_TEXT = 700;

function cleanRecord(value: unknown): StepRecord | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (record.outcome !== "done" && record.outcome !== "skipped") return null;
  const clean: StepRecord = { outcome: record.outcome };
  if (typeof record.value === "string" && record.value) clean.value = record.value.slice(0, MAX_TEXT);
  if (typeof record.count === "number" && Number.isFinite(record.count) && record.count >= 0) clean.count = Math.min(Math.floor(record.count), 99);
  if (Array.isArray(record.names)) {
    const names = record.names.filter((name): name is string => typeof name === "string" && name !== "").map((name) => name.slice(0, 100));
    if (names.length) clean.names = names.slice(0, MAX_NAMES);
  }
  return clean;
}

export function parseChatProgress(raw: unknown): ChatProgress {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const source = raw as Record<string, unknown>;
  const progress: ChatProgress = {};
  for (const id of STEP_IDS) {
    const record = cleanRecord(source[id]);
    if (record) progress[id] = record;
  }
  return progress;
}

export function readChatProgress(storage: ChatStorage | null = defaultStorage()): ChatProgress {
  try {
    const stored = storage?.getItem(CHAT_PROGRESS_KEY);
    return stored ? parseChatProgress(JSON.parse(stored)) : {};
  } catch {
    return {};
  }
}

export function writeChatProgress(progress: ChatProgress, storage: ChatStorage | null = defaultStorage()): void {
  try {
    storage?.setItem(CHAT_PROGRESS_KEY, JSON.stringify(parseChatProgress(progress)));
  } catch {
  }
}

export function clearChatProgress(storage: ChatStorage | null = defaultStorage()): void {
  try {
    storage?.removeItem(CHAT_PROGRESS_KEY);
  } catch {
  }
}

export function recordStep(progress: ChatProgress, id: ChatStepId, record: StepRecord): ChatProgress {
  const clean = cleanRecord(record);
  return clean ? { ...progress, [id]: clean } : progress;
}

export function currentStep(progress: ChatProgress, steps: readonly ChatStepId[]): ChatPosition {
  return steps.find((id) => !progress[id]) ?? "done";
}

export function stepsLeft(progress: ChatProgress, steps: readonly ChatStepId[]): number {
  return steps.filter((id) => !progress[id]).length;
}

export function progressShare(progress: ChatProgress, steps: readonly ChatStepId[]): number {
  return steps.length ? (steps.length - stepsLeft(progress, steps)) / steps.length : 1;
}

export function stepLabel(id: ChatStepId): string {
  return t(`onboarding.chat.step.${id}` as LocaleKey);
}

export interface RailRow {
  id: ChatStepId;
  label: string;
  status: "done" | "skipped" | "current" | "upcoming";
  answer: string | null;
}

function listed(names: readonly string[]): string {
  const shown = names.slice(0, 2);
  if (names.length > shown.length) return t("onboarding.chat.answer.more", { names: shown.join(", "), count: names.length - shown.length });
  return new Intl.ListFormat(activeLocale(), { style: "long", type: "conjunction" }).format(shown);
}

function railAnswer(id: ChatStepId, record: StepRecord): string {
  if (record.outcome === "skipped") return t("onboarding.chat.answer.skipped");
  switch (id) {
    case "company":
      return record.value ?? t("onboarding.chat.answer.done");
    case "about":
      return t("onboarding.chat.answer.written");
    case "import":
      return t("onboarding.chat.answer.brought");
    case "agents":
      return record.count === 1
        ? t("onboarding.chat.answer.agentsOne")
        : t("onboarding.chat.answer.agents", { count: record.count ?? 0 });
    case "tools":
      return record.names?.length ? listed(record.names) : t("onboarding.chat.answer.later");
    case "team":
      return t("onboarding.chat.answer.done");
  }
}

export function railRows(progress: ChatProgress, steps: readonly ChatStepId[], position: ChatPosition): RailRow[] {
  return steps.map((id) => {
    const record = progress[id];
    if (record) return { id, label: stepLabel(id), status: record.outcome, answer: railAnswer(id, record) };
    const current = id === position;
    return {
      id,
      label: stepLabel(id),
      status: current ? "current" : "upcoming",
      answer: id === "team" ? t("onboarding.chat.answer.optional") : null,
    };
  });
}

export function oneLine(value: string, max: number): string {
  let text = "";
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    text += code < 32 || (code >= 127 && code < 160) ? " " : character;
  }
  return text.replace(/\s+/g, " ").trim().slice(0, max).trim();
}

const FREE_MAIL = new Set([
  "gmail", "googlemail", "outlook", "hotmail", "live", "msn", "yahoo", "icloud", "me", "mac", "proton", "protonmail", "pm",
  "aol", "gmx", "zoho", "uol", "bol", "terra", "ig", "globo", "r7", "yandex", "mail", "email",
]);
const DOMAIN_SUFFIXES = new Set([
  "com", "net", "org", "edu", "gov", "co", "io", "ai", "app", "dev", "me", "br", "pt", "us", "uk", "ar", "mx", "es", "fr", "de", "it",
  "info", "biz", "xyz", "online", "site", "tech", "studio", "agency",
]);

function titleCase(words: string): string {
  return words.split(" ").filter(Boolean).map((word) => word[0]!.toUpperCase() + word.slice(1)).join(" ");
}

/** A company-looking name from a work address; null for a personal mailbox or anything that does not read as a name. */
export function companyFromEmail(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 1) return null;
  const labels = email.slice(at + 1).trim().toLowerCase().split(".").filter(Boolean);
  while (labels.length > 1 && DOMAIN_SUFFIXES.has(labels[labels.length - 1]!)) labels.pop();
  const label = labels[labels.length - 1];
  if (!label || FREE_MAIL.has(label) || !/^[a-z0-9][a-z0-9-]*$/.test(label) || label.length < 3) return null;
  return titleCase(label.replace(/-+/g, " ").trim());
}

/** The first one is the answer the step starts on. */
export function companySuggestions(input: { company?: string; name?: string; email?: string }): string[] {
  const found: string[] = [];
  const add = (value: string | null | undefined) => {
    const text = oneLine(value ?? "", COMPANY_MAX);
    if (text && !found.includes(text)) found.push(text);
  };
  add(input.company);
  add(companyFromEmail(input.email ?? ""));
  const first = oneLine(input.name ?? "", COMPANY_MAX).split(" ")[0];
  add(first ? t("onboarding.chat.company.personal", { name: first }) : t("onboarding.chat.company.generic"));
  return found.slice(0, 3);
}

export type BusinessKind = "marketing" | "store" | "software" | "services";

const KIND_WORDS: ReadonlyArray<readonly [BusinessKind, RegExp]> = [
  ["marketing", /marketing|midia|social|conteudo|content|campanh|design|criativ|agencia|agency|studio|estudio|video|foto|blog|influenc|publicidade|brand|marca/],
  ["store", /loja|store|shop|e-?commerce|produto|vend|pedido|estoque|boutique|moda|cardapio|restaurante|delivery|market/],
  ["software", /software|aplicativo|\bapp\b|sistema|plataforma|saas|desenvolv|codigo|\bcode\b|tecnologia|\btech\b|startup|\bdev\b/],
  ["services", /servico|service|consult|clinica|clinic|escritorio|advoc|contab|agenda|atendimento|cliente|client/],
];

function plain(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function businessKind(text: string): BusinessKind | null {
  const haystack = plain(text);
  return KIND_WORDS.find(([, words]) => words.test(haystack))?.[0] ?? null;
}

const BUSINESS_KINDS: readonly BusinessKind[] = ["services", "marketing", "store", "software"];

export interface AboutSuggestion {
  kind: BusinessKind;
  text: string;
}

/** What the business might say it does, the likeliest first, judged from the company name. */
export function aboutSuggestions(company: string): AboutSuggestion[] {
  const likely = businessKind(company) ?? "services";
  const order = [likely, ...BUSINESS_KINDS.filter((kind) => kind !== likely)];
  return order.map((kind) => ({ kind, text: t(`onboarding.chat.about.suggest.${kind}` as LocaleKey) }));
}

export type AgentKind = "coordinator" | "support" | "content" | "research" | "ops" | "data" | "dev";

export const AGENT_ROLE_IDS: Record<AgentKind, string> = {
  coordinator: "assistant",
  support: "inbox",
  content: "writer",
  research: "research",
  ops: "ops",
  data: "analyst",
  dev: "coder",
};

export interface AgentProposal {
  id: AgentKind;
  name: string;
  title: string;
  description: string;
  checked: boolean;
}

const TEAM_BY_KIND: Record<BusinessKind | "generic", readonly AgentKind[]> = {
  marketing: ["coordinator", "content", "research", "support"],
  store: ["coordinator", "support", "content", "data"],
  software: ["coordinator", "dev", "research", "support"],
  services: ["coordinator", "support", "ops", "research"],
  generic: ["coordinator", "support", "research"],
};

export function proposal(id: AgentKind, checked = true): AgentProposal {
  return {
    id,
    name: t(`onboarding.chat.agent.${id}.name` as LocaleKey),
    title: t(`onboarding.chat.agent.${id}.title` as LocaleKey),
    description: t(`onboarding.chat.agent.${id}.description` as LocaleKey),
    checked,
  };
}

/** Three agents when nothing says what the business does, four when something does; all start checked. */
export function proposeTeam(input: { company: string; about: string }): AgentProposal[] {
  const kind = businessKind(`${input.company} ${input.about}`) ?? "generic";
  return TEAM_BY_KIND[kind].map((id) => proposal(id));
}

export function chosenAgents(proposals: readonly AgentProposal[]): AgentProposal[] {
  return proposals
    .map((entry) => ({ ...entry, name: oneLine(entry.name, AGENT_NAME_MAX), title: oneLine(entry.title, AGENT_TITLE_MAX) }))
    .filter((entry) => entry.checked && entry.name && entry.title);
}

const COMPANY_HEADINGS = ["About the company", "Sobre a empresa"];

function companyHeadings(): string[] {
  return [...new Set([...COMPANY_HEADINGS, t("onboarding.chat.block.heading")])];
}

/** The part of the team's shared instructions this welcome writes; the rest of the text is never touched. */
export function companyBlock(input: { company: string; about: string }): string {
  const lines = [`## ${t("onboarding.chat.block.heading")}`];
  if (input.company) lines.push(t("onboarding.chat.block.company", { company: input.company }));
  lines.push(t("onboarding.chat.block.about", { about: input.about }));
  return lines.join("\n");
}

export function mergeCompanyBlock(existing: string, block: string): string {
  const lines = existing.split("\n");
  const headings = companyHeadings().map((heading) => `## ${heading}`);
  const start = lines.findIndex((line) => headings.includes(line.trim()));
  if (start < 0) return `${existing.trimEnd()}${existing.trim() ? "\n\n" : ""}${block}\n`;
  let end = lines.findIndex((line, index) => index > start && line.startsWith("## "));
  if (end < 0) end = lines.length;
  const before = lines.slice(0, start).join("\n").trimEnd();
  const after = lines.slice(end).join("\n").trim();
  return `${before}${before ? "\n\n" : ""}${block}\n${after ? `\n${after}\n` : ""}`;
}

export const TOOL_ORDER: readonly string[] = [
  "gmail", "googlecalendar", "slack", "googledrive", "notion", "googlesheets", "hubspot", "trello", "asana", "github", "figma", "discord",
];

const TOOLS_BY_KIND: Record<BusinessKind | "generic", readonly string[]> = {
  marketing: ["gmail", "googledrive", "slack", "figma", "googlecalendar", "notion"],
  store: ["gmail", "googlesheets", "slack", "googlecalendar", "hubspot", "googledrive"],
  software: ["github", "slack", "gmail", "notion", "googlecalendar", "googledrive"],
  services: ["gmail", "googlecalendar", "googledrive", "hubspot", "slack", "notion"],
  generic: ["gmail", "googlecalendar", "slack", "googledrive", "notion", "googlesheets"],
};

export const TOOLS_SHOWN = 6;

/** The catalog apps worth offering first for this business, in order; an app the catalog lacks is left out. */
export function suggestedTools<Card extends { slug: string }>(cards: readonly Card[], text: string): Card[] {
  const kind = businessKind(text) ?? "generic";
  const bySlug = new Map(cards.map((card) => [card.slug, card]));
  const ranked = [...TOOLS_BY_KIND[kind], ...TOOL_ORDER].filter((slug, index, all) => all.indexOf(slug) === index);
  const found: Card[] = [];
  for (const slug of ranked) {
    const card = bySlug.get(slug);
    if (card) found.push(card);
    if (found.length === TOOLS_SHOWN) break;
  }
  return found;
}
