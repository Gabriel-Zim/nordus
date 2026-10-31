import { useEffect, useRef, useState } from "react";
import { CalendarDays, Copy, X } from "lucide-react";

import { useModalDialog } from "@/hooks/use-modal-dialog";
import { copyText } from "@/lib/copy-text";
import { t } from "@/lib/i18n";
import { useOwnerOrAdmin } from "@/lib/use-owner-or-admin";
import { api } from "@/state/api";

/** "Ver no meu calendário": a secret iCal link for Google Agenda, shown only to who administers. */
export function CalendarFeedButton() {
  const admin = useOwnerOrAdmin();
  const [open, setOpen] = useState(false);
  if (admin !== true) return null;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="flex items-center gap-1.5 rounded-lg border border-hairline/50 px-3 py-2 text-[12.5px] font-medium text-ink-secondary hover:bg-raised hover:text-ink"><CalendarDays size={15} aria-hidden="true" />{t("automations.feed.open")}</button>
      {open && <CalendarFeedDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function CalendarFeedDialog({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalDialog(dialogRef, onClose);
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (method: "GET" | "POST") => {
    setBusy(true);
    setError(null);
    try {
      const answer = await api<{ url: string | null }>("/api/routines/feed", { method });
      setUrl(answer.url);
      setCopied(false);
    } catch {
      setError(t("automations.feed.error"));
    } finally {
      setBusy(false);
    }
  };
  // The first open loads the current link; there is none until someone creates it.
  useEffect(() => { void run("GET"); }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-5 pt-[14vh] backdrop-blur-sm" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={t("automations.feed.title")} tabIndex={-1} className="w-full max-w-[560px] rounded-2xl border border-hairline/60 bg-panel p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-[17px] font-semibold text-ink">{t("automations.feed.title")}</h2>
          <button type="button" onClick={onClose} aria-label={t("automations.newBox.cancel")} className="rounded-full p-1.5 text-ink-secondary hover:bg-raised hover:text-ink"><X size={16} /></button>
        </div>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-secondary">{t("automations.feed.explain")}</p>
        {url ? (
          <div className="mt-4 flex items-center gap-2">
            <input readOnly value={url} aria-label={t("automations.feed.link")} onFocus={(event) => event.currentTarget.select()} className="min-w-0 flex-1 rounded-lg border border-hairline/60 bg-inset px-3 py-2 text-[12.5px] text-ink outline-none" />
            <button type="button" onClick={() => void copyText(url).then((result) => setCopied(result === "copied"))} className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-[12.5px] font-medium text-accent-ink hover:brightness-110"><Copy size={14} />{copied ? t("automations.feed.copied") : t("automations.feed.copy")}</button>
          </div>
        ) : url === null ? (
          <button type="button" disabled={busy} onClick={() => void run("POST")} className="mt-4 rounded-xl bg-accent px-4 py-2 text-[13px] font-medium text-accent-ink hover:brightness-110 disabled:opacity-40">{t("automations.feed.create")}</button>
        ) : null}
        {error && <p role="alert" className="mt-3 text-[12px] text-danger">{error}</p>}
        {url && <button type="button" disabled={busy} onClick={() => void run("POST")} className="mt-3 text-[12.5px] text-ink-secondary underline-offset-2 hover:text-ink hover:underline disabled:opacity-40">{t("automations.feed.change")}</button>}
        {url && <p className="mt-1 text-[11.5px] text-ink-tertiary">{t("automations.feed.changeHint")}</p>}
      </div>
    </div>
  );
}
