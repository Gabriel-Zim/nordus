import { ApiError, api, type Bot, type ModelSelection } from "@/state/store";
import { botRole, type BotRole } from "./bot-roles";
import { t } from "./i18n";

/**
 * The first-run team: a chief who splits the work, a researcher who gathers
 * sources, and an operator who keeps tasks moving. Names come from the locale
 * catalog so they read naturally, but the keys are fixed: passing the
 * workspace bots back in resolves the same three from this client's id
 * registry, never by name, instead of duplicating them.
 */
export type StarterTeamKey = "chief" | "research" | "execution";

export interface StarterTeamMember {
  /** Names the member's slot in this workspace's registry; a retry fills the same slot instead of duplicating the bot. */
  key: string;
  roleId: string;
  name: string;
  title: string;
  description: string;
  soul: string;
}

export interface StarterTeamOptions {
  /** Bots already in the workspace: a member this client registered is reused, never duplicated. */
  existing?: readonly Bot[];
  /** Sent with requireAvailableModel, so the server refuses rather than creating a bot that cannot answer. */
  modelSelection?: ModelSelection;
  /** A team of the person's own making instead of the default three; the chief is the member keyed "chief", else the first. */
  members?: readonly StarterTeamMember[];
}

export interface StarterTeamResult {
  /** One bot per member, in the order the members were given (by default chief, researcher, operator). */
  bots: Bot[];
  chief: Bot;
}

/** A friendly, typed refusal: the app shows a "connect a model" sentence instead of the raw server text. */
export class StarterTeamUnavailableError extends Error {
  constructor(message = "No AI engine is available for the starter team") {
    super(message);
    this.name = "StarterTeamUnavailableError";
  }
}

/**
 * A failed build that kept every bot the server confirmed it created. The
 * message is already fit to show; the technical cause stays on `cause`.
 */
export class StarterTeamBuildError extends Error {
  readonly confirmedBots: readonly Bot[];
  readonly uncertain: boolean;

  constructor(failure: { confirmedBots: readonly Bot[]; uncertain: boolean }, cause?: unknown) {
    super(starterTeamFailureMessage(failure), cause === undefined ? undefined : { cause });
    this.name = "StarterTeamBuildError";
    this.confirmedBots = failure.confirmedBots;
    this.uncertain = failure.uncertain;
  }
}

function starterTeamFailureMessage(failure: { confirmedBots: readonly Bot[]; uncertain: boolean }): string {
  const names = failure.confirmedBots.map((bot) => bot.name).join(", ");
  const base = names
    ? t("onboarding.team.failedReady", { names })
    : t("onboarding.team.failedNone");
  return failure.uncertain ? `${base} ${t("onboarding.team.failedUncertain")}` : base;
}

function role(id: string): BotRole {
  const found = botRole(id);
  if (!found) throw new Error(`Unknown built-in role: ${id}`);
  return found;
}

const CHIEF_COORDINATION =
  "You lead this small team. Break the request into parts, hand research to the researcher and execution to the operator, then report back as one clear answer. Never invent a teammate's result.";

export function starterTeamMembers(): StarterTeamMember[] {
  const assistant = role("assistant");
  const research = role("research");
  // "ops" over "coder": a first-run team should already help before the person
  // has a project folder or a GitHub connection, while Ops works from chat one.
  const execution = role("ops");
  return [
    {
      key: "chief",
      roleId: assistant.id,
      name: t("onboarding.team.chief.name"),
      title: t("onboarding.team.chief.title"),
      description: t("onboarding.team.chief.description"),
      soul: `${assistant.soul} ${CHIEF_COORDINATION}`,
    },
    {
      key: "research",
      roleId: research.id,
      name: t("onboarding.team.research.name"),
      title: t("onboarding.team.research.title"),
      description: t("onboarding.team.research.description"),
      soul: research.soul,
    },
    {
      key: "execution",
      roleId: execution.id,
      name: t("onboarding.team.execution.name"),
      title: t("onboarding.team.execution.title"),
      description: t("onboarding.team.execution.description"),
      soul: execution.soul,
    },
  ];
}

const NO_MODEL = /requireAvailableModel|no (?:available )?(?:model|engine)|(?:model|engine)[^.]*unavailable|not offered by instance/i;

function unavailable(cause: unknown): boolean {
  const message = cause instanceof Error ? cause.message : String(cause);
  return NO_MODEL.test(message);
}

/** Only a 4xx means the server refused before writing; everything else leaves the POST's outcome open. */
function clearRefusal(cause: unknown): boolean {
  if (cause instanceof StarterTeamUnavailableError || unavailable(cause)) return true;
  return cause instanceof ApiError && cause.status >= 400 && cause.status < 500;
}

