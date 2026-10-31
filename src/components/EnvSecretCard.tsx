import { useState, type FormEvent } from "react";
import { KeyRound, Loader2, LockKeyhole, RefreshCw, X } from "lucide-react";

import { credentialResumeOutcome } from "../../shared/credential-request";
import { cn } from "@/lib/cn";
import { api, useStore, type ConfigStatus, type Message } from "@/state/store";
import { ASK_FIELD, ASK_PRIMARY_BUTTON, ASK_QUIET_BUTTON, AskCard, AskSettledLine, returnFocusToComposer } from "./AskCard";

// Nordus: a key the bot asked for by variable name. The value goes once into the settings, the same save as Settings
// (PUT /api/config, section botEnv), where the person later sees the name, replaces or deletes it. The field never
// echoes it, the card keeps no copy and the chat only ever shows the name.

export function EnvSecretCard({ botId, threadId, message }: { botId: string; threadId: string; message: Message }) {
  const { dispatch } = useStore();
  const secret = message.secret!;
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  // The key is in the settings but telling the server failed: the button only retries that, never re-sends the key.
  const [saved, setSaved] = useState(false);
  const endpoint = `/api/bots/${encodeURIComponent(botId)}/secret-cards/${encodeURIComponent(message.id)}`;
  const error = localError ?? secret.error;
  const outcome = credentialResumeOutcome(secret);
  const provided = outcome === "provided";
  const declined = outcome === "dismissed";
  const name = secret.envName ?? secret.label;

  if (declined && (secret.resumed || !error)) return null;

  const post = async (action: "provided" | "resume" | "dismiss", body: Record<string, unknown> = {}) =>
    api(`${endpoint}/${action}`, { method: "POST", body: JSON.stringify({ threadId, ...body }) });

  const save = async (event?: FormEvent) => {
    event?.preventDefault();
    const next = value.trim();
    if (saving || (!next && !saved)) return;
    setSaving(true);
    setLocalError(null);
    try {
      if (!saved) {
        const status: ConfigStatus = await api("/api/config", {
          method: "PUT",
          body: JSON.stringify({ botEnv: {
            env: { [name]: next },
            bots: { [name]: secret.envScope === "shared" ? [] : [botId] },
            ...(secret.envPurpose ? { purposes: { [name]: secret.envPurpose } } : {}),
          } }),
        });
        dispatch({ type: "configStatus", config: status });
        setSaved(true);
      }
      setValue("");
      await post("provided");
      returnFocusToComposer();
    } catch (failure) {
      setLocalError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setSaving(false);
    }
  };

  const retryResume = async () => {
    if (saving) return;
    setSaving(true);
    setLocalError(null);
    try {
      await post("resume");
    } catch (failure) {
      setLocalError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setSaving(false);
    }
  };

  if (secret.superseded) {
    return (
      <AskSettledLine icon={<X size={13} />} ariaLabel={name}>
        <span className="text-ink-secondary">{name}</span>
        <span> · Trocado por um pedido mais novo</span>
      </AskSettledLine>
    );
  }

  if (secret.stopped && !provided) {
    return (
      <AskSettledLine icon={<X size={13} />} ariaLabel={name}>
        <span className="text-ink-secondary">{name}</span>
        <span> · Parado</span>
      </AskSettledLine>
    );
  }

  if (provided || declined) {
    const retry = !secret.resumed && !secret.stopped && error ? (
      <button type="button" onClick={() => void retryResume()} disabled={saving} className={cn(ASK_QUIET_BUTTON, "text-accent-text")}>
        {saving ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
        Tentar de novo
      </button>
    ) : undefined;
    const footer = secret.stopped ? "Parado"
      : declined ? "Não deu para seguir sem a chave"
        : secret.resumed ? "O robô seguiu sem ver a chave"
          : error ? "A chave está guardada; retomar falhou"
            : "Retomando";
    return (
      <AskSettledLine
        ariaLabel={name}
        icon={secret.resumed || secret.stopped
          ? undefined
          : declined
            ? <X size={13} className="text-danger" />
            : error ? <KeyRound size={13} /> : <Loader2 size={13} className="animate-spin" />}
        action={retry}
        detail={error && <p role="alert" className="ms-[19px] mt-1 text-[12px] text-danger">{error}</p>}
      >
        <span className="text-ink-secondary">{provided ? `Chave ${name} salva` : name}</span>
        <span className={declined ? "text-danger" : undefined}> · {footer}</span>
      </AskSettledLine>
    );
  }

  return (
    <AskCard
      ariaLabel={name}
      icon={<KeyRound size={15} />}
      title={name}
      explanation={secret.description}
      onDismiss={() => void post("dismiss").catch(() => {})}
      dismissLabel="Agora não"
    >
      <form onSubmit={(event) => void save(event)}>
        <div className="flex flex-wrap gap-2">
          <input
            type="password"
            name={`chave-${message.id}`}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            data-1p-ignore
            data-lpignore="true"
            dir="ltr"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={secret.placeholder}
            disabled={saving || saved}
            aria-label={`Chave ${name}`}
            className={cn(ASK_FIELD, "min-w-[10rem] flex-1")}
          />
          <button type="submit" disabled={saving || (!value.trim() && !saved)} className={ASK_PRIMARY_BUTTON}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <LockKeyhole size={14} />}
            {saved ? "Continuar" : "Salvar com segurança"}
          </button>
        </div>
        <div className="mt-2 flex items-center gap-1 text-[11.5px] text-ink-tertiary">
          <LockKeyhole size={11} /> Fica nas Configurações do Nordus, onde dá para trocar ou apagar. Não aparece na conversa.
        </div>
      </form>
      {error && <p role="alert" className="mt-2 text-[12px] text-danger">{error}</p>}
    </AskCard>
  );
}
