import { useState } from "react";
import { AudioLines, ThumbsDown, ThumbsUp } from "lucide-react";
import { cn } from "@/lib/cn";

import { formatCallDuration } from "../../shared/live-call";
import { callRecordIsPartial } from "@/lib/call-record";
import { t } from "@/lib/i18n";
import type { Message } from "@/state/store";
import { CallSheet } from "./CallSheet";

function readRating(callId: string | undefined): "up" | "down" | null {
  if (!callId) return null;
  try {
    const value = localStorage.getItem(`nordus-call-rating:${callId}`);
    return value === "up" || value === "down" ? value : null;
  } catch {
    return null;
  }
}

export function CallRecordRow({ message, transcript, botName, threadId, busy, hasMore }: {
  message: Message;
  transcript: readonly Message[];
  botName: string;
  threadId?: string;
  busy: boolean;
  hasMore: boolean;
}) {
  const [open, setOpen] = useState(false);
  const call = message.call;
  const callId = call?.callId;
  const [rating, setRating] = useState<"up" | "down" | null>(() => readRating(callId));
  const rate = (vote: "up" | "down") => {
    const next = rating === vote ? null : vote;
    setRating(next);
    try {
      if (next) localStorage.setItem(`nordus-call-rating:${callId}`, next);
      else localStorage.removeItem(`nordus-call-rating:${callId}`);
    } catch {
    }
  };
  if (!call) return null;
  const title = call.title?.trim() || t("chat.callRecord.title", { name: botName });
  const duration = formatCallDuration(call.seconds);
  const partial = callRecordIsPartial(transcript, call, hasMore);
  // A labelled group, not a <section>: a named section is a landmark, and every call would add one.
  // The title line is the button a keyboard reaches, since a list cannot sit inside a button.
  return (
    <>
      <div
        role="group"
        data-testid="call-record"
        aria-label={t("chat.callRecord.label", { title, duration })}
        title={new Date(call.endedAt).toLocaleString()}
        className="flex w-fit max-w-full items-center gap-1 text-[12.5px] text-ink-tertiary"
      >
        <button
          type="button"
          aria-haspopup="dialog"
          aria-label={t("chat.callRecord.open", { title })}
          onClick={() => setOpen(true)}
          className="flex max-w-full items-center gap-2 rounded-[8px] px-1.5 py-0.5 hover:bg-white/[0.04] hover:text-ink-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <AudioLines size={13} aria-hidden="true" className="shrink-0" />
          <span className="shrink-0">{t("chat.callRecord.line")}</span>
          <span className="shrink-0 font-mono text-[11.5px] tabular-nums">{`· ${duration}`}</span>
        </button>
        {(["up", "down"] as const).map((vote) => (
          <button
            key={vote}
            type="button"
            aria-pressed={rating === vote}
            aria-label={t(vote === "up" ? "chat.callRecord.liked" : "chat.callRecord.disliked")}
            title={t(vote === "up" ? "chat.callRecord.liked" : "chat.callRecord.disliked")}
            onClick={() => rate(vote)}
            className={cn("flex size-6 items-center justify-center rounded-full hover:bg-white/[0.06] hover:text-ink-secondary", rating === vote && "text-ink-secondary")}
          >
            {vote === "up" ? <ThumbsUp size={12} aria-hidden="true" /> : <ThumbsDown size={12} aria-hidden="true" />}
          </button>
        ))}
        {partial && <span className="sr-only">{t("chat.callRecord.partial")}</span>}
      </div>
      {open && (
        <CallSheet
          message={message}
          transcript={transcript}
          botName={botName}
          threadId={threadId}
          busy={busy}
          partial={partial}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
