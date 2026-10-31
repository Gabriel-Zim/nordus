import { useState } from "react";
import { Loader2 } from "lucide-react";

import { envSecretNameRefusal } from "../../shared/env-secret";
import { api, useStore, type ConfigStatus } from "@/state/store";

// Nordus: the keys the bots asked for by variable name (or the person added here). The server returns names, purposes
// and who gets each one, never a value; a change sends only what changes, and an empty value deletes the key.

const BUTTON = "cursor-pointer flex shrink-0 items-center justify-center rounded-lg bg-control px-3 py-1.5 text-[13px] hover:bg-raised-hover disabled:cursor-not-allowed disabled:opacity-50";
const FIELD = "min-w-0 flex-1 rounded-lg border border-hairline/40 bg-raised px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent";

export function BotEnvKeys() {
  const { state, dispatch } = useStore();
  const keys = state.config?.botEnv ?? [];
  const botName = (id: string) => state.bots.find((bot) => bot.id === id)?.name ?? id;
  const [editing, setEditing] = useState<string | null>(null);
  const [replacement, setReplacement] = useState("");
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const put = (env: Record<string, string>) =>
    api("/api/config", { method: "PUT", body: JSON.stringify({ botEnv: { env } }) })
      .then((status: ConfigStatus) => dispatch({ type: "configStatus", config: status }));

  const run = (label: string, change: Record<string, string>, done: () => void) => {
    if (busy) return;
    setBusy(label);
    setError(null);
    put(change).then(done).catch((failure: Error) => setError(failure.message)).finally(() => setBusy(null));
  };

  const add = () => {
    const target = name.trim().toUpperCase();
    if (!target || !value.trim()) return;
    const refusal = envSecretNameRefusal(target);
    if (refusal) {
      setError(refusal);
      return;
    }
    run("add", { [target]: value }, () => { setName(""); setValue(""); });
  };

  return (
    <details data-bot-env-keys className="rounded-lg border border-hairline/40 bg-inset px-3 py-2" open={keys.length > 0}>
      <summary className="cursor-pointer text-[13px] text-ink-secondary">Chaves dos robôs</summary>
      <div className="mt-3 flex flex-col gap-2">
        <p className="text-[11.5px] leading-relaxed text-ink-secondary">
          Chaves que os robôs pediram na conversa ou que você salvou aqui. Cada robô recebe a chave pelo nome da variável, sem ver o valor na conversa.
        </p>
        {keys.map((key) => (
          <div key={key.name} data-bot-env-key={key.name} className="flex flex-col gap-1.5 rounded-lg bg-raised/40 px-2 py-1.5">
            <div className="flex items-center gap-2">
              <span className="size-1.5 shrink-0 rounded-full bg-success" />
              <code className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink">{key.name}</code>
              <button type="button" disabled={busy !== null} onClick={() => { setEditing(editing === key.name ? null : key.name); setReplacement(""); }} className={BUTTON}>
                Trocar
              </button>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => run(`del:${key.name}`, { [key.name]: "" }, () => setEditing(null))}
                aria-label={`Apagar ${key.name}`}
                className={`${BUTTON} text-danger`}
              >
                {busy === `del:${key.name}` ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : "Apagar"}
              </button>
            </div>
            <div className="ms-3.5 text-[11.5px] text-ink-secondary">
              {key.purpose ? `${key.purpose} · ` : ""}
              {key.bots ? `Só para ${key.bots.map(botName).join(", ")}` : "Todos os robôs da casa"}
            </div>
            {editing === key.name && (
              <div className="ms-3.5 flex gap-2">
                <input
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={replacement}
                  onChange={(event) => setReplacement(event.target.value)}
                  placeholder="Cole a chave nova"
                  aria-label={`Chave nova para ${key.name}`}
                  className={FIELD}
                />
                <button
                  type="button"
                  disabled={busy !== null || !replacement.trim()}
                  onClick={() => run(`set:${key.name}`, { [key.name]: replacement }, () => { setEditing(null); setReplacement(""); })}
                  className={BUTTON}
                >
                  {busy === `set:${key.name}` ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : "Salvar"}
                </button>
              </div>
            )}
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          <input
            type="text"
            value={name}
            onChange={(event) => { setError(null); setName(event.target.value); }}
            placeholder="APIFY_TOKEN"
            aria-label="Nome da variável"
            autoComplete="off"
            spellCheck={false}
            className={`${FIELD} font-mono`}
          />
          <input
            type="password"
            value={value}
            onChange={(event) => { setError(null); setValue(event.target.value); }}
            onKeyDown={(event) => event.key === "Enter" && add()}
            placeholder="Chave"
            aria-label="Chave"
            autoComplete="off"
            spellCheck={false}
            className={FIELD}
          />
          <button type="button" disabled={busy !== null || !name.trim() || !value.trim()} onClick={add} className={BUTTON}>
            {busy === "add" ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : "Adicionar"}
          </button>
        </div>
        {error && <div role="alert" className="text-[12px] text-danger">{error}</div>}
      </div>
    </details>
  );
}
