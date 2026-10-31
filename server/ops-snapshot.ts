// The operation at a glance, for the team lead's Watch (every 30 minutes) and Retrospective (end of day).
// Pure: index.ts gathers the rows, this file decides what needs attention and words it for the bot.

export const OPS_SNAPSHOT_PATH = "/api/internal/ops-snapshot";
export const OPS_WATCH_DAILY_ALERTS = 3;
export const OPS_APPROVAL_STALE_MS = 2 * 60 * 60_000;
export const OPS_WORK_STALE_MS = 60 * 60_000;
/** The agency's clock: the server runs on UTC, the day and the hours shown are São Paulo's. */
export const OPS_TIME_ZONE = "America/Sao_Paulo";

function wallClockMs(at: number, timeZone: string): number {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(at).map((part) => [part.type, Number(part.value)]));
  return Date.UTC(parts.year!, parts.month! - 1, parts.day!, parts.hour!, parts.minute!, parts.second!);
}

/** Midnight of `at`'s day in `timeZone`, as an instant. */
export function startOfDayIn(at: number, timeZone = OPS_TIME_ZONE): number {
  const wall = wallClockMs(at, timeZone);
  const midnightWall = wall - (wall % 86_400_000);
  return at - (wall - midnightWall);
}

export interface OpsItem {
  /** Stable across snapshots, so the Watch never raises the same thing twice in a day. */
  key: string;
  botName: string;
  title: string;
  at: number;
  detail?: string;
}

export interface OpsCost {
  botName: string;
  usd: number;
  turns: number;
}

export interface OpsSnapshot {
  at: number;
  failedRoutines: OpsItem[];
  waitingApprovals: OpsItem[];
  stuckWork: OpsItem[];
  incidents: OpsItem[];
  proposals: OpsItem[];
  costToday: OpsCost[];
}

export interface OpsDecision {
  wake: boolean;
  fresh: OpsItem[];
  reason: "news" | "nothing-new" | "daily-limit";
}

/** What the Watch may raise: failures, approvals parked over 2 hours, work without progress for an hour, incidents. */
export function opsAttention(snapshot: OpsSnapshot): OpsItem[] {
  return [...snapshot.failedRoutines, ...snapshot.incidents, ...snapshot.waitingApprovals, ...snapshot.stuckWork];
}

/** Wake the model only for something not yet raised today, and at most `limit` warnings a day. */
export function opsWatchDecision(
  attention: readonly OpsItem[],
  seenKeys: ReadonlySet<string>,
  alertsToday: number,
  limit = OPS_WATCH_DAILY_ALERTS,
): OpsDecision {
  const fresh = attention.filter((item) => !seenKeys.has(item.key));
  if (!fresh.length) return { wake: false, fresh: [], reason: "nothing-new" };
  if (alertsToday >= limit) return { wake: false, fresh, reason: "daily-limit" };
  return { wake: true, fresh, reason: "news" };
}

function clock(at: number): string {
  return new Date(at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: OPS_TIME_ZONE });
}

function age(now: number, at: number): string {
  const minutes = Math.max(1, Math.round((now - at) / 60_000));
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  return hours === 1 ? "há 1 hora" : `há ${hours} horas`;
}

function clean(text: string | undefined, max = 160): string {
  const flat = (text ?? "").replace(/\s+/g, " ").replace(/[<>]/g, "").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

function section(title: string, items: readonly OpsItem[], line: (item: OpsItem) => string): string[] {
  if (!items.length) return [`${title}: nada.`];
  return [`${title}:`, ...items.slice(0, 12).map((item) => `- ${line(item)}`), ...(items.length > 12 ? [`- e mais ${items.length - 12}.`] : [])];
}

function money(usd: number): string {
  return `US$ ${usd.toFixed(2).replace(".", ",")}`;
}

/** The whole day in plain Portuguese, for the Retrospective and for the Watch's context. */
export function describeOpsSnapshot(snapshot: OpsSnapshot): string {
  const now = snapshot.at;
  const total = snapshot.costToday.reduce((sum, row) => sum + row.usd, 0);
  return [
    `Retrato da operação às ${clock(now)}.`,
    ...section("Rotinas que falharam nas últimas 24 horas", snapshot.failedRoutines, (item) =>
      `${item.title} (${item.botName}, ${clock(item.at)})${item.detail ? `: ${clean(item.detail)}` : ""}`),
    ...section("Incidentes do time nas últimas 24 horas", snapshot.incidents, (item) =>
      `${item.botName}: ${clean(item.title)} (${clock(item.at)})`),
    ...section("Pedidos esperando o Avery há mais de 2 horas", snapshot.waitingApprovals, (item) =>
      `${item.botName}: ${clean(item.title)} (${age(now, item.at)})`),
    ...section("Trabalho entre bots parado há mais de 1 hora", snapshot.stuckWork, (item) =>
      `${item.botName}: ${clean(item.title)} (${item.detail ?? "sem andamento"}, ${age(now, item.at)})`),
    ...section("Propostas esperando aprovação", snapshot.proposals, (item) =>
      `${item.botName}: ${clean(item.title)} (${age(now, item.at)})`),
    snapshot.costToday.length
      ? `Custo de hoje por bot: ${snapshot.costToday.map((row) => `${row.botName} ${money(row.usd)} em ${row.turns} turnos`).join("; ")}. Total ${money(total)}.`
      : "Custo de hoje por bot: nenhum turno registrado.",
  ].join("\n");
}

/** Only what is new for this Watch, then the day for context. */
export function describeOpsWatch(snapshot: OpsSnapshot, fresh: readonly OpsItem[]): string {
  return [
    "Novidades desde o último aviso:",
    ...fresh.slice(0, 12).map((item) => `- ${item.botName}: ${clean(item.title)}${item.detail ? ` (${clean(item.detail, 120)})` : ""}`),
    "",
    describeOpsSnapshot(snapshot),
  ].join("\n");
}