/**
 * The bot tag is rendered as a label in the sidebar and in room info, so the
 * starter team marker lives only here: role to bot id, per workspace.
 */
export const STARTER_TEAM_IDS_KEY = "nordus.starterTeam.v1";

export function starterTeamRegistryKey(scope: string): string {
  return `${STARTER_TEAM_IDS_KEY}:${scope}`;
}

type StarterTeamRegistry = Record<string, string>;

const REGISTRY_KEY_PATTERN = /^[a-z0-9][a-z0-9-]{0,47}$/;
const REGISTRY_MAX_ENTRIES = 24;

function cleanRegistry(record: Record<string, unknown>): StarterTeamRegistry {
  const registry: StarterTeamRegistry = {};
  const ids = new Set<string>();
  for (const [key, id] of Object.entries(record)) {
    if (!REGISTRY_KEY_PATTERN.test(key) || typeof id !== "string" || !id || ids.has(id)) continue;
    if (ids.size >= REGISTRY_MAX_ENTRIES) break;
    registry[key] = id;
    ids.add(id);
  }
  return registry;
}

function readStarterTeamRegistry(scope: string): StarterTeamRegistry {
  try {
    const stored = globalThis.localStorage?.getItem(starterTeamRegistryKey(scope));
    if (!stored) return {};
    const parsed: unknown = JSON.parse(stored);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return cleanRegistry(parsed as Record<string, unknown>);
  } catch {
    return {};
  }
}

function writeStarterTeamRegistry(scope: string, registry: StarterTeamRegistry): void {
  try {
    globalThis.localStorage?.setItem(starterTeamRegistryKey(scope), JSON.stringify(cleanRegistry(registry)));
  } catch {
  }
}

function rememberStarterTeamBot(scope: string, key: string, id: string): void {
  writeStarterTeamRegistry(scope, { ...readStarterTeamRegistry(scope), [key]: id });
}

function hasModel(bot: Bot): boolean {
  return Boolean(bot.modelSelection?.instanceId && bot.modelSelection?.model);
}

function roleMatches(bot: Bot, member: StarterTeamMember): boolean {
  return bot.title === member.title && bot.description === member.description && bot.soul === member.soul;
}

function freeName(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let suffix = 2; ; suffix++) {
    const candidate = `${base} ${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

async function patchBot(request: typeof api, id: string, body: Record<string, unknown>): Promise<Bot> {
  const { bot } = await request<{ bot: Bot }>(`/api/bots/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  return bot;
}

/** Repairs a registered member whose model or role drifted; it must come back correct or the run fails. */
async function repairMember(
  request: typeof api,
  bot: Bot,
  member: StarterTeamMember,
  modelSelection: ModelSelection,
): Promise<Bot> {
  const patched = await patchBot(request, bot.id, {
    title: member.title,
    description: member.description,
    soul: member.soul,
    ...(hasModel(bot) ? {} : { modelSelection, requireAvailableModel: true }),
  });
  const repaired = { ...bot, ...patched, messages: bot.messages };
  if (!hasModel(repaired) || !roleMatches(repaired, member)) {
    throw new Error(`The starter team member ${member.name} could not be repaired`);
  }
  return repaired;
}

/**
 * The new-bot defaults carry the server's own pick, so a client still loading
 * /api/instances can never mistake "not loaded yet" for "no engine".
 */
async function selectedModel(request: typeof api, options: StarterTeamOptions): Promise<ModelSelection> {
  const chosen = options.modelSelection;
  if (chosen?.instanceId && chosen.model) return chosen;
  const defaults = await request<{ modelSelection?: ModelSelection }>("/api/bot-defaults");
  const selection = defaults.modelSelection;
  if (!selection?.instanceId || !selection.model) {
    throw new StarterTeamUnavailableError("No AI engine is available for the starter team");
  }
  return selection;
}

async function environmentScope(request: typeof api, signal: AbortSignal): Promise<string> {
  try {
    const environment = await request<{ environmentId?: unknown }>("/.well-known/nordus/environment", { signal });
    if (typeof environment.environmentId === "string" && environment.environmentId) return environment.environmentId;
  } catch (error) {
    if (signal.aborted) throw error;
  }
  try {
    return globalThis.location?.origin || "local";
  } catch {
    return "local";
  }
}

function withSignal(request: typeof api, signal: AbortSignal): typeof api {
  return ((path, init) => request(path, { ...init, signal })) as typeof api;
}

interface BuildProgress {
  confirmed: Bot[];
  uncertain: boolean;
  creating: boolean;
}

