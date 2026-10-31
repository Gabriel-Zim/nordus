// One list of everything the person already has: accounts of the connected-app catalog, the built-in apps, the
// OAuth apps and the custom connections. Each source keeps its own shape; this turns them into the same row with one
// of four states, so the screen never has to know where an app came from.
import type { ConnectorStatus } from "./connector-status";
import { hasActiveConnection } from "./connector-status";
import { t } from "./i18n";

export type AppSource = "catalog" | "native" | "oauth" | "custom";
export type AppState = "connected" | "needs-sign-in" | "problem" | "off";

export interface AppEntry {
  id: string;
  name: string;
  source: AppSource;
  state: AppState;
  /** Brand icon slug, when the source knows one. */
  slug: string | null;
  /** Logo URL of a catalog app that has no brand icon of its own. */
  logo?: string | null;
  /** Only for "problem": one plain sentence, no technical detail. */
  reason?: string;
}

const ACTIVE = /^active$/i;
const NEEDS_SIGN_IN = /^(initiated|initializing|pending|expired)$/i;

export interface CatalogCard { slug: string; label: string; logo?: string | null }

/** Catalog apps the person has an account for (working, waiting for sign-in, expired or failed); the rest of the
 *  catalog is not "theirs" yet. */
export function catalogAppEntries(cards: readonly CatalogCard[], status: Record<string, ConnectorStatus>): AppEntry[] {
  const out: AppEntry[] = [];
  for (const [slug, state] of Object.entries(status)) {
    const card = cards.find((candidate) => candidate.slug === slug);
    const statuses = [state.status, ...(state.accounts ?? []).map((account) => account.status)].filter((value): value is string => Boolean(value));
    const waiting = Boolean(state.pending) || statuses.some((value) => NEEDS_SIGN_IN.test(value));
    const broken = statuses.some((value) => !ACTIVE.test(value) && !NEEDS_SIGN_IN.test(value));
    const entry = { id: `catalog:${slug}`, name: card?.label ?? slug, source: "catalog" as const, slug, logo: card?.logo ?? null };
    if (hasActiveConnection(state)) out.push({ ...entry, state: "connected" });
    else if (waiting) out.push({ ...entry, state: "needs-sign-in" });
    else if (broken) out.push({ ...entry, state: "problem", reason: t("apps.yours.failedReason") });
  }
  return out;
}

export interface CustomServerInput {
  name: string;
  /** Name to show, already friendly. */
  label: string;
  slug: string | null;
  enabled: boolean;
  auth?: "signed-in" | "needs-sign-in";
  health?: { state: "ok" | "degraded" | "down"; reason?: string };
  /** Set when the server is one of the built-in apps (Whop, Notion, ...). */
  native?: boolean;
}

export function serverAppEntries(servers: readonly CustomServerInput[]): AppEntry[] {
  return servers.map((server) => {
    const base = { id: `${server.native ? "native" : "custom"}:${server.name}`, name: server.label, source: server.native ? "native" as const : "custom" as const, slug: server.slug };
    if (!server.enabled) return { ...base, state: "off" as const };
    if (server.auth === "needs-sign-in") return { ...base, state: "needs-sign-in" as const };
    if (server.health && server.health.state !== "ok") {
      return { ...base, state: "problem" as const, reason: server.health.reason || t("apps.yours.genericProblem") };
    }
    return { ...base, state: "connected" as const };
  });
}

export interface OAuthAppInput { provider: string; label: string; slug: string | null; configured: boolean; connected: boolean }

/** An OAuth app counts once the person has set it up: signed in is connected, set up but not signed in needs a sign-in. */
export function oauthAppEntries(apps: readonly OAuthAppInput[]): AppEntry[] {
  const out: AppEntry[] = [];
  for (const app of apps) {
    const entry = { id: `oauth:${app.provider}`, name: app.label, source: "oauth" as const, slug: app.slug };
    if (app.connected) out.push({ ...entry, state: "connected" });
    else if (app.configured) out.push({ ...entry, state: "needs-sign-in" });
  }
  return out;
}

const RANK: Record<AppState, number> = { "needs-sign-in": 0, problem: 1, connected: 2, off: 3 };

/** Everything in one list: what needs attention first, then working apps, switched-off ones last. */
export function mergeAppEntries(...lists: AppEntry[][]): AppEntry[] {
  const seen = new Set<string>();
  return lists.flat()
    .filter((entry) => !seen.has(entry.id) && !!seen.add(entry.id))
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => RANK[a.entry.state] - RANK[b.entry.state] || a.index - b.index)
    .map(({ entry }) => entry);
}
