import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useRefreshOnReturn } from "@/lib/use-refresh-on-return";
import { Blocks, Check, ChevronDown, LoaderCircle } from "lucide-react";
import { cn } from "@/lib/cn";
import { t, tFromServer } from "@/lib/i18n";
import { api, useStore, type Bot } from "@/state/store";
import { openExternalLink } from "@/lib/app-links";
import { brandIconSrc, brandSlugForHost } from "@/lib/brand-icons";
import { APP_GROUPS, APP_PLUGINS, APPS_COMING, KEY_PLUGINS, appGroupOf, samePluginUrl, type AppGroup, type AppPlugin, type KeyPlugin } from "@/lib/app-plugins";
import { matchesSearch } from "@/lib/app-search";
import { mcpDisplay } from "@/lib/mcp-display";
import { mcpServersForBot, toggledMcpServers, updateMcpServers } from "@/lib/mcp-servers";
import { runMcpSignIn } from "@/lib/mcp-sign-in";
import { BotAvatar } from "./Avatar";
import { signedInToolsCheck, type McpServerListing } from "./McpServersPanel";

type Remote = McpServerListing & { url: string; enabled: boolean; auth?: "signed-in" | "needs-sign-in" };

function AppMark({ slug, className }: { slug: string; className?: string }) {
  const src = brandIconSrc(slug);
  return (
    <span className={cn("flex shrink-0 items-center justify-center overflow-hidden rounded-[10px] bg-white", className)}>
      {src ? <img loading="lazy" decoding="async" src={src} alt="" className="block h-[62%] w-[62%] object-contain" /> : <Blocks size={18} className="text-[#3b3b44]" aria-hidden="true" />}
    </span>
  );
}