async function buildStarterTeam(
  request: typeof api,
  options: StarterTeamOptions,
  progress: BuildProgress,
  signal: AbortSignal,
): Promise<StarterTeamResult> {
  const members = options.members?.length ? options.members : starterTeamMembers();
  const existing = options.existing ?? [];
  const scope = await environmentScope(request, signal);
  const registry = readStarterTeamRegistry(scope);
  const resolved = new Map<string, Bot>();
  const claimed = new Set<string>();
  // The workspace list says what still exists, so an id outside it is stale.
  for (const member of members) {
    const id = registry[member.key];
    if (!id) continue;
    const found = existing.find((bot) => bot.id === id);
    if (!found || claimed.has(found.id)) {
      delete registry[member.key];
      continue;
    }
    resolved.set(member.key, found);
    claimed.add(found.id);
  }
  writeStarterTeamRegistry(scope, registry);
  const taken = new Set(existing.map((bot) => bot.name));
  // Resolved before any write: no engine means no bot is made or reused at all.
  const modelSelection = await selectedModel(request, options);
  for (const member of members) {
    const current = resolved.get(member.key);
    if (current) {
      if (!hasModel(current) || !roleMatches(current, member)) {
        resolved.set(member.key, await repairMember(request, current, member, modelSelection));
      }
      continue;
    }
    const name = freeName(member.name, taken);
    taken.add(name);
    let bot: Bot;
    progress.creating = true;
    try {
      const created = await request<{ bot?: Bot }>("/api/bots", {
        method: "POST",
        body: JSON.stringify({
          name,
          title: member.title,
          description: member.description,
          modelSelection,
          requireAvailableModel: true,
        }),
      });
      if (!created.bot) throw new Error("The server did not return the new bot");
      bot = created.bot;
    } catch (error) {
      if (!clearRefusal(error)) {
        progress.uncertain = true;
      } else if (error instanceof StarterTeamUnavailableError || unavailable(error)) {
        throw new StarterTeamUnavailableError(error instanceof Error ? error.message : String(error));
      }
      throw error;
    } finally {
      progress.creating = false;
    }
    progress.confirmed.push(bot);
    rememberStarterTeamBot(scope, member.key, bot.id);
    const patched = await patchBot(request, bot.id, {
      name,
      title: member.title,
      description: member.description,
      soul: member.soul,
    });
    resolved.set(member.key, { ...bot, ...patched, messages: bot.messages });
  }
  const bots = members.map((member) => {
    const bot = resolved.get(member.key);
    if (!bot) throw new Error(`Starter team is missing ${member.key}`);
    return bot;
  });
  const chief = resolved.get("chief") ?? bots[0];
  if (!chief) throw new Error("Starter team is missing the chief");
  return { bots, chief };
}

export const STARTER_TEAM_TIMEOUT_MS = 30_000;

class StarterTeamTimeoutError extends Error {
  constructor() {
    super(`The starter team did not finish within ${STARTER_TEAM_TIMEOUT_MS} ms`);
    this.name = "StarterTeamTimeoutError";
  }
}

async function runStarterTeam(request: typeof api, options: StarterTeamOptions): Promise<StarterTeamResult> {
  const progress: BuildProgress = { confirmed: [], uncertain: false, creating: false };
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new StarterTeamTimeoutError());
    }, STARTER_TEAM_TIMEOUT_MS);
  });
  try {
    return await Promise.race([
      buildStarterTeam(withSignal(request, controller.signal), options, progress, controller.signal),
      timeout,
    ]);
  } catch (error) {
    if (error instanceof StarterTeamUnavailableError || error instanceof StarterTeamBuildError) throw error;
    if (progress.creating) progress.uncertain = true;
    throw new StarterTeamBuildError({ confirmedBots: progress.confirmed, uncertain: progress.uncertain }, error);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

let inFlight: { signature: string; promise: Promise<StarterTeamResult> } | null = null;

/**
 * Creates (or reuses) the starter team: three bots by default, or the members
 * given. Concurrent calls for the same team share one run, so a double click
 * cannot announce two identical teams.
 */
export function createStarterTeam(
  request: typeof api = api,
  options: StarterTeamOptions = {},
): Promise<StarterTeamResult> {
  const signature = (options.members ?? []).map((member) => member.key).join(",");
  if (inFlight?.signature === signature) return inFlight.promise;
  const promise = runStarterTeam(request, options);
  const entry = { signature, promise };
  inFlight = entry;
  const clear = () => {
    if (inFlight === entry) inFlight = null;
  };
  void promise.then(clear, clear);
  return promise;
}
