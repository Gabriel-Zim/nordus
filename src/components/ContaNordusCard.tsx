import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, Globe, LoaderCircle } from "lucide-react";
import { api } from "@/state/store";
import { sessionOnce } from "../lib/session";
import { canPairDevices } from "./ServerPairingCard";
import { Card } from "./SettingsPrimitives";

type ContaStatus =
  | { state: "off" }
  | { state: "waiting"; url: string; code: string; expiresAt: number }
  | { state: "starting"; address: string; email: string | null }
  | { state: "live"; address: string; email: string | null; managedBy: "server" | "serve" }
  | { state: "error"; error: string; address?: string; email?: string | null };

const button = "inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12.5px] font-medium disabled:opacity-50";
const primary = `${button} bg-accent text-accent-ink hover:brightness-110`;
const secondary = `${button} border border-white/12 bg-white/[0.06] text-ink hover:bg-white/[0.1]`;

function openExternal(url: string): void {
  window.open(url, "_blank", "noopener,noreferrer");
}

/** Settings → Acesso remoto: this Nordus at name.nordus.ai, with "Entrar com Google", through the Nordus account. */
export function ContaNordusCard() {
  const [owner, setOwner] = useState(false);
  const [status, setStatus] = useState<ContaStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const opened = useRef<string | null>(null);

  const load = useCallback(async () => {
    const next = await api("/api/conta").catch(() => null) as ContaStatus | null;
    setStatus(next);
    return next;
  }, []);

  useEffect(() => {
    void sessionOnce().then((state) => {
      setOwner(canPairDevices(state));
      if (canPairDevices(state)) void load();
    });
  }, [load]);

  const moving = status?.state === "waiting" || status?.state === "starting" || busy;
  useEffect(() => {
    if (!moving) return;
    const timer = setInterval(() => {
      void load().then((next) => {
        if (next?.state === "waiting" && opened.current !== next.url) {
          opened.current = next.url;
          openExternal(next.url);
        }
        if (next && next.state !== "off") setBusy(false);
      });
    }, 1500);
    return () => clearInterval(timer);
  }, [moving, load]);

  if (!owner || !status) return null;

  const connect = async () => {
    setBusy(true);
    opened.current = null;
    setStatus(await api("/api/conta/conectar", { method: "POST" }).catch(() => status) as ContaStatus);
  };
  const disconnect = async () => {
    if (!window.confirm("Desconectar este Nordus da conta? O endereço nordus.ai para de funcionar e o Entrar com Google pela conta é desligado.")) return;
    setBusy(true);
    try { setStatus(await api("/api/conta/desconectar", { method: "POST" }) as ContaStatus); } finally { setBusy(false); }
  };

  return (
    <Card title="Endereço nordus.ai" subtitle="Abra este Nordus de qualquer lugar em seu-nome.nordus.ai, com HTTPS e Entrar com Google. Sem domínio para comprar e sem abrir portas.">
      <div className="flex flex-col gap-2.5 text-[12.5px]">
        {status.state === "off" && (
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className={primary} disabled={busy} onClick={() => void connect()}>
              {busy ? <LoaderCircle size={13} className="animate-spin" /> : <Globe size={13} />} Conectar com a conta Nordus
            </button>
            <span className="text-ink-tertiary">Abre o navegador para você entrar com o Google e escolher o nome.</span>
          </div>
        )}
        {status.state === "waiting" && (
          <div className="flex flex-col gap-2 rounded-[12px] border border-white/10 bg-white/[0.03] p-3">
            <p className="text-ink-secondary">No navegador, entre com o Google, confira o código e escolha o endereço. Esta tela continua sozinha.</p>
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-mono text-[18px] font-semibold tracking-[0.08em] text-ink">{status.code}</span>
              <button type="button" className={primary} onClick={() => openExternal(status.url)}><ExternalLink size={13} /> Abrir conta.nordus.ai</button>
              <LoaderCircle size={14} className="animate-spin text-ink-tertiary" aria-label="Esperando a confirmação" />
            </div>
          </div>
        )}
        {status.state === "starting" && (
          <p className="flex items-center gap-2 text-ink-secondary"><LoaderCircle size={13} className="animate-spin" /> Ligando {status.address}…</p>
        )}
        {status.state === "live" && (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-2 font-mono text-[14px] text-ink"><span className="h-2 w-2 rounded-full bg-success shadow-[0_0_8px] shadow-success" />{status.address.replace("https://", "")}</span>
              <button type="button" className={secondary} onClick={() => openExternal(status.address)}><ExternalLink size={13} /> Abrir</button>
            </div>
            <p className="text-ink-tertiary">
              {status.email ? `${status.email} entra com o Google, com acesso total. ` : ""}Convide outras pessoas na seção Pessoas.
              {status.managedBy === "serve" ? " Este endereço é servido pelo comando serve --tunnel." : ""}
            </p>
            <div><button type="button" className={secondary} disabled={busy} onClick={() => void disconnect()}>Desconectar</button></div>
          </div>
        )}
        {status.state === "error" && (
          <div className="flex flex-col gap-2">
            <p role="alert" className="text-danger/80">{status.error}</p>
            <div className="flex gap-2">
              <button type="button" className={primary} disabled={busy} onClick={() => void connect()}>Tentar de novo</button>
              {status.address && <button type="button" className={secondary} disabled={busy} onClick={() => void disconnect()}>Desconectar</button>}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
