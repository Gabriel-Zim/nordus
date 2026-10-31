// Pure helpers for the "Contas e modelos" screen: which account cards to draw, how full they are, the Brasilia clock,
// the robot list's filters and the destination each selected robot would get. No React and no network here.
import { acceptedEfforts, accountFamily, destinationFor, type MoveSelection } from "../../shared/account-moves";
import type { PlanProvider } from "@/components/PlanUsage";
import type { Bot, InstanceInfo } from "@/state/store";
import { accountPersonName } from "@/lib/account-person";

export const BRASILIA_ZONE = "America/Sao_Paulo";
/** A window this full (or more) shows "Quase no fim". */
export const NEAR_END_PERCENT = 85;
export const EXHAUSTED_PERCENT = 100;

export type AccountAlert = "exhausted" | "nearEnd" | null;

export function alertFor(used: number | null | undefined): AccountAlert {
  if (used == null || !Number.isFinite(used)) return null;
  if (used >= EXHAUSTED_PERCENT) return "exhausted";
  return used >= NEAR_END_PERCENT ? "nearEnd" : null;
}

/** The account card a model instance belongs to: Codex and the ChatGPT plan are one account. */
export function accountKeyOf(instanceId: string): string {
  return accountFamily(instanceId) === "codex" ? "codex" : instanceId;
}

const ACCOUNT_DRIVERS: readonly string[] = ["claudeAgent", "codex", "grokAgent", "cursorAgent", "opencodeGo", "antigravityAgent", "kimiAgent"];

export function isAccountInstance(instance: Pick<InstanceInfo, "instanceId" | "driverKind">): boolean {
  return instance.instanceId !== "claudeApi" && ACCOUNT_DRIVERS.includes(instance.driverKind);
}

function rank(key: string): number {
  if (key === "grok") return 0;
  if (key === "claude") return 1;
  if (key.startsWith("claude")) return 2;
  return ["codex", "opencodeGo", "antigravity", "cursor", "kimi"].indexOf(key) + 3 || 9;
}

export interface AccountWindowView {
  used: number | null;
  resetsAt: string | null;
}

export interface AccountCardData {
  key: string;
  label: string;
  instanceIds: string[];
  plan: string | null;
  /** "none": no plan-usage row; "error": the row could not be read. */
  reading: "ok" | "none" | "error";
  error: string | null;
  weekly: AccountWindowView;
  fiveHour: AccountWindowView;
  botCount: number;
  alert: AccountAlert;
}

function accountLabel(key: string, instances: InstanceInfo[]): string {
  if (key === "claude") return instances[0] ? accountPersonName(instances[0]) : key;
  if (key === "codex") return "Codex / ChatGPT";
  if (key === "opencodeGo") return "OpenCode Go";
  if (key === "antigravity") return "Antigravity / Gemini";
  return instances[0] ? accountPersonName(instances[0]) : key;
}

const windowView = (window: PlanProvider["weekly"] | undefined): AccountWindowView => ({
  used: window?.available && window.usedPercent != null ? window.usedPercent : null,
  resetsAt: window?.available ? window.resetsAt : null,
});

