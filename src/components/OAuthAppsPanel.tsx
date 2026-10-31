import { useCallback, useEffect, useState } from "react";
import { useRefreshOnReturn } from "@/lib/use-refresh-on-return";
import { Check, Copy, LoaderCircle } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { api } from "@/state/store";
import { openExternalLink } from "@/lib/app-links";
import { brandIconSrc } from "@/lib/brand-icons";
import { copyText } from "@/lib/copy-text";
import { matchesSearch } from "@/lib/app-search";

type Provider = "google" | "github" | "slack" | "hubspot";
interface AppSummary { provider: Provider; configured: boolean; clientId: string | null; connected: boolean; account: string | null; accounts: Array<{ id: string; account: string | null }> }

const LABEL: Record<Provider, string> = { google: "Google", github: "GitHub", slack: "Slack", hubspot: "HubSpot" };
const MARK: Record<Provider, string> = { google: "googledrive", github: "github", slack: "slack", hubspot: "hubspot" };
const CALLBACK: Record<Provider, string> = {
  google: "/oauth/google/callback",
  github: "/oauth/github/callback",
  slack: "/mcp-oauth/callback",
  hubspot: "/mcp-oauth/callback",
};

/** Nordus's own apps on each platform: the person pastes the client id and secret once; the secret never comes back. */
export function OAuthAppsPanel({ query = "", onMatches }: { query?: string; onMatches?: (count: number) => void } = {}) {
  const [apps, setApps] = useState<AppSummary[] | null>(null);
  const [origin, setOrigin] = useState<string | null>(null);
  const load = useCallback(async () => {
    const result = await api("/api/oauth-apps").catch(() => null);
    if (result) { setApps(result.apps); setOrigin(result.callbackOrigin ?? null); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useRefreshOnReturn(load);
  const shown = apps?.filter((app) => matchesSearch(query, LABEL[app.provider], app.provider)) ?? null;
  const matchCount = shown?.length ?? -1;
  useEffect(() => { if (matchCount >= 0) onMatches?.(matchCount); }, [matchCount, onMatches]);
  if (!shown || shown.length === 0) return null;
  return (
    <section data-oauth-apps="" aria-labelledby="oauth-apps-title" className="mb-6">
      <h3 id="oauth-apps-title" className="px-2 text-[14px] font-semibold text-ink">{t("oauthApps.title")}</h3>
      <p className="mb-2 px-2 text-[12.5px] text-ink-secondary">{t("oauthApps.subtitle")}</p>
      <div className="flex flex-col gap-1.5">
        {shown.map((app) => <OAuthAppRow key={app.provider} app={app} origin={origin} onChanged={(next) => setApps(next)} />)}
      </div>
    </section>
  );
}

function OAuthAppRow({ app, origin, onChanged }: { app: AppSummary; origin: string | null; onChanged: (apps: AppSummary[]) => void }) {
  const [open, setOpen] = useState(false);
  const [clientId, setClientId] = useState(app.clientId ?? "");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const callback = origin ? `${origin}${CALLBACK[app.provider]}` : null;
  const save = async () => {
    setBusy(true); setError(null);
    try {
      const result = await api(`/api/oauth-apps/${app.provider}`, { method: "PUT", body: JSON.stringify({ clientId, clientSecret: secret }) });
      onChanged(result.apps); setSecret(""); setOpen(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const connect = async () => {
    setBusy(true); setError(null);
    try {
      const result = await api(`/api/oauth-apps/${app.provider}/connect`, { method: "POST" });
      if (result.authorizationUrl) await openExternalLink(result.authorizationUrl);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const mark = brandIconSrc(MARK[app.provider]);
  return (
    <div data-oauth-app={app.provider} className="rounded-xl px-2 py-2 hover:bg-raised/40">
      <div className="flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-[10px] bg-white">
          {mark && <img loading="lazy" decoding="async" src={mark} alt="" className="block h-[62%] w-[62%] object-contain" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-medium text-ink">{LABEL[app.provider]}</div>
          <div className="truncate text-[12px] text-ink-secondary">
            {app.connected ? (app.accounts.length > 1 ? t("plugins.accounts", { count: app.accounts.length }) : t("oauthApps.connectedAs", { account: app.account ?? LABEL[app.provider] }))
              : app.configured ? t("oauthApps.configured") : t("oauthApps.missing")}
          </div>
        </div>
        {(app.provider === "google" || app.provider === "github") && app.configured && (
          <button type="button" disabled={busy} onClick={() => void connect()} className="rounded-full bg-accent px-3 py-1 text-[12.5px] font-medium text-accent-ink hover:brightness-110 disabled:opacity-60">
            {busy ? <LoaderCircle size={12} className="animate-spin" /> : app.connected ? t("plugins.addAccount") : t("plugins.connect")}
          </button>
        )}
        <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)} className="rounded-full border border-white/12 bg-white/[0.06] px-3 py-1 text-[12.5px] text-ink hover:bg-white/[0.1]">
          {app.configured ? t("oauthApps.edit") : t("oauthApps.add")}
        </button>
      </div>
      {app.accounts.length > 0 && (
        <div className="mt-1.5 flex flex-col gap-0.5 pl-[52px]">
          {app.accounts.map((account) => (
            <div key={account.id} className="flex items-center justify-between gap-2 text-[12.5px]">
              <span className="min-w-0 truncate text-ink-secondary">{account.account ?? LABEL[app.provider]}</span>
              <button type="button" onClick={() => void api(`/api/oauth-apps/${app.provider}/disconnect`, { method: "POST", body: JSON.stringify({ accountId: account.id }) }).then((result) => onChanged(result.apps))}
                className="shrink-0 text-[12px] text-ink-tertiary hover:text-danger">{t("plugins.disconnect")}</button>
            </div>
          ))}
        </div>
      )}
      {open && (
        <div className="mt-2 flex flex-col gap-2 pl-[52px]">
          {callback && (
            <div className="text-[12px] text-ink-secondary">
              {t("oauthApps.callback")}
              <button type="button" onClick={() => { void copyText(callback).then(() => setCopied(true)); }} className="mt-1 flex w-full items-center gap-2 rounded-[8px] border border-white/10 bg-white/[0.03] px-2 py-1 text-left font-mono text-[11.5px] text-ink">
                <span className="min-w-0 flex-1 truncate">{callback}</span>
                {copied ? <Check size={12} className="shrink-0 text-success" /> : <Copy size={12} className="shrink-0" />}
              </button>
            </div>
          )}
          <input value={clientId} onChange={(event) => setClientId(event.target.value)} placeholder={t("oauthApps.clientId")} aria-label={t("oauthApps.clientId")}
            className="rounded-[10px] border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[13px] text-ink focus:border-focus focus:outline-none" />
          <input type="password" autoComplete="new-password" value={secret} onChange={(event) => setSecret(event.target.value)}
            placeholder={app.configured ? t("oauthApps.secretKeep") : t("oauthApps.secret")} aria-label={t("oauthApps.secret")}
            className="rounded-[10px] border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[13px] text-ink focus:border-focus focus:outline-none" />
          <div className="flex items-center gap-2">
            <button type="button" disabled={busy || !clientId.trim() || (!app.configured && !secret.trim())} onClick={() => void save()}
              className={cn("rounded-full bg-accent px-3.5 py-1 text-[12.5px] font-medium text-accent-ink hover:brightness-110 disabled:opacity-50")}>
              {t("oauthApps.save")}
            </button>
            <span className="text-[11.5px] text-ink-tertiary">{t("oauthApps.sealed")}</span>
          </div>
          {error && <p role="alert" className="text-[12px] text-danger/80">{error}</p>}
        </div>
      )}
    </div>
  );
}
