import { Check, CloudOff, LoaderCircle, LogIn, Mic, RotateCw, TriangleAlert, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { replySnippet } from "@/lib/replies";
import { sendOutbox } from "@/lib/app-outbox";
import { signedOutWatch } from "@/lib/signed-out";
import { useOutboxEntries, useOutboxEntry, useOutboxOnline, type OutboxEntry } from "@/lib/send-outbox";

function clock(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function outboxStatusLabel(entry: OutboxEntry, online: boolean): string {
  switch (entry.status) {
    case "delivered":
      return t("composer.outbox.delivered");
    case "sending":
      return entry.voice && entry.requestText === undefined ? t("composer.outbox.sendingVoice") : t("composer.outbox.sending");
    case "queued":
      if (entry.signInExpired || entry.signedOut) return t("chat.recovery.accessExpired");
      return online ? t("composer.outbox.queued") : t("composer.outbox.offline");
    case "failed":
      if (entry.expired) return t("composer.outbox.expired");
      if (entry.error === "recording-missing") return t("composer.outbox.recordingMissing");
      if (canSendAsNew(entry)) return t("composer.outbox.conflict");
      return t("composer.outbox.failed");
  }
}

const canSendAsNew = (entry: OutboxEntry) => entry.errorStatus === 409 && entry.requestText !== undefined;

/** What the server said, kept out of the sentence but one tap away. */
const failureDetail = (entry: OutboxEntry) =>
  entry.status === "failed" && entry.error && !entry.expired && entry.error !== "recording-missing" ? entry.error : null;

/**
 * Sends still on this device. A message already shown in the conversation (optimistic or delivered) is left to the
 * transcript, so each send appears once.
 */
export function ComposerOutbox({ draftId, messages }: { draftId: string; messages: ReadonlyArray<{ sendId?: string }> }) {
  const online = useOutboxOnline(sendOutbox);
  const shown = new Set(messages.map((message) => message.sendId).filter(Boolean));
  const entries = useOutboxEntries(sendOutbox, draftId).filter((entry) => !shown.has(entry.sendId));
  if (!entries.length) return null;
  return (
    <ul className="mb-2 flex flex-col items-end gap-1.5" aria-label={t("composer.outbox.list")} aria-live="polite">
      {entries.map((entry) => {
        const failed = entry.status === "failed";
        const label = entry.voice
          ? t("composer.outbox.voice", { duration: clock(entry.voice.durationMs) })
          : replySnippet(entry.text || entry.requestText || "", 140);
        return (
          <li
            key={entry.sendId}
            data-outbox-status={entry.status}
            className={cn(
              "flex max-w-[85%] min-w-0 flex-col gap-1 rounded-2xl px-3 py-2 text-[14px]",
              failed ? "border border-danger/30 bg-danger/10 text-ink" : "bg-raised text-ink",
            )}
          >
            <span dir="auto" className="flex min-w-0 items-center gap-1.5">
              {entry.voice && <Mic size={14} className="shrink-0 text-ink-secondary" aria-hidden="true" />}
              <span className="min-w-0 truncate">{label}</span>
            </span>
            <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-ink-secondary">
              <StatusIcon entry={entry} online={online} />
              <span className={cn("min-w-0 flex-1 truncate", failed && "text-danger")} role="status">
                {outboxStatusLabel(entry, online)}
              </span>
              {entry.status === "queued" && (entry.signInExpired || entry.signedOut) && (
                <button
                  type="button"
                  onClick={() => entry.signedOut ? signedOutWatch.show() : window.location.reload()}
                  className="flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 font-medium text-ink hover:bg-raised-hover"
                >
                  {t("chat.recovery.signInAgain")}
                </button>
              )}
              {failed && canSendAsNew(entry) && (
                <button
                  type="button"
                  onClick={() => sendOutbox.resendAsNew(entry.sendId, crypto.randomUUID())}
                  className="flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 font-medium text-ink hover:bg-raised-hover"
                >
                  <RotateCw size={12} aria-hidden="true" />
                  {t("composer.outbox.sendAsNew")}
                </button>
              )}
              {failed && !canSendAsNew(entry) && (
                <button
                  type="button"
                  onClick={() => sendOutbox.retry(entry.sendId)}
                  className="flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 font-medium text-ink hover:bg-raised-hover"
                >
                  <RotateCw size={12} aria-hidden="true" />
                  {entry.voice ? t("composer.outbox.resend") : t("composer.outbox.retry")}
                </button>
              )}
              {entry.status !== "sending" && entry.status !== "delivered" && (
                <button
                  type="button"
                  onClick={() => sendOutbox.cancel(entry.sendId)}
                  aria-label={t("composer.outbox.cancelAria")}
                  title={t("composer.outbox.cancel")}
                  className="flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 font-medium text-ink-secondary hover:bg-raised-hover hover:text-ink"
                >
                  <X size={12} strokeWidth={2.5} aria-hidden="true" />
                  {t("composer.outbox.cancel")}
                </button>
              )}
            </span>
            {failureDetail(entry) && (
              <details className="text-[12px] text-ink-secondary">
                <summary className="cursor-pointer">{t("chat.error.details")}</summary>
                <p dir="auto" className="mt-1 break-words">{failureDetail(entry)}</p>
              </details>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function StatusIcon({ entry, online }: { entry: OutboxEntry; online: boolean }) {
  if (entry.status === "delivered") return <Check size={12} className="shrink-0" aria-hidden="true" />;
  if (entry.status === "failed") return <TriangleAlert size={12} className="shrink-0 text-danger" aria-hidden="true" />;
  if (entry.status === "queued" && !online) return <CloudOff size={12} className="shrink-0" aria-hidden="true" />;
  if (entry.status === "queued" && entry.signedOut) return <LogIn size={12} className="shrink-0" aria-hidden="true" />;
  return <LoaderCircle size={12} className="shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />;
}

export function OutboxBubbleStatus({ sendId }: { sendId: string }) {
  const online = useOutboxOnline(sendOutbox);
  const entry = useOutboxEntry(sendOutbox, sendId);
  if (!entry || (entry.status !== "sending" && entry.status !== "delivered")) return null;
  return (
    <span data-outbox-bubble={entry.status} role="status" className="mt-1 flex items-center gap-1 pr-1 text-[11.5px] text-ink-tertiary">
      <StatusIcon entry={entry} online={online} />
      {outboxStatusLabel(entry, online)}
    </span>
  );
}
