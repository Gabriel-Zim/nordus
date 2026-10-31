import { useCallback, useEffect, useState } from "react";
import { Check, Copy, LoaderCircle } from "lucide-react";
import { api } from "@/state/store";
import { copyText } from "@/lib/copy-text";
import { sessionOnce } from "../lib/session";
import { canPairDevices } from "./ServerPairingCard";
import { Card } from "./SettingsPrimitives";

interface GoogleLoginView { configured: boolean; clientId: string | null; updatedAt: number | null; redirectUri: string | null }

const field = "rounded-[10px] border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[13px] text-ink focus:border-focus focus:outline-none";

/** Settings → Pessoas: the Google client behind "Entrar com Google". Who may enter is the list below it. */
export function GoogleLoginSettings() {
  const [view, setView] = useState<GoogleLoginView | null>(null);
  const [owner, setOwner] = useState(false);
  const [clientId, setClientId] = useState("");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const next = await api("/api/google-login").catch(() => null) as GoogleLoginView | null;
    setView(next);
    if (next?.clientId) setClientId(next.clientId);
  }, []);
  useEffect(() => {
    void sessionOnce().then((state) => {
      setOwner(canPairDevices(state));
      if (canPairDevices(state)) void load();
    });
  }, [load]);

  if (!owner || !view) return null;

  const run = async (request: () => Promise<GoogleLoginView>) => {
    setBusy(true); setError(null);
    try { setView(await request()); setSecret(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const save = () => run(() => api("/api/google-login", { method: "PUT", body: JSON.stringify({ clientId, clientSecret: secret }) }));
  const turnOff = () => run(() => api("/api/google-login", { method: "DELETE" }));

  return (
    <Card title="Login com Google" subtitle="A tela de entrada da Nordus usa este cliente do Google. Só entra quem estiver na lista de pessoas abaixo.">
      <div className="flex flex-col gap-2">
        <p className="text-[12.5px] text-ink-secondary">
          {view.configured ? "Ligado. Quem abrir a Nordus vê o botão Entrar com Google." : "Desligado. Cole o ID do cliente e a chave secreta para ligar."}
        </p>
        {view.redirectUri && (
          <div className="text-[12px] text-ink-secondary">
            URI de redirecionamento para cadastrar no Google
            <button type="button" onClick={() => { void copyText(view.redirectUri!).then(() => setCopied(true)); }} className="mt-1 flex w-full items-center gap-2 rounded-[8px] border border-white/10 bg-white/[0.03] px-2 py-1 text-left font-mono text-[11.5px] text-ink">
              <span className="min-w-0 flex-1 truncate">{view.redirectUri}</span>
              {copied ? <Check size={12} className="shrink-0 text-success" /> : <Copy size={12} className="shrink-0" />}
            </button>
          </div>
        )}
        <input value={clientId} onChange={(event) => setClientId(event.target.value)} placeholder="ID do cliente (…apps.googleusercontent.com)" aria-label="ID do cliente" spellCheck={false} className={field} />
        <input type="password" autoComplete="new-password" value={secret} onChange={(event) => setSecret(event.target.value)}
          placeholder={view.configured ? "Chave secreta (deixe em branco para manter a salva)" : "Chave secreta do cliente"} aria-label="Chave secreta do cliente" className={field} />
        <div className="flex items-center gap-2">
          <button type="button" disabled={busy || !clientId.trim() || (!view.configured && !secret.trim())} onClick={() => void save()}
            className="rounded-full bg-accent px-3.5 py-1 text-[12.5px] font-medium text-accent-ink hover:brightness-110 disabled:opacity-50">
            {busy ? <LoaderCircle size={12} className="animate-spin" /> : "Salvar"}
          </button>
          {view.configured && (
            <button type="button" disabled={busy} onClick={() => void turnOff()} className="rounded-full border border-white/12 bg-white/[0.06] px-3 py-1 text-[12.5px] text-ink hover:bg-white/[0.1] disabled:opacity-50">
              Desligar
            </button>
          )}
          <span className="text-[11.5px] text-ink-tertiary">A chave fica cifrada no servidor e nunca volta para a tela.</span>
        </div>
        {error && <p role="alert" className="text-[12px] text-danger/80">{error}</p>}
      </div>
    </Card>
  );
}
