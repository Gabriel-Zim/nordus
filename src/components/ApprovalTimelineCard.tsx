import { useState } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import { BotAvatar } from "@/components/Avatar";
import { SkillRequestPreview } from "@/components/SkillRequestPreview";
import { outboundSummary } from "@/lib/approval-summary";
import { appSettingLine, appSettingWarning } from "@/lib/app-setting-cards";
import { itemFor, useApprovalsFeed } from "@/lib/approvals-feed";
import { cn } from "@/lib/cn";
import { t, tFromServer } from "@/lib/i18n";
import type { Bot, Message, OptionCardData } from "@/state/store";
import { ADMINS_LABEL, approvalCopy, approvalRisk } from "../../shared/approvals";
import { soulDiffLines } from "../../shared/line-diff";
import { PROFILE_REQUEST_FIELDS, profileItems, type ProfileChangeItem, type ProfileRequestField } from "../../shared/profile-request";
import { ApprovalFacts, ApprovalPill, otherDecider, useViewer, type ApprovalViewer } from "./ApprovalCardParts";
import {
  APPROVAL_CONTROL,
  approvalNaturalText,
  isDurable,
  isProfileApproval,
  isRoutineApproval,
  isSkillApproval,
  PendingApprovalActions,
  PendingDeclineForm,
  PROFILE_FIELD_LABEL,
  toPending,
  type Pending,
} from "./PendingApproval";

/** Where a permission card stands, computed once from the card. */
export type ApprovalView =
  | { kind: "pending" }
  | { kind: "settled"; allowed: boolean }
  | { kind: "expired" };

export function approvalView(card: Pick<OptionCardData, "answered" | "expired" | "dismissed">): ApprovalView {
  // A card closed without the person's answer ("unavailable", or dismissed with the turn) was never decided.
  if (card.expired === true || card.dismissed === true) return { kind: "expired" };
  if (card.answered === "allow" || card.answered === "deny") return { kind: "settled", allowed: card.answered === "allow" };
  return card.answered ? { kind: "expired" } : { kind: "pending" };
}

/** A request still waiting on the person: its card names the asking bot itself. */
export function isPendingToolApproval(message: Pick<Message, "kind" | "card">): boolean {
  const card = message.card;
  return message.kind === "options" && Boolean(card?.requestId && card.tool && !card.questionRequest) && approvalView(card!).kind === "pending";
}

/** The bot as far as the caller knows it: always a name, the rest when the bot is on hand. */
export type ApprovalBot = Pick<Bot, "name"> & Partial<Bot>;

function pendingRegionLabel(pending: Pending): string {
  if (isSkillApproval(pending)) return t("approval.aria.pendingSkill");
  if (isRoutineApproval(pending)) return t("approval.aria.pendingRoutine");
  if (isProfileApproval(pending)) return t("approval.aria.pendingProfile");
  return t("approval.aria.pending");
}

function detailsLabel(pending: Pending): string {
  if (isSkillApproval(pending)) return t("approval.aria.reviewSkill");
  if (isRoutineApproval(pending)) return t("approval.aria.reviewRoutine");
  if (isProfileApproval(pending)) return t("approval.aria.reviewProfile");
  return t("approval.aria.reviewDetails");
}

const changedFields = (item: ProfileChangeItem) => PROFILE_REQUEST_FIELDS.filter((field) => item.changes[field] !== undefined);

function fieldValue(item: ProfileChangeItem, field: Exclude<ProfileRequestField, "soul">, value: string | boolean | undefined): string {
  if (field === "notifications" || field === "speakReplies") return t(value ? "mcp.state.on" : "mcp.state.off");
  if (field === "cwd" && !value) return t("computer.files.privateFolder", { name: item.targetName });
  return String(value ?? "");
}

/** One item's change as the person reviews it: every field before and after, and the whole SOUL.md diff. */
function itemChangeLines(item: ProfileChangeItem): string[] {
  return changedFields(item).flatMap((field) => field === "soul"
    ? soulDiffLines(item.before.soul ?? "", item.changes.soul ?? "")
    : [`${t(PROFILE_FIELD_LABEL[field])}: ${fieldValue(item, field, item.before[field])} → ${fieldValue(item, field, item.changes[field])}`]);
}

