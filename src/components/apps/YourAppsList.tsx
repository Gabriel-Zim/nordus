import { useCallback, useEffect, useRef, useState } from "react";
import { Blocks, Loader2, LogIn } from "lucide-react";

import { openExternalLink } from "@/lib/app-links";
import { matchesSearch } from "@/lib/app-search";
import { APP_PLUGINS, samePluginUrl } from "@/lib/app-plugins";
import {
  catalogAppEntries,
  mergeAppEntries,
  oauthAppEntries,
  serverAppEntries,
  type AppEntry,
  type AppState,
  type CatalogCard,
  type CustomServerInput,
} from "@/lib/app-status";
import { brandIconSrc } from "@/lib/brand-icons";
import { cn } from "@/lib/cn";
import type { ConnectorStatus } from "@/lib/connector-status";
import { t } from "@/lib/i18n";
import { mcpDisplay } from "@/lib/mcp-display";
import { MCP_HEALTH_EVENT } from "@/lib/mcp-health-event";
import { runMcpSignIn } from "@/lib/mcp-sign-in";
import { useRefreshOnReturn } from "@/lib/use-refresh-on-return";
import { isWhopServer } from "@/lib/whop-integration";
import { api } from "@/state/store";

interface ServerListing {
  name: string;
  type?: string;
  url?: string;
  enabled: boolean;
  auth?: "signed-in" | "needs-sign-in";
  health?: { state: "ok" | "degraded" | "down"; reason?: string };
}
interface OAuthListing { provider: string; configured: boolean; connected: boolean }

/** The platform apps Nordus signs into itself; the others are signed into through their own connection. */
const OAUTH_LABEL: Record<string, string> = { google: "Google", github: "GitHub" };
const OAUTH_MARK: Record<string, string> = { google: "googledrive", github: "github" };

const DOT: Record<AppState, string> = {
  connected: "bg-success",
  "needs-sign-in": "bg-warning",
  problem: "bg-danger",
  off: "bg-ink-tertiary",
};
const LABEL = {
  connected: "apps.yours.connected",
  "needs-sign-in": "apps.yours.needsSignIn",
  problem: "apps.yours.problem",
  off: "apps.yours.off",
} as const;

function serverInputs(servers: readonly ServerListing[]): CustomServerInput[] {
  return servers.map((server) => {
    const display = mcpDisplay({ name: server.name, url: server.url });
    const whop = Boolean(server.url && isWhopServer({ url: server.url, type: server.type }));
    const plugin = server.url ? APP_PLUGINS.find((entry) => samePluginUrl(entry.url, server.url!)) : undefined;
    return {
      name: server.name,
      label: whop ? "Whop" : display.label,
      slug: display.slug,
      enabled: server.enabled,
      auth: server.auth,
      health: server.health,
      native: whop || Boolean(plugin),
    };
  });
}

/** "Your apps": every app the person already has, from all sources, with one plain state each. */
export function YourAppsList({ cards, status, highLevelConnected, query = "", refreshKey = 0, onConnectCatalog }: {
  cards: readonly CatalogCard[];
  status: Record<string, ConnectorStatus>;
  highLevelConnected: boolean | null;
  query?: string;
  refreshKey?: number;
  onConnectCatalog: (slug: string) => void;
}) {
  const [servers, setServers] = useState<ServerListing[]>([]);
  const [oauth, setOauth] = useState<OAuthListing[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const load = useCallback(async () => {
    const [mcp, apps] = await Promise.all([
      api("/api/mcp/servers").catch(() => null),
      api("/api/oauth-apps").catch(() => null),
    ]);
    if (!mounted.current) return;
    if (mcp) setServers((mcp.servers ?? []) as ServerListing[]);
    if (apps) setOauth((apps.apps ?? []) as OAuthListing[]);
  }, []);
  useEffect(() => { void load(); }, [load, refreshKey]);
  useEffect(() => {
    window.addEventListener(MCP_HEALTH_EVENT, load);
    return () => window.removeEventListener(MCP_HEALTH_EVENT, load);
  }, [load]);
  useRefreshOnReturn(load);

  const entries = mergeAppEntries(
    catalogAppEntries(cards, status),
    serverAppEntries(serverInputs(servers)),
    oauthAppEntries(oauth.filter((app) => app.provider in OAUTH_LABEL).map((app) => ({
      provider: app.provider,
      label: OAUTH_LABEL[app.provider]!,
      slug: OAUTH_MARK[app.provider] ?? null,
      configured: app.configured,
      connected: app.connected,
    }))),
    highLevelConnected === true ? [{ id: "native:highlevel", name: "HighLevel", source: "native", state: "connected", slug: "highlevel" }] : [],
  ).filter((entry) => matchesSearch(query, entry.name));
  if (entries.length === 0) return null;

  const signIn = async (entry: AppEntry) => {
    const [source, key] = [entry.id.slice(0, entry.id.indexOf(":")), entry.id.slice(entry.id.indexOf(":") + 1)];
    if (source === "catalog") { onConnectCatalog(key); return; }
    setBusy(entry.id);
    setFailed(null);
    try {
      if (source === "oauth") {
        const result = await api(`/api/oauth-apps/${key}/connect`, { method: "POST" });
        if (result.authorizationUrl) await openExternalLink(result.authorizationUrl);
      } else {
        const result = await runMcpSignIn(key, { api, open: openExternalLink });
        if (result.phase !== "succeeded" && result.phase !== "cancelled") setFailed(entry.id);
      }
    } catch {
      if (mounted.current) setFailed(entry.id);
    } finally {
      if (mounted.current) { setBusy(null); void load(); }
    }
  };

  return (
    <section data-your-apps="" aria-labelledby="your-apps-title" className="mb-7">
      <h3 id="your-apps-title" className="px-2 text-[14px] font-semibold text-ink">{t("apps.yours.title")}</h3>
      <ul className="mt-2 flex flex-col gap-1.5">
        {entries.map((entry) => {
          const mark = entry.slug ? brandIconSrc(entry.slug) : null;
          const src = mark ?? entry.logo ?? null;
          return (
            <li
              key={entry.id}
              data-your-app={entry.id}
              data-app-state={entry.state}
              className="rounded-[12px] border border-white/[0.08] bg-white/[0.035] px-3 py-2"
            >
              <div className="flex items-center gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-[10px] bg-white">
                  {src ? <img loading="lazy" decoding="async" src={src} alt="" className="block h-[62%] w-[62%] object-contain" /> : <Blocks size={17} className="text-[#3b3b44]" aria-hidden="true" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-medium text-ink">{entry.name}</div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-ink-secondary">
                    <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", DOT[entry.state])} />
                    <span data-app-state-label="">{t(LABEL[entry.state])}</span>
                  </div>
                </div>
                {entry.state === "needs-sign-in" && (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void signIn(entry)}
                    className="flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[10px] bg-accent px-3 text-[12px] font-medium text-white hover:brightness-110 disabled:opacity-40"
                  >
                    {busy === entry.id ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <LogIn size={14} aria-hidden="true" />}
                    {t("apps.yours.signIn")}
                  </button>
                )}
              </div>
              {entry.state === "problem" && entry.reason && <p data-app-reason="" className="mt-1.5 ps-12 text-[12px] leading-relaxed text-ink-secondary">{entry.reason}</p>}
              {failed === entry.id && <p role="alert" className="mt-1.5 ps-12 text-[12px] text-danger">{t("apps.yours.signInFailed")}</p>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
