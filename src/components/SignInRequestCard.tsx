import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { Check, Eye, EyeOff, Hand, KeyRound, Loader2, LockKeyhole, LogIn, RefreshCw, X } from "lucide-react";

import type { ComputerHelpRef } from "../../shared/wire";
import { signInOutcome } from "../../shared/sign-in-request";
import { cn } from "@/lib/cn";
import { openBrowserStage } from "@/lib/browser-stage";
import { t } from "@/lib/i18n";
import { answerSignIn, signInHostIsHere } from "@/lib/sign-in";
import { api, useStore, type Message } from "@/state/store";
import { ASK_QUIET_BUTTON, AskSettledLine, returnFocusToComposer } from "./AskCard";

// Security: a saved login is encrypted on the server and filled by fill_login; neither the bot nor any screen ever gets
// it back.

const WHERE = {
  browser: "signIn.where.browser",
  vm: "signIn.where.vm",
  cloud: "signIn.where.cloud",
  local: "signIn.where.local",
  host: "signIn.where.host",
} as const;

export function SignInRequestCard({
  botId,
  botName,
  threadId,
  message,
}: {
  botId: string;
  botName: string;
  threadId: string;
  message: Message;
}) {
  const { state, dispatch } = useStore();
  const card = message.signIn!;
  const [pending, setPending] = useState<"done" | "cancel" | null>(null);
  const [explained, setExplained] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const error = localError ?? card.error;
  const outcome = signInOutcome(card);
  const ref = { botId, threadId, messageId: message.id, place: card.place };
  const here = signInHostIsHere();

  const answer = async (choice: "done" | "cancel") => {
    if (pending) return;
    setPending(choice);
    setLocalError(null);
    try {
      await answerSignIn(ref, choice);
      returnFocusToComposer();
    } catch (cause) {
      setLocalError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(null);
    }
  };

  const stopped = card.stopped === true;
  // "Abrir" shows the bot's browser live; closing that view after signing in settles the card and the bot carries on.
  const openedLive = useRef(false);
  const liveOpen = Boolean(state?.computerOpen);
  const wasOpen = useRef(liveOpen);
  useEffect(() => {
    if (wasOpen.current && !liveOpen && openedLive.current && !outcome) {
      openedLive.current = false;
      void answer("done");
    }
    wasOpen.current = liveOpen;
  });

  if (card.superseded || (stopped && !outcome)) {
    return (
      <AskSettledLine icon={<X size={13} />} ariaLabel={t("signIn.title")}>
        <span className="text-ink-secondary">{card.site}</span>
        <span> · {t(card.superseded ? "signIn.superseded" : "chat.turnStopped")}</span>
      </AskSettledLine>
    );
  }

  if (outcome) {
    const retry = !card.resumed && !stopped && error ? (
      <button type="button" onClick={() => void answer(outcome === "done" ? "done" : "cancel")} disabled={pending !== null}
        className={cn(ASK_QUIET_BUTTON, "text-accent-text")}>
        {pending ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
        {t("signIn.retry")}
      </button>
    ) : undefined;
    return (
      <AskSettledLine
        ariaLabel={t("signIn.title")}
        icon={outcome === "cancelled" ? <X size={13} className="text-ink-tertiary" /> : card.resumed || stopped ? undefined : error ? <LogIn size={13} /> : <Loader2 size={13} className="animate-spin" />}
        action={retry}
        detail={error && <p role="alert" className="ms-[19px] mt-1 text-[12px] text-danger">{error}</p>}
      >
        <span className="text-ink-secondary">{card.sent ? t("signIn.sent") : card.savedLogin
          ? t("signIn.settled.saved", { site: card.savedLogin })
          : t(outcome === "done" ? "signIn.settled.done" : "signIn.settled.cancelled", { site: card.site })}</span>
        {!(card.sent && !error) && <span> · {card.resumed ? t("signIn.settled.resumed", { name: botName }) : stopped ? t("chat.turnStopped") : error ? t("signIn.settled.failed") : t("signIn.settled.waiting")}</span>}
      </AskSettledLine>
    );
  }

  const where = WHERE[card.place === "local" && !here ? "host" : card.place];
  void where;
  const open = () => {
    if (card.place === "local") setExplained(true);
    else if (card.place === "browser") {
      setFormOpen(true);
      // The bot's browser opens as the full window stage, not in the side panel.
      openBrowserStage(botId);
    }
    else {
      openedLive.current = true;
      dispatch({ type: "openSignIn", botId, messageId: message.id, url: card.url, site: card.site, place: card.place });
    }
  };
  let pageHost = card.site;
  try { pageHost = new URL(card.url).hostname; } catch {}
  const secretHere = card.place === "browser";
  return (
    <div data-sign-in-card="" role="group" aria-label={t("signIn.cardLabel", { name: botName, site: card.site })} className="flex max-w-full flex-col items-start gap-1.5">
      <div className="flex w-full max-w-[420px] items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] py-2 pe-2 ps-3">
        <KeyRound size={18} aria-hidden="true" className="shrink-0 text-ink-secondary" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-medium leading-tight text-ink" data-testid="sign-in-site">{t("signIn.cardTitle", { site: siteDisplayName(pageHost, card.site) })}</div>
          <div className="truncate text-[12px] leading-tight text-ink-tertiary">{t(secretHere ? "signIn.cardSub" : "signIn.cardSubScreen")}</div>
        </div>
        <button type="button" onClick={open} disabled={pending !== null} className="flex h-8 shrink-0 items-center justify-center rounded-full bg-accent px-4 text-[13px] font-medium text-accent-ink hover:brightness-110 disabled:opacity-60">
          {pending === "done" ? <Loader2 size={13} className="animate-spin" /> : t("signIn.open")}
        </button>
        <button
          type="button"
          onClick={() => void answer("cancel")}
          disabled={pending !== null}
          aria-label={t("signIn.cancel")}
          title={t("signIn.cancel")}
          className="flex size-6 shrink-0 items-center justify-center rounded-full text-ink-tertiary hover:bg-ink/[0.07] hover:text-ink-secondary"
        >
          {pending === "cancel" ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />}
        </button>
      </div>
      {explained && (
        <p role="note" className="text-[12px] leading-snug text-ink-secondary">{t(here ? "signIn.local.explain" : "signIn.local.explainHost", { name: botName })}</p>
      )}
      {error && <p role="alert" className="text-[12px] text-danger/80">{error}</p>}
      {formOpen && <SignInSecretDialog botId={botId} threadId={threadId} messageId={message.id} onClose={() => setFormOpen(false)} />}
    </div>
  );
}

type SecretTarget = { host: string; field: "password" | "code" | null };

/** Security: the value is typed here, posted once to the server and written into the page there; it is never kept in state, shown in chat or handed to the bot. */
export function SignInSecretDialog({ botId, threadId, messageId, onClose }: { botId: string; threadId: string; messageId: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [target, setTarget] = useState<SecretTarget | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  const [sending, setSending] = useState(false);
  const endpoint = `/api/bots/${encodeURIComponent(botId)}/sign-in-cards/${encodeURIComponent(messageId)}/type-secret`;
  useEffect(() => {
    // A small card in the corner of the window, not a modal: it must not cover the page of the browser stage.
    dialog.current?.show?.();
    let active = true;
    void api(`${endpoint}?threadId=${encodeURIComponent(threadId)}`).then((answer: SecretTarget) => { if (active) setTarget(answer); })
      .catch((cause: unknown) => { if (active) setProblem(cause instanceof Error ? cause.message : String(cause)); });
    return () => { active = false; };
  }, [endpoint, threadId]);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const field = event.currentTarget.elements.namedItem("secret") as HTMLInputElement;
    if (sending || !field.value) return;
    const value = field.value;
    field.value = "";
    setSending(true);
    setProblem(null);
    try {
      await api(endpoint, { method: "POST", body: JSON.stringify({ threadId, value }) });
      returnFocusToComposer();
      onClose();
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSending(false);
    }
  };
  const label = target?.field ? t(target.field === "code" ? "signIn.field.code" : "signIn.field.password") : "";
  const card = (
    <dialog ref={dialog} onClose={onClose} data-testid="sign-in-secret-corner"
      className="fixed bottom-5 end-5 start-auto top-auto z-[70] m-0 w-[min(320px,calc(100%-32px))] rounded-2xl border border-hairline/50 bg-card p-4 text-ink shadow-2xl">
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-[14px] font-medium">{label || t("signIn.form.checking")}</h2>
          <button type="button" onClick={onClose} aria-label={t("signIn.close")} className="rounded-md p-1 text-ink-secondary hover:bg-inset hover:text-ink"><X size={16} /></button>
        </div>
        {target?.field && (
          <div className="relative">
            <input name="secret" type={shown ? "text" : "password"} aria-label={label} autoComplete="new-password" spellCheck={false} maxLength={1024} dir="ltr"
              className="w-full rounded-lg bg-inset py-2 pe-9 ps-3 text-[13px] outline-none focus:ring-1 focus:ring-accent" />
            <button type="button" onClick={() => setShown((value) => !value)} aria-pressed={shown} aria-label={t(shown ? "signIn.hide" : "signIn.show")}
              className="absolute end-1.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-ink-tertiary hover:text-ink">
              {shown ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
        )}
        {problem && <p role="alert" className="text-[12px] text-danger">{problem}</p>}
        <div className="flex items-center justify-between gap-3">
          <p className="flex min-w-0 items-center gap-1 text-[11.5px] text-ink-tertiary" data-testid="sign-in-secret-note">
            <LockKeyhole size={11} aria-hidden="true" className="shrink-0" />
            <span className="break-words">{target ? t("signIn.neverShown", { host: target.host }) : ""}</span>
          </p>
          <button type="submit" disabled={sending || !target?.field} className="shrink-0 rounded-lg bg-accent px-4 py-2 text-[12.5px] font-medium text-accent-ink disabled:opacity-40">
            {sending ? <Loader2 size={14} className="animate-spin" /> : t("signIn.send")}
          </button>
        </div>
      </form>
    </dialog>
  );
  return typeof document === "undefined" ? card : createPortal(card, document.body);
}

const SITE_NAMES: Record<string, string> = {
  manychat: "ManyChat", instagram: "Instagram", facebook: "Facebook", google: "Google", linkedin: "LinkedIn", github: "GitHub",
  youtube: "YouTube", tiktok: "TikTok", metricool: "Metricool", notion: "Notion", canva: "Canva", figma: "Figma", x: "X",
  twitter: "X", whatsapp: "WhatsApp", hubspot: "HubSpot", stripe: "Stripe", shopify: "Shopify", mercadopago: "Mercado Pago",
};

/** "app.manychat.com" reads as "ManyChat": people see the service, not the address. */
export function siteDisplayName(host: string, fallback: string): string {
  const parts = host.replace(/^www\./, "").split(".").filter(Boolean);
  if (parts.length < 2) return fallback;
  const tld2 = parts.length >= 3 && /^(com|co|org|net|gov)$/.test(parts[parts.length - 2]!) ? 3 : 2;
  const core = parts[parts.length - tld2]!.toLowerCase();
  return SITE_NAMES[core] ?? core.charAt(0).toUpperCase() + core.slice(1);
}

export function SignInBanner({
  help,
  askerName,
  takeControl,
  onError,
}: {
  help: ComputerHelpRef;
  askerName: string;
  takeControl?: { onClick: () => void; disabled?: boolean; pending?: boolean };
  onError?: (message: string | null) => void;
}) {
  const [pending, setPending] = useState<"done" | "cancel" | null>(null);
  const answer = async (choice: "done" | "cancel") => {
    if (pending) return;
    setPending(choice);
    onError?.(null);
    try { await answerSignIn(help, choice); }
    catch (cause) { onError?.(cause instanceof Error ? cause.message : String(cause)); }
    finally { setPending(null); }
  };
  return (
    <div className="mt-3 rounded-xl border border-warning/25 bg-warning/10 p-4 text-start" data-testid="sign-in-banner">
      <div className="text-[13px] leading-relaxed text-warning">
        <b>{askerName}</b> {t("signIn.banner", { site: help.site })}
      </div>
      {help.place === "local" && (
        <div className="mt-1 text-[12px] leading-relaxed text-ink-secondary">
          {t(signInHostIsHere() ? "signIn.where.local" : "signIn.where.host", { name: askerName })}
        </div>
      )}
      <div className="mt-2 flex gap-2">
        {takeControl && (
          <button
            type="button"
            onClick={takeControl.onClick}
            disabled={takeControl.disabled}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-accent py-2 text-[13px] font-medium text-accent-ink hover:brightness-110 disabled:opacity-50"
          >
            {takeControl.pending ? <Loader2 size={14} className="animate-spin" /> : <Hand size={14} />}
            {t("computer.takeControl")}
          </button>
        )}
        <button
          type="button"
          onClick={() => void answer("done")}
          disabled={pending !== null}
          className={cn("flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-[13px] font-medium disabled:opacity-50",
            takeControl ? "bg-control text-ink hover:bg-raised-hover" : "flex-1 bg-accent text-accent-ink hover:brightness-110")}
        >
          {pending === "done" ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          {t("signIn.done")}
        </button>
        <button
          type="button"
          onClick={() => void answer("cancel")}
          disabled={pending !== null}
          className="rounded-lg bg-control px-3 py-2 text-[13px] text-ink hover:bg-raised-hover disabled:opacity-50"
        >
          {t("signIn.cancel")}
        </button>
      </div>
    </div>
  );
}