/** Which bots may use a connected app: an internal bot without a list has every app, the others by choice. */
export function BotsForApp({ name, servers }: { name: string; servers: McpServerListing[] }) {
  const { state, dispatch } = useStore();
  const bots = state.bots.filter((bot) => !bot.hidden);
  const uses = (bot: Bot) => mcpServersForBot(servers, bot.mcpServers, bot.internal === true).some((server) => server.name === name);
  const toggle = (bot: Bot) => {
    dispatch({ type: "updateBot", botId: bot.id, patch: { mcpServers: toggledMcpServers(servers, bot.mcpServers, bot.internal === true, name) } });
  };
  return (
    <div data-app-bots="" className="mt-2 flex flex-col gap-1 rounded-[12px] border border-white/10 bg-white/[0.03] p-2">
      {bots.map((bot) => {
        const on = uses(bot);
        return (
          <button
            key={bot.id}
            type="button"
            role="switch"
            aria-checked={on}
            disabled={bot.busy}
            title={bot.busy ? t("plugins.botBusy") : undefined}
            onClick={() => toggle(bot)}
            className="flex items-center gap-2 rounded-[8px] px-1.5 py-1 text-left hover:bg-white/[0.04] disabled:opacity-50"
          >
            <BotAvatar bot={bot} size={22} />
            <span className="nb-name min-w-0 flex-1 truncate text-[12.5px] text-ink">{bot.name}</span>
            <span className={cn("relative h-[18px] w-8 shrink-0 rounded-full transition-colors", on ? "bg-accent" : "bg-white/15")}>
              <span className={cn("absolute top-[2px] size-[14px] rounded-full bg-white transition-all", on ? "left-[16px]" : "left-[2px]")} />
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** What the app's sign-in server said, in words the person can act on; the raw reason stays in the logs. */
function connectRefusal(cause: unknown, label: string): string {
  const raw = cause instanceof Error ? cause.message : JSON.stringify(cause ?? "");
  if (/regist|redirect|forbidden|\b40[03]\b|not (be )?allowed|approved/i.test(raw)) return t("plugins.refused", { app: label });
  return t("plugins.failed");
}
/** An error whose message is already written for the person. */
class Shown extends Error {}

function brandSlugFor(server: McpServerListing): string {
  if (!("url" in server)) return server.name;
  try { return brandSlugForHost(new URL((server as Remote).url).hostname) ?? server.name; } catch { return server.name; }
}

const connectionLabel = (name: string) => mcpDisplay({ name }).label;

const matches = (label: string, query: string, ...more: string[]) => matchesSearch(query, label, ...more);

/** Apps as plugins, like Grok: an icon, what it does, Conectar. The sign-in happens on the app itself. */
interface OAuthAccount { id: string; account: string | null; bots: string[] | null }
interface OAuthAppState { provider: string; configured: boolean; connected: boolean; account: string | null; accounts: OAuthAccount[] }

export function AppPlugins({ query = "", onlyConnected = false, onMatches }: { query?: string; onlyConnected?: boolean; onMatches?: (count: number) => void }) {
  const [oauthApps, setOAuthApps] = useState<OAuthAppState[]>([]);
  const loadOAuthApps = useCallback(async () => {
    const result = await api("/api/oauth-apps").catch(() => null);
    if (result && mounted.current) setOAuthApps(result.apps ?? []);
  }, []);
  const [vault, setVault] = useState<KeyVaultState | null>(null);
  const loadVault = useCallback(async () => {
    const result = await api("/api/key-connectors").catch(() => null);
    if (result && mounted.current) setVault(result as KeyVaultState);
  }, []);
  const [servers, setServers] = useState<Remote[] | null>(null);
  const [listing, setListing] = useState<McpServerListing[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [openBots, setOpenBots] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const load = useCallback(async () => {
    const result = await api("/api/mcp/servers").catch(() => ({ servers: [] }));
    if (!mounted.current) return;
    const listed = (result.servers ?? []) as McpServerListing[];
    setServers(listed.filter((server): server is Remote => "url" in server));
    setListing(listed);
    updateMcpServers(listed);
  }, []);
  useEffect(() => { void load(); void loadOAuthApps(); void loadVault(); }, [load, loadOAuthApps, loadVault]);
  const reloadAll = useCallback(() => { void load(); void loadOAuthApps(); void loadVault(); }, [load, loadOAuthApps, loadVault]);
  useRefreshOnReturn(reloadAll);

  const serversFor = (plugin: AppPlugin) => (servers ?? []).filter((server) => samePluginUrl(server.url, plugin.url));
  const isLive = (server: McpServerListing) => Boolean((server as { enabled?: boolean }).enabled) && (server as { auth?: string }).auth !== "needs-sign-in";
  const liveFor = (plugin: AppPlugin) => serversFor(plugin).filter(isLive);
  const otherConnections = onlyConnected
    ? listing.filter((server) => isLive(server) && !("url" in server && APP_PLUGINS.some((plugin) => samePluginUrl((server as Remote).url, plugin.url))))
    : [];
  const anyConnected = APP_PLUGINS.some((plugin) => liveFor(plugin).length > 0)
    || oauthApps.some((app) => app.configured && app.connected)
    || Boolean(vault?.apps.some((app) => app.accounts.length > 0))
    || otherConnections.length > 0;

  /** Each account of an app is a server of its own on the same address, signed in separately. */
  const connect = async (plugin: AppPlugin) => {
    if (busy || !servers) return;
    setBusy(plugin.slug);
    setErrors((current) => ({ ...current, [plugin.slug]: "" }));
    try {
      let server = serversFor(plugin).find((entry) => !isLive(entry));
      if (!server) {
        const taken = new Set(servers.map((entry) => entry.name));
        let name = plugin.slug;
        for (let n = 2; taken.has(name); n += 1) name = `${plugin.slug}-${n}`;
        const added = await api("/api/mcp/servers", { method: "POST", body: JSON.stringify({ name, type: plugin.type, url: plugin.url, enabled: false }) });
        server = ((added.servers ?? []) as McpServerListing[]).find((entry): entry is Remote => "url" in entry && entry.name === name);
        if (!server) throw new Error(t("plugins.failed"));
      }
      // The app refused this server's address, so its sign-in would return to a loopback port this browser cannot reach.
      const refusedHere = new AbortController();
      const result = await runMcpSignIn(server.name, {
        api, open: openExternalLink, signal: refusedHere.signal,
        onStarted: (started) => { if (started.pasteBack) refusedHere.abort(); },
      }).catch((cause: unknown) => {
        throw new Shown(connectRefusal(cause, plugin.label));
      });
      if (refusedHere.signal.aborted) throw new Shown(t("plugins.refused", { app: plugin.label }));
      if (result.phase !== "succeeded") throw new Shown(result.phase === "cancelled" ? t("plugins.cancelled") : connectRefusal(result, plugin.label));
      const controller = new AbortController();
      const tested = await signedInToolsCheck(server.name, api, controller.signal);
      if (!tested.ok) throw new Error(t("plugins.failed"));
      await api(`/api/mcp/servers/${server.name}`, { method: "PATCH", body: JSON.stringify({ enabled: true }) });
      await load();
      if (mounted.current) setOpenBots(plugin.slug);
    } catch (cause) {
      if (mounted.current) setErrors((current) => ({ ...current, [plugin.slug]: cause instanceof Shown ? cause.message : t("plugins.failed") }));
      await load();
    } finally {
      if (mounted.current) setBusy(null);
    }
  };

  const disconnect = async (plugin: AppPlugin, server: Remote) => {
    if (busy) return;
    setBusy(plugin.slug);
    try {
      await api(`/api/mcp/servers/${server.name}/sign-out`, { method: "POST" }).catch(() => undefined);
      await api(`/api/mcp/servers/${server.name}`, { method: "DELETE" });
      await load();
    } finally {
      if (mounted.current) setBusy(null);
    }
  };

  const renderPlugin = (plugin: AppPlugin) => {
    const live = liveFor(plugin);
    const connected = live.length > 0;
    const working = busy === plugin.slug;
    return (
      <div key={plugin.slug} data-plugin={plugin.slug} className={ROW}>
        <div className="flex items-center gap-3">
          <AppMark slug={plugin.slug} className="size-9" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px] font-medium text-ink">{plugin.label}</div>
            <div className="truncate text-[12px] text-ink-secondary">
              {live.length > 1 ? t("plugins.accounts", { count: live.length }) : tFromServer(`plugins.blurb.${plugin.slug}`, "")}
            </div>
          </div>
          {connected ? (
            <button
              type="button"
              aria-expanded={openBots === plugin.slug}
              onClick={() => setOpenBots((current) => current === plugin.slug ? null : plugin.slug)}
              className="flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[12.5px] text-success hover:bg-white/[0.05]"
            >
              <Check size={13} aria-hidden="true" /> {t("plugins.connected")}
              <ChevronDown size={12} aria-hidden="true" className={cn("transition-transform", openBots === plugin.slug && "rotate-180")} />
            </button>
          ) : (
            <button
              type="button"
              disabled={working || servers === null}
              onClick={() => void connect(plugin)}
              className="flex shrink-0 items-center gap-1.5 rounded-full border border-white/12 bg-white/[0.06] px-3 py-1 text-[12.5px] font-medium text-ink hover:bg-white/[0.1] disabled:cursor-wait"
            >
              {working && <LoaderCircle size={12} className="animate-spin" aria-hidden="true" />}
              {working ? t("plugins.connecting") : t("plugins.connect")}
            </button>
          )}
        </div>
        {errors[plugin.slug] && <p role="alert" className="mt-1 pl-12 text-[12px] text-danger/80">{errors[plugin.slug]}</p>}
        {connected && openBots === plugin.slug && servers && (
          <div className="mt-2 flex flex-col gap-3 pl-12">
            {live.map((server, index) => (
              <div key={server.name} data-plugin-account={server.name} className="rounded-[12px] border border-white/10 bg-white/[0.03] p-2">
                <div className="flex items-center justify-between gap-2 px-1">
                  <span className="min-w-0 truncate text-[13px] font-medium text-ink">{live.length > 1 ? t("plugins.accountN", { n: index + 1 }) : plugin.label}</span>
                  <button type="button" onClick={() => void disconnect(plugin, server)} className="shrink-0 text-[12px] text-ink-tertiary hover:text-danger">{t("plugins.disconnect")}</button>
                </div>
                <p className="mt-1 px-1 text-[11.5px] text-ink-tertiary">{t("plugins.whoUses")}</p>
                <BotsForApp name={server.name} servers={listing} />
              </div>
            ))}
            <button type="button" disabled={working} onClick={() => void connect(plugin)} className="self-start rounded-full border border-white/12 bg-white/[0.04] px-3 py-1 text-[12.5px] text-ink hover:bg-white/[0.08] disabled:cursor-wait">
              {working ? t("plugins.connecting") : t("plugins.addAccount")}
            </button>
          </div>
        )}
      </div>
    );
  };

  /** Every app as one row with its group and whether it is connected; connected rows rise to the top card. */
  type Row = { key: string; group: AppGroup; connected: boolean; coming: boolean; node: ReactNode };
  const rows: Row[] = [];
  for (const plugin of APP_PLUGINS) {
    if (!matches(plugin.label, query, plugin.slug)) continue;
    rows.push({ key: plugin.slug, group: appGroupOf(plugin.slug), connected: liveFor(plugin).length > 0, coming: false, node: renderPlugin(plugin) });
  }
  for (const provider of ["google", "github"] as const) {
    const app = oauthApps.find((entry) => entry.provider === provider);
    if (!app?.configured) continue;
    const label = provider === "google" ? t("plugins.google.label") : "GitHub";
    if (!matches(label, query) && !(provider === "google" && matches("Gmail Drive Agenda Docs Sheets", query))) continue;
    rows.push({ key: provider, group: appGroupOf(provider), connected: app.connected, coming: false, node: <AccountsTile key={provider} provider={provider} label={label} app={app} onChanged={reloadAll} /> });
  }
  for (const plugin of KEY_PLUGINS) {
    if (!matches(plugin.label, query)) continue;
    const slug = plugin.slug === "trello" ? "trello-key" : plugin.slug;
    const connected = Boolean(vault?.apps.find((entry) => entry.app === plugin.slug)?.accounts.length);
    rows.push({ key: slug, group: appGroupOf(slug), connected, coming: false, node: <KeyPluginTile key={slug} plugin={plugin} vault={vault} onChanged={loadVault} /> });
  }
  for (const app of APPS_COMING) {
    if (!matches(app.label, query, app.slug)) continue;
    if ((app.reason === "google" || app.slug === "github") && oauthApps.some((entry) => entry.provider === (app.slug === "github" ? "github" : "google") && entry.configured)) continue;
    rows.push({
      key: app.slug, group: appGroupOf(app.slug), connected: false, coming: true,
      node: (
        <div key={app.slug} data-plugin-coming={app.slug} className={cn(ROW, "flex-row items-center gap-3")}>
          <AppMark slug={app.slug} className="size-9 opacity-80" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px] font-medium text-ink-secondary">{app.label}</div>
            <div className="truncate text-[12px] text-ink-tertiary">{t(`plugins.coming.${app.reason}`)}</div>
          </div>
          <span className="shrink-0 rounded-full border border-white/10 px-2.5 py-0.5 text-[11.5px] text-ink-tertiary">{t("plugins.soon")}</span>
        </div>
      ),
    });
  }
  const connectedRows = rows.filter((row) => row.connected);
  const matchCount = onlyConnected ? connectedRows.length : rows.length;
  useEffect(() => { onMatches?.(matchCount); }, [matchCount, onMatches]);
  const others = otherConnections.filter((server) => matches(connectionLabel(server.name), query) || matches(server.name, query));
  const card = (id: string, title: string, items: ReactNode[]) => items.length === 0 ? null : (
    <section key={id} aria-labelledby={`plugins-group-${id}`} data-plugin-group={id}>
      <h3 id={`plugins-group-${id}`} className="mb-2 px-1 text-[12px] font-medium uppercase tracking-[0.06em] text-ink-tertiary">{title}</h3>
      <div className="divide-y divide-white/[0.06] overflow-hidden rounded-[16px] border border-white/[0.08] bg-white/[0.035]">{items}</div>
    </section>
  );

  return (
    <div data-app-plugins="" className="flex flex-col gap-6 pt-1">
      {card("connected", t("plugins.group.connected"), [
        ...connectedRows.map((row) => row.node),
        ...(onlyConnected ? others.map((server) => (
          <div key={server.name} data-plugin-other={server.name} className={cn(ROW, "flex-row items-center gap-3")}>
            <AppMark slug={mcpDisplay({ name: server.name, url: (server as { url?: string }).url }).slug ?? brandSlugFor(server)} className="size-9" />
            <div className="min-w-0 flex-1 truncate text-[14px] font-medium text-ink">{connectionLabel(server.name)}</div>
            <span className="flex shrink-0 items-center gap-1 px-2.5 py-1 text-[12.5px] text-success"><Check size={13} aria-hidden="true" /> {t("plugins.connected")}</span>
          </div>
        )) : []),
      ])}
      {!onlyConnected && APP_GROUPS.map((group) => card(group, t(`plugins.group.${group}`), [
        ...rows.filter((row) => row.group === group && !row.connected && !row.coming).map((row) => row.node),
        ...rows.filter((row) => row.group === group && row.coming).map((row) => row.node),
      ]))}
      {onlyConnected && servers !== null && vault !== null && !anyConnected && (
        <p data-plugins-empty="" className="px-2 py-10 text-center text-[13px] text-ink-secondary">{t("plugins.noneConnected")}</p>
      )}
    </div>
  );
}

const ROW = "flex min-w-0 flex-col px-3 py-2.5";

interface KeyAccount { id: string; label: string | null; bots: string[] | null }
interface KeyVaultState { apps: Array<{ app: KeyPlugin["slug"]; accounts: KeyAccount[] }>; trelloReady: boolean }

/** One connected account and the bots that may use it. */
function AccountBox({ name, bots: allowedBots, onBots, onDisconnect }: { name: string; bots: string[] | null; onBots: (next: string[] | null) => void; onDisconnect: () => void }) {
  const { state } = useStore();
  const bots = state.bots.filter((bot) => !bot.hidden);
  return (
    <div data-account="" className="rounded-[12px] border border-white/10 bg-white/[0.03] p-2">
      <div className="flex items-center justify-between gap-2 px-1">
        <span className="min-w-0 truncate text-[13px] font-medium text-ink">{name}</span>
        <button type="button" onClick={onDisconnect} className="shrink-0 text-[12px] text-ink-tertiary hover:text-danger">{t("plugins.disconnect")}</button>
      </div>
      <p className="mt-1 px-1 text-[11.5px] text-ink-tertiary">{t("plugins.whoUses")}</p>
      <div className="mt-1 flex flex-col gap-0.5">
        {bots.map((bot) => {
          const on = allowedBots === null || allowedBots.includes(bot.id);
          return (
            <button key={bot.id} type="button" role="switch" aria-checked={on}
              onClick={() => {
                const current = allowedBots === null ? bots.map((entry) => entry.id) : allowedBots;
                onBots(on ? current.filter((id) => id !== bot.id) : [...current, bot.id]);
              }}
              className="flex items-center gap-2 rounded-[8px] px-1.5 py-1 text-left hover:bg-white/[0.04]">
              <BotAvatar bot={bot} size={20} />
              <span className="nb-name min-w-0 flex-1 truncate text-[12px] text-ink">{bot.name}</span>
              <span className={cn("relative h-[16px] w-7 shrink-0 rounded-full transition-colors", on ? "bg-accent" : "bg-white/15")}>
                <span className={cn("absolute top-[2px] size-[12px] rounded-full bg-white transition-all", on ? "left-[13px]" : "left-[2px]")} />
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const fieldClass = "rounded-[10px] border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[13px] text-ink focus:border-focus focus:outline-none";

/** Apps that connect with a key or token (Metricool, ManyChat, Figma) or Trello's own authorize page: several
 *  accounts, each with the bots that may use it. */
function KeyPluginTile({ plugin, vault, onChanged, onlyConnected = false }: { plugin: KeyPlugin; vault: KeyVaultState | null; onChanged: () => Promise<void>; onlyConnected?: boolean }) {
  const [form, setForm] = useState(false);
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const accounts = vault?.apps.find((entry) => entry.app === plugin.slug)?.accounts ?? [];
  const authorize = plugin.slug === "trello";
  const needsTrelloKey = authorize && vault !== null && !vault.trelloReady;
  const run = async (work: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await work(); } catch (cause) { setError(cause instanceof Error ? cause.message : t("plugins.failed")); } finally { setBusy(false); }
  };
  const save = () => run(async () => {
    await api(`/api/key-connectors/${plugin.slug}`, { method: "POST", body: JSON.stringify(values) });
    setForm(false); setValues({}); setOpen(true);
    await onChanged();
  });
  const saveTrelloKey = () => run(async () => {
    await api("/api/key-connectors/trello/key", { method: "PUT", body: JSON.stringify({ key: values.trelloKey ?? "" }) });
    setValues({});
    await onChanged();
  });
  const authorizeTrello = () => run(async () => {
    const result = await api("/api/key-connectors/trello/connect", { method: "POST" });
    if (result.authorizationUrl) await openExternalLink(result.authorizationUrl);
  });
  const add = () => authorize ? (needsTrelloKey ? setForm((value) => !value) : void authorizeTrello()) : setForm((value) => !value);
  const setBots = (account: KeyAccount, next: string[] | null) =>
    void api(`/api/key-connectors/${plugin.slug}/accounts/${account.id}/bots`, { method: "PUT", body: JSON.stringify({ bots: next }) }).catch(() => undefined).then(onChanged);
  const disconnect = (account: KeyAccount) =>
    void api(`/api/key-connectors/${plugin.slug}/accounts/${account.id}`, { method: "DELETE" }).catch(() => undefined).then(onChanged);
  if (onlyConnected && accounts.length === 0) return null;
  const fields = needsTrelloKey ? [{ key: "trelloKey", secret: false }] : plugin.fields;
  const formOpen = form && (needsTrelloKey || !authorize);
  return (
    <div data-plugin={authorize ? "trello-key" : plugin.slug} className={ROW}>
      <div className="flex items-center gap-3">
        <AppMark slug={plugin.slug} className="size-9" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-medium text-ink">{plugin.label}</div>
          <div className="truncate text-[12px] text-ink-secondary">
            {accounts.length === 0 ? tFromServer(`plugins.blurb.${authorize ? "trelloKey" : plugin.slug}`, "") : accounts.length === 1 ? accounts[0]!.label ?? "" : t("plugins.accounts", { count: accounts.length })}
          </div>
        </div>
        {accounts.length > 0 ? (
          <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)} className="flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[12.5px] text-success hover:bg-white/[0.05]">
            <Check size={13} aria-hidden="true" /> {t("plugins.connected")}
            <ChevronDown size={12} aria-hidden="true" className={cn("transition-transform", open && "rotate-180")} />
          </button>
        ) : (
          <button type="button" disabled={busy || vault === null} aria-expanded={formOpen} onClick={add} className="flex shrink-0 items-center gap-1.5 rounded-full border border-white/12 bg-white/[0.06] px-3 py-1 text-[12.5px] font-medium text-ink hover:bg-white/[0.1] disabled:cursor-wait">
            {busy && <LoaderCircle size={12} className="animate-spin" aria-hidden="true" />}
            {busy ? t("plugins.connecting") : t("plugins.connect")}
          </button>
        )}
      </div>
      {open && accounts.length > 0 && (
        <div className="mt-2 flex flex-col gap-3 pl-12">
          {accounts.map((account) => (
            <AccountBox key={account.id} name={account.label ?? plugin.label} bots={account.bots} onBots={(next) => setBots(account, next)} onDisconnect={() => disconnect(account)} />
          ))}
          {!formOpen && (
            <button type="button" disabled={busy} onClick={add} className="self-start rounded-full border border-white/12 bg-white/[0.04] px-3 py-1 text-[12.5px] text-ink hover:bg-white/[0.08] disabled:cursor-wait">
              {busy ? t("plugins.connecting") : t("plugins.addAccount")}
            </button>
          )}
        </div>
      )}
      {formOpen && (
        <div className="mt-2 flex flex-col gap-2 pl-12">
          <p className="text-[12px] text-ink-secondary">{tFromServer(needsTrelloKey ? "plugins.where.trelloKey" : `plugins.where.${plugin.slug}`, "")}</p>
          {fields.map((field) => (
            <input
              key={field.key}
              type={field.secret ? "password" : "text"}
              autoComplete="off"
              value={values[field.key] ?? ""}
              onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
              placeholder={tFromServer(`plugins.field.${field.key}`, field.key)}
              aria-label={tFromServer(`plugins.field.${field.key}`, field.key)}
              className={fieldClass}
            />
          ))}
          <div>
            <button type="button" disabled={busy} onClick={() => {
              if (fields.some((field) => !values[field.key]?.trim())) { setError(t("plugins.fillField")); return; }
              void (needsTrelloKey ? saveTrelloKey() : save());
            }}
              className="rounded-full bg-accent px-3.5 py-1 text-[12.5px] font-medium text-accent-ink hover:brightness-110 disabled:opacity-50">
              {busy ? <LoaderCircle size={12} className="animate-spin" /> : needsTrelloKey ? t("plugins.save") : t("plugins.connect")}
            </button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="mt-1 pl-12 text-[12px] text-danger/80">{error}</p>}
    </div>
  );
}

/** An app connected through Nordus's own app on the platform (Google, GitHub): several accounts, each with the bots
 *  that may use it. */
function AccountsTile({ provider, label, app, onChanged }: { provider: "google" | "github"; label: string; app: OAuthAppState; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const addAccount = async () => {
    setBusy(true); setError(null);
    try {
      const result = await api(`/api/oauth-apps/${provider}/connect`, { method: "POST" });
      if (result.authorizationUrl) await openExternalLink(result.authorizationUrl);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("plugins.failed")); }
    finally { setBusy(false); }
  };
  const setBots = async (account: OAuthAccount, next: string[] | null) => {
    await api(`/api/oauth-apps/${provider}/accounts/${account.id}/bots`, { method: "PUT", body: JSON.stringify({ bots: next }) }).catch(() => undefined);
    onChanged();
  };
  const disconnect = async (account: OAuthAccount) => {
    await api(`/api/oauth-apps/${provider}/disconnect`, { method: "POST", body: JSON.stringify({ accountId: account.id }) }).catch(() => undefined);
    onChanged();
  };
  const mark = provider === "google" ? "googledrive" : "github";
  return (
    <section data-plugin={provider} className={ROW}>
      <div className="flex items-center gap-3">
        <AppMark slug={mark} className="size-9" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-medium text-ink">{label}</div>
          <div className="truncate text-[12px] text-ink-secondary">
            {app.accounts.length === 0 ? tFromServer(`plugins.blurb.${provider}`, "") : app.accounts.length === 1 ? app.accounts[0]!.account ?? "" : t("plugins.accounts", { count: app.accounts.length })}
          </div>
        </div>
        {app.accounts.length > 0 ? (
          <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)} className="flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[12.5px] text-success hover:bg-white/[0.05]">
            <Check size={13} aria-hidden="true" /> {t("plugins.connected")}
            <ChevronDown size={12} aria-hidden="true" className={cn("transition-transform", open && "rotate-180")} />
          </button>
        ) : (
          <button type="button" disabled={busy} onClick={() => void addAccount()} className="shrink-0 rounded-full border border-white/12 bg-white/[0.06] px-3 py-1 text-[12.5px] font-medium text-ink hover:bg-white/[0.1] disabled:cursor-wait">
            {busy ? t("plugins.connecting") : t("plugins.connect")}
          </button>
        )}
      </div>
      {open && (
        <div className="mt-2 flex flex-col gap-3 pl-12">
          {app.accounts.map((account) => (
            <AccountBox key={account.id} name={account.account ?? label} bots={account.bots} onBots={(next) => void setBots(account, next)} onDisconnect={() => void disconnect(account)} />
          ))}
          <button type="button" disabled={busy} onClick={() => void addAccount()} className="self-start rounded-full border border-white/12 bg-white/[0.04] px-3 py-1 text-[12.5px] text-ink hover:bg-white/[0.08] disabled:cursor-wait">
            {busy ? t("plugins.connecting") : t("plugins.addAccount")}
          </button>
        </div>
      )}
      {error && <p role="alert" className="mt-1 pl-12 text-[12px] text-danger/80">{error}</p>}
    </section>
  );
}
