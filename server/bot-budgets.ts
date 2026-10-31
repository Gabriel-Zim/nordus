// Monthly spend limit per bot, kept in <data>/usage/bot-budgets.json beside the workspace ledger.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { writeFileAtomic } from "./atomic.ts";
import { isJsonObject, readJsonState } from "./state-file.ts";
import { readUsage } from "./usage-ledger.ts";

export const BOT_BUDGET_WARN_AT = 80;
const CACHE_MS = 15_000;

export interface BotMonth {
  spentUsd: number;
  runs: number;
  input: number;
  output: number;
}

export interface BotBudgetState extends BotMonth {
  botId: string;
  month: string;
  monthlyUsd: number | null;
  warnAtPercent: number;
  percent: number | null;
  warn: boolean;
  exceeded: boolean;
}

const cache = new Map<string, { at: number; month: string; bots: Map<string, BotMonth> }>();

function monthOf(now: Date): string {
  return now.toISOString().slice(0, 7);
}

function file(dataDir: string, name: string): string {
  return join(dataDir, "usage", name);
}

function readJson(path: string): Record<string, unknown> {
  const saved = readJsonState(path, isJsonObject);
  return saved.status === "ok" ? saved.value : {};
}

function writeJson(dataDir: string, name: string, value: unknown): void {
  mkdirSync(join(dataDir, "usage"), { recursive: true, mode: 0o700 });
  writeFileAtomic(file(dataDir, name), JSON.stringify(value, null, 2), { mode: 0o600 });
}

function budgetsIn(saved: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [botId, value] of Object.entries(saved)) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) out[botId] = value;
  }
  return out;
}

const BUDGETS_UNREADABLE = "Os limites de gasto dos robôs não puderam ser lidos, então nada foi alterado. Veja o log do servidor.";

/** An unreadable file reads as no limits here; turns are refused by assertBotWithinBudget until it is fixed. */
export function readBotBudgets(dataDir: string): Record<string, number> {
  return budgetsIn(readJson(file(dataDir, "bot-budgets.json")));
}

export function setBotBudget(dataDir: string, botId: string, monthlyUsd: number | null): void {
  const saved = readJsonState(file(dataDir, "bot-budgets.json"), isJsonObject);
  // Saving over it would keep only this bot's limit and drop every other one.
  if (saved.status === "unreadable") throw Object.assign(new Error(BUDGETS_UNREADABLE), { status: 409 });
  const budgets = saved.status === "ok" ? budgetsIn(saved.value) : {};
  if (monthlyUsd === null) delete budgets[botId];
  else budgets[botId] = monthlyUsd;
  writeJson(dataDir, "bot-budgets.json", budgets);
}

/** Month-to-date spend, runs and tokens for every bot, read from the ledger at most every 15 s. */
export function monthByBot(dataDir: string, now = new Date()): Map<string, BotMonth> {
  const month = monthOf(now);
  const hit = cache.get(dataDir);
  if (hit && hit.month === month && now.getTime() - hit.at < CACHE_MS) return hit.bots;
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const bots = new Map<string, BotMonth>();
  for (const row of readUsage(dataDir, { from, to: now })) {
    const entry = bots.get(row.botId) ?? { spentUsd: 0, runs: 0, input: 0, output: 0 };
    entry.spentUsd += typeof row.costUsd === "number" && row.costUsd > 0 ? row.costUsd : 0;
    entry.runs += 1;
    entry.input += row.input + (row.cachedInput ?? 0);
    entry.output += row.output;
    bots.set(row.botId, entry);
  }
  cache.set(dataDir, { at: now.getTime(), month, bots });
  return bots;
}

/** Count a turn at once, before its ledger row is read back, so the next check sees it. */
export function noteBotSpend(dataDir: string, row: { botId: string; costUsd: number | null; input: number; output: number; cachedInput?: number }, now = new Date()): void {
  const hit = cache.get(dataDir);
  if (!hit || hit.month !== monthOf(now)) return;
  const entry = hit.bots.get(row.botId) ?? { spentUsd: 0, runs: 0, input: 0, output: 0 };
  entry.spentUsd += typeof row.costUsd === "number" && row.costUsd > 0 ? row.costUsd : 0;
  entry.runs += 1;
  entry.input += row.input + (row.cachedInput ?? 0);
  entry.output += row.output;
  hit.bots.set(row.botId, entry);
}

export function botBudgetState(dataDir: string, botId: string, now = new Date()): BotBudgetState {
  const used = monthByBot(dataDir, now).get(botId) ?? { spentUsd: 0, runs: 0, input: 0, output: 0 };
  const monthlyUsd = readBotBudgets(dataDir)[botId] ?? null;
  const percent = monthlyUsd ? Math.min(999, Math.round((used.spentUsd / monthlyUsd) * 100)) : null;
  return {
    botId,
    month: monthOf(now),
    ...used,
    monthlyUsd,
    warnAtPercent: BOT_BUDGET_WARN_AT,
    percent,
    warn: percent !== null && percent >= BOT_BUDGET_WARN_AT,
    exceeded: monthlyUsd !== null && used.spentUsd >= monthlyUsd,
  };
}

export function monthTotal(dataDir: string, now = new Date()): { month: string; spentUsd: number } {
  let spentUsd = 0;
  for (const entry of monthByBot(dataDir, now).values()) spentUsd += entry.spentUsd;
  return { month: monthOf(now), spentUsd };
}

export function assertBotWithinBudget(dataDir: string, botId: string, now = new Date()): void {
  // Which bots had a limit is unknown while the file is unreadable, so no bot may spend.
  if (readJsonState(file(dataDir, "bot-budgets.json"), isJsonObject).status === "unreadable") {
    throw Object.assign(
      new Error("Os limites de gasto dos robôs não puderam ser lidos, então nenhum turno roda até o arquivo usage/bot-budgets.json ser consertado. Veja o log do servidor."),
      { status: 409, code: "bot_spend_cap" },
    );
  }
  const state = botBudgetState(dataDir, botId, now);
  if (!state.exceeded || state.monthlyUsd === null) return;
  throw Object.assign(
    new Error(`this bot reached its monthly limit of $${state.monthlyUsd.toFixed(2)} — raise it in the bot's profile`),
    { status: 409, code: "bot_spend_cap" },
  );
}

/** "warn" once at 80% and "cap" once at the limit, per bot and month. */
export function takeBotBudgetAlert(dataDir: string, state: BotBudgetState): "warn" | "cap" | null {
  if (state.monthlyUsd === null || (!state.warn && !state.exceeded)) return null;
  const marks = readJson(file(dataDir, "bot-budget-alerts.json")) as Record<string, { month?: string; monthlyUsd?: number; warn?: boolean; cap?: boolean }>;
  const saved = marks[state.botId];
  const current = saved && saved.month === state.month && saved.monthlyUsd === state.monthlyUsd ? saved : { month: state.month, monthlyUsd: state.monthlyUsd };
  const alert = state.exceeded && !current.cap ? "cap" : state.warn && !current.warn && !state.exceeded ? "warn" : null;
  if (!alert) return null;
  marks[state.botId] = { ...current, warn: true, ...(alert === "cap" ? { cap: true } : {}) };
  writeJson(dataDir, "bot-budget-alerts.json", marks);
  return alert;
}

export function resetBotBudgetCacheForTests(): void {
  cache.clear();
}
