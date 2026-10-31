import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, KeyRound, LoaderCircle, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { brandIconSrc, brandSlugForHost } from "@/lib/brand-icons";
import { useRefreshOnReturn } from "@/lib/use-refresh-on-return";
import { api, useStore, type Bot } from "@/state/store";
import { BotAvatar } from "./Avatar";
import { LiveBrowser } from "./BrowserPanel";

// Chaveiro: the owner signs in to a site once, in a browser on the server, and chooses which bots may use that sign-in.
// The sign-in itself never comes to this screen; the list has only the site's name, address, date and bots.

export interface KeychainEntry { id: string; name: string; site: string; bots: string[]; createdAt: string; updatedAt: string; version: number }
interface OpenSignIn { id: string; url: string; site: string }

export function siteLogo(site: string): string {
  return brandIconSrc(brandSlugForHost(site)) ?? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(site)}&sz=128`;
}

function savedOn(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("pt-BR", { day: "numeric", month: "short", year: "numeric" });
}

export function useKeychain() {
  const [entries, setEntries] = useState<KeychainEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { setEntries((await api("/api/keychain")).entries); setError(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useRefreshOnReturn(load);
  const setBots = async (entry: KeychainEntry, bots: string[]) => {
    setEntries((current) => current?.map((candidate) => candidate.id === entry.id ? { ...candidate, bots } : candidate) ?? current);
    try {
      const result = await api(`/api/keychain/${entry.id}`, { method: "PATCH", body: JSON.stringify({ bots }) });
      setEntries((current) => current?.map((candidate) => candidate.id === entry.id ? result.entry : candidate) ?? current);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); void load(); }
  };
  return { entries, error, setError, load, setBots, setEntries };
}

const toggle = (on: boolean) => (
  <span className={cn("relative h-[16px] w-7 shrink-0 rounded-full transition-colors", on ? "bg-accent" : "bg-white/15")}>
    <span className={cn("absolute top-[2px] size-[12px] rounded-full bg-white transition-all", on ? "left-[13px]" : "left-[2px]")} />
  </span>
);

/** In Conectar apps. */
export function KeychainSection() {
  const { state } = useStore();
  const { entries, error, setError, load, setBots, setEntries } = useKeychain();
  const [address, setAddress] = useState("");
  const [asking, setAsking] = useState(false);
  const [starting, setStarting] = useState(false);
  const [open, setOpen] = useState<OpenSignIn | null>(null);
  const bots = state.bots.filter((bot) => !bot.hidden);

  const start = async () => {
    if (!address.trim() || starting) return;
    setStarting(true); setError(null);
    try {
      setOpen(await api("/api/keychain/sign-in", { method: "POST", body: JSON.stringify({ url: address }) }));
      setAsking(false); setAddress("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setStarting(false); }
  };
  const signOut = async (entry: KeychainEntry) => {
    if (!window.confirm(`Sair do ${entry.name}? Todos os robôs perdem esse login.`)) return;
    setEntries((current) => current?.filter((candidate) => candidate.id !== entry.id) ?? current);
    try { await api(`/api/keychain/${entry.id}`, { method: "DELETE" }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    void load();
  };

  return (
    <section data-keychain="" aria-labelledby="keychain-title" className="mb-7">
      <div className="flex items-center justify-between gap-3 px-2">
        <div className="min-w-0">
          <h3 id="keychain-title" className="text-[14px] font-semibold text-ink">Chaveiro</h3>
          <p className="text-[12.5px] text-ink-secondary">Entre uma vez num site e escolha quais robôs podem usar esse login.</p>
        </div>
        {!asking && (
          <button type="button" data-keychain-add="" onClick={() => setAsking(true)}
            className="shrink-0 rounded-full border border-white/12 bg-white/[0.06] px-3 py-1.5 text-[12.5px] font-medium text-ink hover:bg-white/[0.1]">
            Entrar num site
          </button>
        )}
      </div>
      {asking && (
        <form className="mt-2 flex items-center gap-2 px-2" onSubmit={(event) => { event.preventDefault(); void start(); }}>
          <input autoFocus value={address} onChange={(event) => setAddress(event.target.value)} placeholder="Endereço do site, por exemplo instagram.com"
            aria-label="Endereço do site" spellCheck={false}
            className="min-w-0 flex-1 rounded-full border border-white/12 bg-white/[0.04] px-3 py-1.5 text-[13px] text-ink outline-none placeholder:text-ink-tertiary focus:border-white/25" />
          <button type="submit" disabled={!address.trim() || starting}
            className="flex shrink-0 items-center gap-1.5 rounded-full bg-accent px-3.5 py-1.5 text-[12.5px] font-medium text-accent-ink disabled:opacity-50">
            {starting && <LoaderCircle size={13} className="animate-spin" />}Abrir
          </button>
          <button type="button" aria-label="Cancelar" onClick={() => { setAsking(false); setAddress(""); }}
            className="flex size-7 shrink-0 items-center justify-center rounded-full text-ink-tertiary hover:bg-white/[0.06]"><X size={14} /></button>
        </form>
      )}
      {error && <p role="alert" className="mt-2 px-2 text-[12px] text-danger/80">{error}</p>}
      <div className="mt-2 flex flex-col gap-1.5">
        {entries?.map((entry) => <KeychainRow key={entry.id} entry={entry} bots={bots} onBots={(next) => void setBots(entry, next)} onSignOut={() => void signOut(entry)} />)}
        {entries && entries.length === 0 && !asking && (
          <p className="px-2 text-[12.5px] text-ink-tertiary">Nenhum site ainda.</p>
        )}
      </div>
      {open && <KeychainSignInDialog signIn={open} onClose={(saved) => { setOpen(null); if (saved) void load(); }} />}
    </section>
  );
}

function KeychainRow({ entry, bots, onBots, onSignOut }: { entry: KeychainEntry; bots: Bot[]; onBots: (bots: string[]) => void; onSignOut: () => void }) {
  const [open, setOpen] = useState(false);
  const users = bots.filter((bot) => entry.bots.includes(bot.id));
  return (
    <div data-keychain-site={entry.site} className="rounded-[14px] border border-white/10 bg-white/[0.03] px-3 py-2.5">
      <div className="flex items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-[10px] border border-white/12 bg-white/90">
          <img loading="lazy" decoding="async" src={siteLogo(entry.site)} alt="" className="block h-[60%] w-[60%] object-contain" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px] font-medium text-ink">{entry.name}</div>
          <div className="truncate text-[11.5px] text-ink-tertiary">{entry.site} · Guardado em {savedOn(entry.updatedAt)}</div>
        </div>
        <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}
          className="flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[12px] text-ink-secondary hover:bg-white/[0.05]">
          {users.length === 0 ? "Nenhum robô" : users.length === 1 ? users[0]!.name : `${users.length} robôs`}
          <ChevronDown size={12} aria-hidden="true" className={cn("transition-transform", open && "rotate-180")} />
        </button>
      </div>
      {open && (
        <div className="mt-2 pl-12">
          <p className="px-1 text-[11.5px] text-ink-tertiary">Quem pode usar</p>
          <div className="mt-1 flex flex-col gap-0.5">
            {bots.map((bot) => {
              const on = entry.bots.includes(bot.id);
              return (
                <button key={bot.id} type="button" role="switch" aria-checked={on} aria-label={bot.name}
                  onClick={() => onBots(on ? entry.bots.filter((id) => id !== bot.id) : [...entry.bots, bot.id])}
                  className="flex items-center gap-2 rounded-[8px] px-1.5 py-1 text-left hover:bg-white/[0.04]">
                  <BotAvatar bot={bot} size={20} />
                  <span className="nb-name min-w-0 flex-1 truncate text-[12px] text-ink">{bot.name}</span>
                  {toggle(on)}
                </button>
              );
            })}
          </div>
          <button type="button" onClick={onSignOut} className="mt-2 px-1 text-[12px] text-ink-tertiary hover:text-danger">Sair do site</button>
        </div>
      )}
    </div>
  );
}

/** The server's browser, live: the owner signs in (codes and confirmations included) and presses Pronto. */
function KeychainSignInDialog({ signIn, onClose }: { signIn: OpenSignIn; onClose: (saved: boolean) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const finished = useRef(false);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const viewer = useRef({ id: signIn.id, name: "Chaveiro", browser: true } as unknown as Bot).current;
  const target = useRef({ url: signIn.url, site: signIn.site, nonce: 1 }).current;
  const cancel = () => {
    if (finished.current) return;
    finished.current = true;
    void api(`/api/keychain/sign-in/${signIn.id}/cancel`, { method: "POST", body: "{}" }).catch(() => undefined);
    onClose(false);
  };
  const done = async () => {
    setSaving(true); setError(null);
    try {
      await api(`/api/keychain/sign-in/${signIn.id}/done`, { method: "POST", body: "{}", timeoutMs: 60_000 });
      finished.current = true;
      onClose(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setSaving(false); }
  };
  return (
    <dialog ref={dialog} data-keychain-sign-in="" onCancel={(event) => { event.preventDefault(); cancel(); }}
      className="m-auto flex h-[min(820px,calc(100vh-32px))] w-[min(1100px,calc(100vw-32px))] flex-col overflow-hidden rounded-2xl border border-white/12 bg-card p-0 text-ink shadow-2xl backdrop:bg-black/50">
      <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
        <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-[9px] border border-white/12 bg-white/90">
          <img loading="lazy" decoding="async" src={siteLogo(signIn.site)} alt="" className="block h-[60%] w-[60%] object-contain" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold">Entre na sua conta</div>
          <div className="text-[12px] text-ink-secondary">Faça o login como sempre faz. Quando terminar, toque em Pronto.</div>
        </div>
        <button type="button" onClick={() => void done()} disabled={saving}
          className="flex items-center gap-1.5 rounded-full bg-accent px-4 py-1.5 text-[13px] font-medium text-accent-ink disabled:opacity-60">
          {saving ? <LoaderCircle size={14} className="animate-spin" /> : <KeyRound size={14} />}Pronto
        </button>
        <button type="button" aria-label="Cancelar" title="Cancelar" onClick={cancel}
          className="flex size-8 items-center justify-center rounded-full text-ink-tertiary hover:bg-white/[0.06]"><X size={16} /></button>
      </div>
      {error && <p role="alert" className="border-b border-white/10 px-4 py-2 text-[12px] text-danger/80">{error}</p>}
      <div className="flex min-h-0 flex-1 p-2"><LiveBrowser bot={viewer} signIn={target} keychain /></div>
    </dialog>
  );
}

/** In a bot's profile: which of the Chaveiro's sites this bot may use. */
export function BotKeychainLogins({ bot }: { bot: Bot }) {
  const { entries, error, setBots } = useKeychain();
  if (!entries || entries.length === 0) return null;
  return (
    <section data-bot-keychain="">
      <h3 className="mb-1 text-[13px] font-semibold text-ink">Pode usar estes logins</h3>
      <p className="mb-2 text-[12px] text-ink-secondary">Sites do Chaveiro que {bot.name} usa no navegador dele.</p>
      <div className="flex flex-col gap-0.5">
        {entries.map((entry) => {
          const on = entry.bots.includes(bot.id);
          return (
            <button key={entry.id} type="button" role="switch" aria-checked={on} aria-label={entry.name} data-bot-keychain-site={entry.site}
              onClick={() => void setBots(entry, on ? entry.bots.filter((id) => id !== bot.id) : [...entry.bots, bot.id])}
              className="flex items-center gap-2.5 rounded-[10px] px-2 py-1.5 text-left hover:bg-white/[0.04]">
              <span className="flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-[7px] bg-white/90">
                <img loading="lazy" decoding="async" src={siteLogo(entry.site)} alt="" className="block h-[64%] w-[64%] object-contain" />
              </span>
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{entry.name}</span>
              {toggle(on)}
            </button>
          );
        })}
      </div>
      {error && <p role="alert" className="mt-1 text-[12px] text-danger/80">{error}</p>}
    </section>
  );
}
