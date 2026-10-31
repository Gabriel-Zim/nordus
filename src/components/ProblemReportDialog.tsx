import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LifeBuoy } from "lucide-react";

import { api, openBotThread, useStore } from "@/state/store";
import { t } from "@/lib/i18n";
import { plainErrorLine } from "@/lib/plain-error";
import { useShowThreads } from "@/lib/thread-preferences";
import { useModalDialog } from "@/hooks/use-modal-dialog";
import { PROBLEM_REPORT_EXCERPT_CHOICES, type ProblemReportExcerpt, type ProblemReportPreview, type ProblemReportSent } from "../../shared/doctor";
import { GlassSegmented } from "./GlassSegmented";

const DEFAULT_EXCERPT: ProblemReportExcerpt = 0;
const fieldClass = "mt-1 w-full rounded-lg border border-hairline/50 bg-inset px-3 py-2 text-[13px] text-ink placeholder:text-ink-secondary focus:border-focus focus:outline-none";

type Phase = { kind: "editing" } | { kind: "previewing" } | { kind: "sending" } | { kind: "sent"; sent: ProblemReportSent };

function plainReason(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  return plainErrorLine(message) ?? message;
}

export function ProblemReportDialog({ threadId, onClose }: { threadId: string; onClose: () => void }) {
  const { state, dispatch } = useStore();
  const showThreads = useShowThreads();
  const [description, setDescription] = useState("");
  const [excerpt, setExcerpt] = useState<ProblemReportExcerpt>(DEFAULT_EXCERPT);
  const [preview, setPreview] = useState<ProblemReportPreview | null>(null);
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "editing" });
  const [error, setError] = useState<string | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const busy = phase.kind === "previewing" || phase.kind === "sending";
  const close = () => { if (!busy) onClose(); };
  useModalDialog(dialog, close);
  const base = `/api/threads/${encodeURIComponent(threadId)}/problem-report`;

  const invalidatePreview = () => { setPreview(null); setText(""); setError(null); };

  const buildPreview = async () => {
    setPhase({ kind: "previewing" });
    setError(null);
    try {
      const body = await api<ProblemReportPreview>(`${base}/preview`, { method: "POST", body: JSON.stringify({ excerpt, description: description.trim() }) });
      setPreview(body);
      setText(body.text);
    } catch (cause) {
      setError(plainReason(cause));
    } finally {
      setPhase((current) => current.kind === "previewing" ? { kind: "editing" } : current);
    }
  };

  const send = async () => {
    if (!text.trim()) return;
    setPhase({ kind: "sending" });
    setError(null);
    try {
      const sent = await api<ProblemReportSent>(base, { method: "POST", body: JSON.stringify({ text, description: description.trim() }) });
      setPhase({ kind: "sent", sent });
    } catch (cause) {
      setError(plainReason(cause));
      setPhase({ kind: "editing" });
    }
  };

  const sent = phase.kind === "sent" ? phase.sent : null;
  const sentBot = sent ? state.bots.find((bot) => bot.id === sent.target.botId) : undefined;
  const openSent = () => {
    if (!sent || !sentBot) return;
    openBotThread(dispatch, sentBot, sent.threadId, showThreads);
    onClose();
  };

  return createPortal(<div data-thread-overlay className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"
    onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
    <div ref={dialog} role="dialog" tabIndex={-1} aria-modal="true" aria-label={t("report.title")} aria-busy={busy || undefined} data-problem-report
      className="flex max-h-[calc(100dvh-2rem)] w-full max-w-[560px] flex-col overflow-y-auto rounded-2xl border border-hairline/50 bg-panel p-5 text-ink shadow-2xl">
      <h2 className="flex items-center gap-2 text-[15px] font-semibold"><LifeBuoy size={16} aria-hidden="true" />{t("report.title")}</h2>
      {sent ? (
        <>
          <p role="status" className="mt-4 text-[13.5px] leading-relaxed text-ink">{t("report.sent", { name: sent.target.name })}</p>
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-[13px] text-ink-secondary hover:bg-raised">{t("common.close")}</button>
            {sentBot && <button type="button" onClick={openSent} className="rounded-lg bg-accent px-3 py-2 text-[13px] font-medium text-white">{t("report.open")}</button>}
          </div>
        </>
      ) : (
        <>
          <label className="mt-4 block text-[12px] text-ink-secondary">{t("report.what")}
            <textarea value={description} disabled={busy} rows={3} autoFocus
              onChange={(event) => { setDescription(event.target.value); if (preview) invalidatePreview(); }}
              placeholder={t("report.whatPlaceholder")} className={fieldClass} data-report-description />
          </label>
          <div className="mt-4">
            <div className="text-[12px] text-ink-secondary">{t("report.excerpt")}</div>
            <div className="mt-1 flex items-center gap-2">
              <GlassSegmented<string>
                ariaLabel={t("report.excerpt.aria")}
                value={String(excerpt)}
                onChange={(value) => {
                  const next = PROBLEM_REPORT_EXCERPT_CHOICES.find((choice) => String(choice) === value) ?? DEFAULT_EXCERPT;
                  if (next === excerpt) return;
                  setExcerpt(next);
                  if (preview) invalidatePreview();
                }}
                options={PROBLEM_REPORT_EXCERPT_CHOICES.map((choice) => ({
                  value: String(choice),
                  label: choice === 0 ? t("report.excerpt.none") : String(choice),
                  disabled: busy,
                }))}
              />
              {excerpt > 0 && <span className="text-[12.5px] text-ink-secondary">{t("report.excerpt.unit")}</span>}
            </div>
          </div>
          {preview && (
            <div className="mt-4">
              <label className="block text-[12px] text-ink-secondary">{t("report.package")}
                <textarea value={text} disabled={busy} rows={10} spellCheck={false}
                  onChange={(event) => setText(event.target.value)}
                  className={`${fieldClass} font-mono text-[12px] leading-relaxed`} data-report-text />
              </label>
              <p className="mt-2 text-[12px] leading-relaxed text-ink-secondary">{t("report.secretsNote")}</p>
              <p className="mt-2 text-[13px] text-ink" data-report-target>{t("report.target", { name: preview.target.name })}</p>
              {preview.target.fallback && <p className="mt-1 text-[12px] leading-relaxed text-ink-secondary">{t("report.fallback")}</p>}
            </div>
          )}
          {error && <p role="alert" className="mt-3 text-[12.5px] text-danger">{t("report.error", { reason: error })}</p>}
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" disabled={busy} onClick={close} className="rounded-lg px-3 py-2 text-[13px] text-ink-secondary hover:bg-raised disabled:opacity-40">{t("common.cancel")}</button>
            {preview ? (
              <button type="button" disabled={busy || !text.trim()} onClick={() => void send()} className="rounded-lg bg-accent px-3 py-2 text-[13px] font-medium text-white disabled:opacity-40" data-report-send>
                {phase.kind === "sending" ? t("report.sending") : t("report.send", { name: preview.target.name })}
              </button>
            ) : (
              <button type="button" disabled={busy} onClick={() => void buildPreview()} className="rounded-lg bg-accent px-3 py-2 text-[13px] font-medium text-white disabled:opacity-40" data-report-preview>
                {phase.kind === "previewing" ? t("report.previewing") : t("report.preview")}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  </div>, document.body);
}