function ProfileBatchTargets({ items }: { items: ProfileChangeItem[] }) {
  return (
    <ul className="mt-2 space-y-0.5 text-[13px] text-ink-secondary">
      {items.map((item) => (
        <li key={item.itemId} className="break-words">
          @{item.targetName} · {changedFields(item).map((field) => t(PROFILE_FIELD_LABEL[field])).join(", ")}
        </li>
      ))}
    </ul>
  );
}

function ProfileBatchDetails({ items }: { items: ProfileChangeItem[] }) {
  return (
    <>
      {items.map((item) => (
        <div key={item.itemId}>
          <div className="text-[12.5px] font-medium text-ink-secondary">@{item.targetName}</div>
          <pre
            tabIndex={0}
            aria-label={t("approval.aria.reviewProfile")}
            className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-inset px-4 py-3 font-mono text-[12px] leading-relaxed text-ink"
          >
            {[item.reason, ...itemChangeLines(item)].join("\n")}
          </pre>
        </div>
      ))}
    </>
  );
}

function PendingCard({
  message,
  card,
  pending,
  bot,
  name,
  threadId,
  onCancelTurn,
}: {
  message: Message;
  card: OptionCardData;
  pending: Pending;
  bot?: ApprovalBot;
  name: string;
  threadId?: string;
  onCancelTurn?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState(false);
  const { items } = useApprovalsFeed();
  const viewer = useViewer().name;
  const item = itemFor(items, threadId, message.id);
  const plain = !isDurable(pending);
  const decider = item?.decider ?? ADMINS_LABEL;
  const facts = plain ? (item?.fields ?? approvalCopy(message, name, decider).fields).filter((field) => field.code !== "detail" && field.code !== "why") : [];
  const outbound = outboundSummary(card);
  const heldNote = outbound?.opaque && pending.heldCode === "approval.held.outbound"
    ? t("approval.opaqueCode")
    : tFromServer(pending.heldCode, pending.held);
  const avatarBot = { ...bot, name, color: bot?.color ?? (message.from?.color ?? "blue") as Bot["color"] };
  const detailsId = `approval-details-${pending.requestId}`;
  const actionBot = bot?.id ? { id: bot.id, name: bot.name } : undefined;
  const batch = card.profileRequest && profileItems(card.profileRequest).length > 1 ? profileItems(card.profileRequest) : undefined;
  return (
    <div
      role="region"
      aria-label={pendingRegionLabel(pending)}
      data-tour="approval"
      data-approval-row="pending"
      className="w-full max-w-[min(var(--chat-bubble-max),var(--chat-bubble-pct))] rounded-2xl border border-hairline/25 bg-raised/40 px-3.5 py-2.5 text-ink"
    >
      <div className="flex min-w-0 items-center gap-2">
        <BotAvatar bot={avatarBot} size={18} motion="none" motionKey={0} animated={false} />
        <span className="min-w-0 truncate text-[12px] text-ink-secondary">{t("approval.card.asksApproval", { name })}</span>
        <span className="ml-auto">
          <ApprovalPill you={item ? item.canDecide : true} decider={decider} deadline={card.approval?.expiresAt ?? item?.expiresAt} critical={plain && approvalRisk(card) === "critical"} />
        </span>
      </div>
      <p className="mt-1.5 whitespace-pre-wrap break-words text-[14px] leading-relaxed" aria-live="polite">{approvalNaturalText(pending)}</p>
      {card.approval?.fromRefusal && <p className="mt-1 text-[12px] text-ink-tertiary">{t("approvals.lesson.fromRefusal")}</p>}
      {facts.length > 0 && <ApprovalFacts fields={facts} className="mt-2" />}
      {batch && <ProfileBatchTargets items={batch} />}
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {threadId && (asking
          ? <PendingDeclineForm pending={pending} threadId={threadId} bot={actionBot} onClose={() => setAsking(false)} />
          : <PendingApprovalActions part="primary" quiet onAskWhy={plain ? () => setAsking(true) : undefined} pending={pending} threadId={threadId} bot={actionBot} />)}
        <button
          type="button"
          aria-expanded={open}
          aria-controls={detailsId}
          onClick={() => setOpen((value) => !value)}
          className={cn(APPROVAL_CONTROL, "ml-auto gap-1 px-2 text-ink-tertiary hover:bg-ink/10 hover:text-ink")}
        >
          {open ? t("approval.card.hideDetails") : t("approval.card.showDetails")}
          <ChevronDown size={14} aria-hidden="true" className={cn("transition-transform", open && "rotate-180")} />
        </button>
      </div>
      <div id={detailsId} hidden={!open} data-approval-details="" className="mt-3 space-y-2">
        {batch ? <ProfileBatchDetails items={batch} /> : (
          <pre
            tabIndex={0}
            data-approval-command=""
            aria-label={detailsLabel(pending)}
            className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-inset px-3.5 py-2.5 font-mono text-[12px] leading-relaxed text-ink"
          >
            {card.appSettingRequest
              ? [appSettingLine(card.appSettingRequest), appSettingWarning(card.appSettingRequest)].filter(Boolean).join("\n\n")
              : card.mcpServerRequest
                ? t("approval.card.connectAppDetail", { name: card.mcpServerRequest.serverName })
                : pending.commandAllowlist?.command ?? pending.detail}
          </pre>
        )}
        {card.skillRequest && <SkillRequestPreview request={card.skillRequest} />}
        {heldNote && <div className="text-[12px] text-warning">{heldNote}</div>}
        {threadId && <PendingApprovalActions part="more" pending={pending} threadId={threadId} bot={actionBot} onCancelTurn={onCancelTurn} />}
      </div>
      {plain && viewer && (item ? item.canDecide : true) && <p className="mt-2 text-[11.5px] text-ink-tertiary">{t("approvals.youAre", { name: viewer })}</p>}
    </div>
  );
}

function settledLabel(card: OptionCardData, allowed: boolean, viewer: ApprovalViewer): string {
  if (card.releasedTask) return t("approval.record.releasedTask");
  if (card.approval?.lapsed) return t("approvals.record.lapsed");
  const by = otherDecider(card.answeredBy, viewer);
  if (!allowed && card.approval?.declinedWhy) return by ? t("approvals.record.declinedLessonBy", { name: by }) : t("approvals.record.declinedLesson");
  if (!by) return t(allowed ? "approval.record.allowed" : "approval.record.denied");
  return allowed ? t("approvals.record.approvedBy", { name: by }) : t("approvals.record.declinedBy", { name: by });
}

function SettledRecord({ card, allowed, line, plain }: { card: OptionCardData; allowed: boolean; line: string; plain: boolean }) {
  const viewer = useViewer();
  return (
    <div data-approval-row="settled" className="w-full max-w-[840px] text-[12.5px] text-ink-tertiary">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 leading-5">
        {allowed
          ? <Check size={14} className="shrink-0 self-center text-success" aria-hidden="true" />
          : <X size={14} className="shrink-0 self-center" aria-hidden="true" />}
        <span>{plain ? settledLabel(card, allowed, viewer) : t(card.releasedTask ? "approval.record.releasedTask" : allowed ? "approval.record.allowed" : "approval.record.denied")}</span>
        <span className="min-w-0 break-words">· {line.replace(/[?？]\s+/g, ": ")}</span>
        {card.answeredBy?.via && <span>· {t(card.answeredBy.via === "call" ? "approval.status.byVoice" : "approval.status.byReaction")}</span>}
      </div>
    </div>
  );
}

/**
 * A permission request as a bot's bubble in the conversation: the bot asks in its own words, the person answers
 * right there, and once answered it stays as one small line. The raw command lives behind "Ver detalhes".
 */
export function ApprovalTimelineCard({
  message,
  view,
  bot,
  threadId,
  onCancelTurn,
  settledLine,
}: {
  message: Message;
  view: Exclude<ApprovalView, { kind: "expired" }>;
  bot?: ApprovalBot;
  threadId?: string;
  onCancelTurn?: () => void;
  /** What a settled proposal says happened ("Rotina agendada"), when the plain request line would read wrong. */
  settledLine?: string;
}) {
  const card = message.card;
  const pending = toPending(message);
  if (!card || !pending) return null;
  const line = view.kind === "settled" && settledLine ? settledLine : approvalNaturalText(pending);
  if (view.kind === "settled") return <SettledRecord card={card} allowed={view.allowed} line={line} plain={!isDurable(pending)} />;
  const name = bot?.name ?? message.from?.name ?? t("approval.someone");
  return <PendingCard message={message} card={card} pending={pending} bot={bot} name={name} threadId={threadId} onCancelTurn={onCancelTurn} />;
}
