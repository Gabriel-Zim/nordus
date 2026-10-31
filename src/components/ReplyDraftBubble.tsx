import type { Message } from "@/state/store";
import { useStreamingContent } from "@/hooks/use-streaming-content";
import { t } from "@/lib/i18n";
import { useReplyDraft } from "@/state/streaming-drafts";
import { ChatMarkdown } from "./ChatMarkdown";

/** The reply the bot is writing, until the saved message with the same id takes its place. */
export function ReplyDraftBubble({ threadId, messages }: { threadId: string | undefined; messages: readonly Message[] }) {
  const draft = useReplyDraft(threadId);
  const saved = draft !== null && messages.some((message) => message.streamId === draft.streamId);
  const shown = useStreamingContent(draft?.text ?? "", draft !== null && !saved);
  if (!draft || saved || !shown.trim()) return null;
  return (
    <div className="flex justify-start" data-reply-draft={draft.streamId}>
      <div
        data-chat-bubble
        aria-busy="true"
        aria-label={t("chat.replyWriting")}
        className="w-fit max-w-[min(var(--chat-bubble-max),var(--chat-bubble-pct))] rounded-2xl bg-card px-4 py-2.5 text-[15px] leading-relaxed text-ink"
      >
        <ChatMarkdown text={shown} />
      </div>
    </div>
  );
}

/** A reply the person stopped: it reads as cut short, never as the bot's finished answer. */
export function InterruptedNote() {
  return <p className="mt-1.5 text-[12px] text-ink-tertiary" data-testid="reply-interrupted">{t("chat.replyInterrupted")}</p>;
}
