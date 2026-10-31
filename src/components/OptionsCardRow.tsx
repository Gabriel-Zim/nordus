import type { ReactNode } from "react";
import { cardFocusTarget } from "@/lib/card-focus";
import type { Message } from "@/state/store";
import { ApprovalCard, isWithdrawnToolApproval } from "./ApprovalCard";
import type { ApprovalBot } from "./ApprovalTimelineCard";
import { MessageBoundary } from "./MessageBoundary";
import { OptionCard, shouldHideOnboardingCard } from "./OptionCard";
import { QuestionCard } from "./QuestionCard";

/**
 * Called, not mounted: a quiz that dropped out must come back as null so the transcript draws no row and no day
 * separator.
 */
export function optionsCardRow({ message: m, transcript, botId, botName, bot, threadId, onCancelTurn }: {
  message: Message;
  transcript: Message[];
  botId: string;
  botName: string;
  bot?: ApprovalBot;
  threadId: string;
  onCancelTurn?: () => void;
}): ReactNode {
  if (isWithdrawnToolApproval(m)) return null;
  // Asked in words: the bot's question and the person's answer are the conversation.
  if (m.card?.byText) return null;
  const card = m.card?.requestId && m.card.questionRequest ? (
    <QuestionCard threadId={threadId} bot={{ name: botName }} message={m} />
  ) : m.card?.requestId && m.card.tool ? (
    <ApprovalCard bot={bot ?? { name: botName }} message={m} threadId={threadId} onCancelTurn={onCancelTurn} />
  ) : shouldHideOnboardingCard(m, transcript) ? null : (
    <OptionCard botId={botId} threadId={threadId} message={m} />
  );
  if (!card) return null;
  const shown = (
    <MessageBoundary fallbackText={m.card?.subtitle || m.card?.title || ""}>
      {card}
    </MessageBoundary>
  );
  return m.card?.requestId ? (
    <div className="rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-accent/40" {...cardFocusTarget(m.card.requestId)}>{shown}</div>
  ) : shown;
}