/** One card per configured account: a signed-in instance, a plan-usage row, or any instance a robot already uses. */
export function buildAccountCards(
  instances: readonly InstanceInfo[],
  providers: readonly PlanProvider[],
  bots: ReadonlyArray<Pick<Bot, "modelSelection">>,
): AccountCardData[] {
  const usedBy = new Map<string, number>();
  for (const bot of bots) usedBy.set(bot.modelSelection.instanceId, (usedBy.get(bot.modelSelection.instanceId) ?? 0) + 1);
  const groups = new Map<string, InstanceInfo[]>();
  for (const instance of instances) {
    if (!isAccountInstance(instance)) continue;
    const configured = instance.snapshot.state === "available" || usedBy.has(instance.instanceId) ||
      providers.some((row) => row.id === instance.instanceId);
    if (!configured) continue;
    const key = accountKeyOf(instance.instanceId);
    groups.set(key, [...(groups.get(key) ?? []), instance]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([key, members]) => {
      const ids = members.map((member) => member.instanceId);
      const rows = providers.filter((row) => ids.includes(row.id));
      const row = rows.find((candidate) => candidate.ok) ?? rows[0];
      const weekly = row?.ok ? windowView(row.weekly) : { used: null, resetsAt: null };
      const fiveHour = row?.ok ? windowView(row.fiveHour) : { used: null, resetsAt: null };
      const worst = Math.max(weekly.used ?? -1, fiveHour.used ?? -1);
      return {
        key,
        label: accountLabel(key, members),
        instanceIds: ids,
        plan: row?.plan ?? null,
        reading: !row ? "none" : row.ok ? "ok" : "error",
        error: row && !row.ok ? row.error : null,
        weekly,
        fiveHour,
        botCount: ids.reduce((sum, id) => sum + (usedBy.get(id) ?? 0), 0),
        alert: alertFor(worst < 0 ? null : worst),
      };
    });
}

const brasilia = new Intl.DateTimeFormat("pt-BR", {
  timeZone: BRASILIA_ZONE, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
});

/** "22/10 21:59" on the Brasilia clock. */
export function brasiliaStamp(at: number): string {
  const parts = Object.fromEntries(brasilia.formatToParts(new Date(at)).map((part) => [part.type, part.value]));
  const hour = parts.hour === "24" ? "00" : parts.hour;
  return `${parts.day}/${parts.month} ${hour}:${parts.minute}`;
}

export function distanceLabel(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  if (minutes < 1) return "menos de 1 min";
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return `${hours}h`;
  return `${minutes} min`;
}

/** "22/10 21:59 (em 7h)", or null when there is no future reset to show. */
export function resetLabel(resetsAt: string | null, now: number): string | null {
  if (!resetsAt) return null;
  const at = Date.parse(resetsAt);
  if (!Number.isFinite(at)) return null;
  return at > now ? `${brasiliaStamp(at)} (em ${distanceLabel(at - now)})` : brasiliaStamp(at);
}

export type RobotView = Pick<Bot, "id" | "name" | "section" | "busy" | "modelSelection"> & { hidden?: boolean };

export function filterRobots<T extends RobotView>(bots: readonly T[], account: string | null, query: string): T[] {
  const needle = query.trim().toLowerCase();
  return bots.filter((bot) =>
    (!account || accountKeyOf(bot.modelSelection.instanceId) === account) &&
    (!needle || bot.name.toLowerCase().includes(needle)));
}

/** Robots grouped by section in the sidebar's order; robots without a section come last. */
export function groupBySection<T extends RobotView>(bots: readonly T[], sections: readonly string[]): Array<{ section: string | null; bots: T[] }> {
  const bySection = new Map<string | null, T[]>();
  for (const bot of bots) {
    const key = bot.section?.trim() || null;
    bySection.set(key, [...(bySection.get(key) ?? []), bot]);
  }
  const ordered = [...sections.filter((name) => bySection.has(name)), ...[...bySection.keys()].filter((name): name is string => name !== null && !sections.includes(name))];
  const groups = ordered.map((section) => ({ section: section as string | null, bots: bySection.get(section)! }));
  if (bySection.has(null)) groups.push({ section: null, bots: bySection.get(null)! });
  return groups;
}

/** Selecting everything in the filter adds to the current choice; with all already chosen it takes them off. */
export function toggleAll(selected: ReadonlySet<string>, visibleIds: readonly string[]): Set<string> {
  const next = new Set(selected);
  const all = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  for (const id of visibleIds) {
    if (all) next.delete(id);
    else next.add(id);
  }
  return next;
}

function offeredModels(instance: Pick<InstanceInfo, "models">): string[] {
  return [instance.models.default, ...instance.models.options.map((option) => option.id)].filter(Boolean);
}

/** Efforts the destination takes: the family's rule, narrowed to what the engine itself declares. */
export function effortChoices(instance: Pick<InstanceInfo, "instanceId" | "capabilities">): string[] {
  const rule = acceptedEfforts(instance.instanceId);
  const declared = instance.capabilities?.effortLevels as readonly string[] | undefined;
  return declared ? rule.filter((level) => declared.includes(level)) : [...rule];
}

export interface PlannedMove {
  botId: string;
  botName: string;
  from: MoveSelection;
  to: MoveSelection;
  /** The suggested model is not in the destination's catalog, so its own default was used. */
  fellBack: boolean;
}

/**
 * What each robot would get on `toInstance`. `model` and `effort` of the override replace the rule for everyone;
 * an empty model means "use the rule", and effort "none" means no effort.
 */
export function planMoves(
  bots: readonly RobotView[],
  toInstance: InstanceInfo,
  override: { model: string; effort: string },
): PlannedMove[] {
  const offered = offeredModels(toInstance);
  const choices = effortChoices(toInstance);
  return bots.map((bot) => {
    const from = bot.modelSelection as MoveSelection;
    const ruled = destinationFor(from, toInstance.instanceId, toInstance.models.default || undefined);
    const wanted = override.model || ruled.model;
    const fellBack = !override.model && !offered.includes(wanted);
    const model = fellBack ? toInstance.models.default || offered[0] || wanted : wanted;
    let effort: string | undefined;
    if (override.effort === "none") effort = undefined;
    else if (override.effort) effort = override.effort;
    else effort = ruled.effort && (choices.length === 0 || choices.includes(ruled.effort)) ? ruled.effort : choices.includes("high") && ruled.effort ? "high" : undefined;
    return {
      botId: bot.id,
      botName: bot.name,
      from: { instanceId: from.instanceId, model: from.model, ...(from.effort ? { effort: from.effort } : {}) },
      to: { instanceId: toInstance.instanceId, model, ...(effort ? { effort } : {}) },
      fellBack,
    };
  });
}

/** What a person calls an instance on this screen. */
export function instanceLabel(instances: ReadonlyArray<Pick<InstanceInfo, "instanceId" | "displayName">>, instanceId: string): string {
  const found = instances.find((instance) => instance.instanceId === instanceId);
  return found ? accountPersonName(found) : instanceId;
}

/** The destination menu's wording: Antigravity is where Gemini runs with tools, so the account says so. */
export function destinationLabel(instanceId: string, label: string): string {
  return /^antigravity/i.test(instanceId) || /^antigravity$/i.test(label) ? "Antigravity / Gemini" : label;
}

/** Lowercase, no accents, every run of other characters becomes one space: "Opus 5.5" and "opus-5-5" read the same. */
export function normalizeSearch(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export interface PickerModel {
  id: string;
  /** The catalog's friendly name, when it differs from the id. */
  name?: string;
}

/** The typed phrase as written, with . - _ / and space alike ("opus 5.5" finds opus-5-5 and not opus-5-4); when no model has it whole, every space-separated word must appear whole. */
export function filterModels<T extends PickerModel>(models: readonly T[], query: string): T[] {
  const phrase = normalizeSearch(query);
  if (!phrase) return [...models];
  const hay = (model: T) => normalizeSearch(`${model.id} ${model.name ?? ""}`);
  const whole = models.filter((model) => hay(model).includes(phrase));
  if (whole.length > 0) return whole;
  // Split on spaces only: "claude 5.5" needs "claude" and the whole "5.5" (read as "5 5"), never a lone "5".
  const words = query.trim().split(/\s+/).map(normalizeSearch).filter(Boolean);
  return models.filter((model) => words.every((word) => hay(model).includes(word)));
}

/** "opencode/" when every id starts with the same provider prefix, so it is shown once in the group header. */
export function commonModelPrefix(ids: readonly string[]): string {
  if (ids.length < 2) return "";
  const first = ids[0]!;
  const cut = first.indexOf("/");
  if (cut < 0) return "";
  const prefix = first.slice(0, cut + 1);
  return ids.every((id) => id.startsWith(prefix) && id.length > prefix.length) ? prefix : "";
}
