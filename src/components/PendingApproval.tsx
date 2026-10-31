import { useId, useState } from "react";
import { api } from "@/state/api";
import { useStore, type Bot, type Message } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { lessonLine, outboundFacts, outboundSummary } from "@/lib/approval-summary";
import { plainToolAction, toolLabel } from "@/lib/human-tool";
import { reviewedSkillSha256 } from "../../shared/skill-request";
import { appSettingLine } from "@/lib/app-setting-cards";
import { profileItems, reviewedProfileKey, type ProfileChangeItem, type ProfileRequestCardData, type ProfileRequestField } from "../../shared/profile-request";
import { useOwnerOrAdmin } from "@/lib/use-owner-or-admin";
import { APPROVALS_PATH, approvalId, approvalRisk, DECLINE_REASON_MAX } from "../../shared/approvals";
import { ApprovalHoldButton } from "./ApprovalHoldButton";

export interface Pending {
  message: Message;
  requestId: string;
  tool: string;
  allowKey?: string;
  allowSession?: boolean;
  commandAllowlist?: { command: string; cwd: string; providerInstanceId: string };
  canReleaseTask?: true;
  detail: string;
  held?: string;
  heldCode?: string;
}

/** Security: the persisted payload is the marker; provider-authored tool names can collide with ours. */
export function isRoutineApproval(pending: Pending): boolean {
  return Boolean(pending.message.card?.routineRequest);
}

export function isSkillApproval(pending: Pending): boolean {
  return Boolean(pending.message.card?.skillRequest);
}

export function isProfileApproval(pending: Pending): boolean {
  return Boolean(pending.message.card?.profileRequest);
}

export const PROFILE_FIELD_LABEL: Record<ProfileRequestField, LocaleKey> = {
  name: "approval.applied.field.name",
  title: "approval.applied.field.title",
  description: "approval.applied.field.description",
  soul: "approval.applied.field.soul",
  cwd: "approval.applied.field.cwd",
  notifications: "approval.applied.field.notifications",
  speakReplies: "approval.applied.field.speakReplies",
};

const changesSoul = (item: ProfileChangeItem) => item.changes.soul !== undefined;

/** A card that would change standing instructions is answered with Approve and Refuse. */
export function asksForSoul(profile: ProfileRequestCardData): boolean {
  return profileItems(profile).some(changesSoul);
}

/** A permission card as the data the approval controls work from, whether or not it is still waiting. */
export function toPending(m: Message): Pending | undefined {
  const card = m.card;
  if (m.kind !== "options" || !card?.requestId || !card.tool) return undefined;
  return {
    message: m,
    requestId: card.requestId,
    tool: card.tool,
    allowKey: card.allowKey,
    allowSession: card.allowSession,
    commandAllowlist: card.commandAllowlist,
    canReleaseTask: card.canReleaseTask,
    detail: card.subtitle,
    held: card.held,
    heldCode: card.heldCode,
  };
}

export function pendingApprovals(messages: Message[]): Pending[] {
  return messages.flatMap((m) => {
    const pending = toPending(m);
    return pending && !m.card?.answered && !m.card?.dismissed && !m.card?.expired && !m.card?.byText ? [pending] : [];
  });
}

function sentence(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return "";
  const capital = flat.charAt(0).toUpperCase() + flat.slice(1);
  return /[.!?]$/.test(capital) ? capital : `${capital}.`;
}

const bare = (text: string) => text.replace(/[.!]+$/, "").trim().toLowerCase();

/**
 * What the bot wants and why, in its own words, for anywhere a person is asked to answer: the engine's explanation,
 * else "Quero {intent}.", else the plain line for a proposal or an outbound send. Never a command, a path or a tool name.
 */
export function approvalNaturalText(pending: Pending): string {
  const card = pending.message.card;
  if (!card) return "";
  if (card.lessonRequest) return lessonLine(card);
  const outbound = outboundSummary(card);
  if (outbound) {
    const { target, amount } = outboundFacts(card);
    const action = [outbound.summary, target, amount].filter(Boolean).join(" · ");
    return [outbound.headline, action].filter(Boolean).join(" ");
  }
  const profile = card.profileRequest;
  if (profile) {
    const items = profileItems(profile);
    const soul = items.every(changesSoul);
    if (items.length > 1) return t(soul ? "approval.card.wantsSoulBatch" : "approval.card.wantsProfileBatch", { count: items.length });
    const item = items[0]!;
    if (item.targetBotId === profile.botId) return t(soul ? "approval.card.wantsSoulOwn" : "approval.card.wantsProfileOwn");
    return t(soul ? "approval.card.wantsSoulOther" : "approval.card.wantsProfileOther", { target: item.targetName });
  }
  if (isDurable(pending)) return approvalLabel(pending);
  const intent = card.intent?.trim();
  const explanation = card.explanation?.trim();
  // An engine that only restated the title adds nothing to it.
  if (explanation && !(intent && bare(explanation) === bare(intent))) return sentence(explanation);
  return t("approval.card.wants", { action: intent || plainToolAction(card.tool) });
}

export function spokenApprovalPrompt(pending: Pending, requester: string): string {
  if (pending.message.card?.teamSetupRequest) return t("approval.voice.teamSetup", { requester, title: pending.message.card.title, allow: pending.message.card.options[0] ?? t("approval.action.confirm"), deny: pending.message.card.options[1] ?? t("approval.action.cancel") });
  const isRoutineRequest = isRoutineApproval(pending);
  const isSkillRequest = isSkillApproval(pending);
  const isProfileRequest = isProfileApproval(pending);
  if (isSkillRequest) {
    const updating = pending.message.card?.skillRequest?.action === "update";
    const title = pending.message.card?.title.trim() || t(
      updating ? "approval.voice.defaultUpdateSkill" : "approval.voice.defaultEnableSkill",
    );
    return t("approval.voice.skill", {
      requester,
      title: `${title}${/[.!?]$/.test(title) ? "" : "."}`,
      action: t(updating ? "approval.voice.actionUpdate" : "approval.voice.actionEnable"),
    });
  }
  const profile = pending.message.card?.profileRequest;
  if (profile && profileItems(profile).length > 1) {
    return t("approval.voice.profileBatch", { requester, count: profileItems(profile).length });
  }
  if (isProfileRequest) {
    const title = pending.message.card?.title.trim() || t("approval.voice.defaultUpdateProfile");
    return t("approval.voice.profile", { requester, title });
  }
  if (!isRoutineRequest) {
    const intent = pending.message.card?.intent;
    return t("approval.voice.command", { requester, tool: intent || toolLabel(pending.tool), detail: pending.detail });
  }
  const title = pending.message.card?.title.trim() || t("approval.voice.defaultConfirmRoutine");
  return t("approval.voice.routine", {
    requester,
    title: `${title}${/[.!?]$/.test(title) ? "" : "."}`,
  });
}

export function approvalLabel(pending: Pending): string {
  if (pending.message.card?.lessonRequest) return t("lesson.pending");
  if (pending.message.card?.appSettingRequest) return appSettingLine(pending.message.card.appSettingRequest);
  if (pending.message.card?.mcpServerRequest) {
    return t("approval.label.connectApp", { name: pending.message.card.mcpServerRequest.serverName });
  }
  if (pending.message.card?.teamSetupRequest) return pending.message.card.title;
  if (isSkillApproval(pending)) {
    return pending.message.card?.skillRequest?.action === "update"
      ? t("approval.label.updateSkill")
      : t("approval.label.enableSkill");
  }
  if (isProfileApproval(pending)) {
    return t("approval.label.confirmProfileChange");
  }
  if (isRoutineApproval(pending)) {
    return pending.message.card?.routineRequest?.operation.action === "create"
      ? t("approval.label.confirmRoutine")
      : t("approval.label.confirmRoutineChange");
  }
  const nice: Record<string, LocaleKey> = {
    Bash: "approval.label.commandRequested",
    shell: "approval.label.commandRequested",
    Read: "approval.label.fileReadRequested",
    Write: "approval.label.fileChangeRequested",
    Edit: "approval.label.fileChangeRequested",
    edit: "approval.label.fileChangeRequested",
  };
  const key = nice[pending.tool];
  return key ? t(key) : t("approval.label.requested");
}

/** The server's reason code for an action that always waits for the person: spending, settings, deleting for good, sending outside, going live. */
const SENSITIVE_HOLD = "approval.held.sensitive";

export const APPROVAL_CONTROL =
  "inline-flex h-7 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-[10px] px-3 text-[13px] font-medium leading-5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus";

export function isDurable(pending: Pending): boolean {
  const card = pending.message.card;
  return isSkillApproval(pending) || isRoutineApproval(pending) || isProfileApproval(pending) ||
    Boolean(card?.teamSetupRequest) || Boolean(card?.modelRequest) || Boolean(card?.lessonRequest) ||
    Boolean(card?.appSettingRequest) || Boolean(card?.mcpServerRequest);
}

/** One answer the person can give: what its button says, and what it does. */
export interface ApprovalChoice {
  label: string;
  /** What a screen reader says when the button's text is shorter than what it does. */
  name?: string;
  /** Longer words for a tooltip or screen reader, when the button's own are short. */
  hint?: string;
  run: () => void;
}

export interface ApprovalDecision {
  allowOnce: ApprovalChoice & { disabled: boolean };
  releaseTask?: ApprovalChoice;
  /** Undefined when not offered: never for a critical action, a proposal, or a card carrying no rule to keep. */
  alwaysAllow?: ApprovalChoice;
  deny: ApprovalChoice & { autoFocus: boolean };
  /** Declines with the person's own words, which go to the bot and, when given, become a lesson it can keep. */
  declineWith: (reason: string) => void;
  /** Approved only by holding the button down. */
  critical: boolean;
  /** Proposals (routines, skills, profiles, team setups, lessons) are answered once and never interrupt the turn. */
  durable: boolean;
}

/** The one place a pending approval is answered, for the card in the conversation and anywhere else that shows it. */
export function useApprovalDecision(pending: Pending, threadId: string, bot?: Pick<Bot, "id" | "name">): ApprovalDecision {
  const { dispatch } = useStore();
  const ownerOrAdmin = useOwnerOrAdmin();
  const card = pending.message.card;
  const isRoutineRequest = isRoutineApproval(pending);
  const isSkillRequest = isSkillApproval(pending);
  const isProfileRequest = isProfileApproval(pending);
  const isTeamSetup = Boolean(card?.teamSetupRequest);
  const isLesson = Boolean(card?.lessonRequest);
  const durable = isRoutineRequest || isSkillRequest || isProfileRequest || isTeamSetup || isLesson;
  const canRememberCommand = ownerOrAdmin === true && !durable && !pending.allowKey && Boolean(pending.commandAllowlist);
  const reviewedSha256 = card?.skillRequest ? reviewedSkillSha256(card.skillRequest)
    : card?.profileRequest ? reviewedProfileKey(card.profileRequest) : undefined;
  const asksSoul = Boolean(card?.profileRequest && asksForSoul(card.profileRequest));
  const decide = (behavior: "allow" | "deny", always = false, rememberCommand = false, releaseTask = false) =>
    dispatch({
      type: "decideRequest",
      threadId,
      requestId: pending.requestId,
      behavior,
      message: behavior === "deny" ? "Denied by the user." : undefined,
      reviewedSha256: behavior === "allow" ? reviewedSha256 : undefined,
      alwaysAllow: always && bot && pending.allowKey ? { botId: bot.id, key: pending.allowKey } : undefined,
      always: always && !pending.allowKey && pending.allowSession ? true : undefined,
      rememberCommand: rememberCommand || undefined,
      releaseTask: releaseTask || undefined,
    });
  const critical = !durable && approvalRisk(card) === "critical";
  const releaseTask: ApprovalChoice | undefined = ownerOrAdmin === true && pending.canReleaseTask && !durable && !critical
    ? { label: t("approval.action.allowTask"), name: t("approval.action.allowTask"), hint: t("approval.action.allowTaskHint"), run: () => decide("allow", false, false, true) }
    : undefined;

  // A critical action is decided every time: no "always" in any form, whatever the card carries.
  const alwaysAllow: ApprovalChoice | undefined = durable || pending.heldCode === SENSITIVE_HOLD ? undefined
    : bot && pending.allowKey
      ? { label: t("approval.action.alwaysAllow"), name: t("approval.action.alwaysAllow"), hint: t("approval.action.stopAsking", { name: bot.name, key: pending.allowKey }), run: () => decide("allow", true) }
      : canRememberCommand && pending.commandAllowlist
        ? { label: t("approval.action.alwaysAllow"), name: t("approval.action.alwaysAllowCommand"), hint: t("approval.action.alwaysAllowCommandHint", { cwd: pending.commandAllowlist.cwd }), run: () => decide("allow", false, true) }
        : !pending.allowKey && pending.allowSession
          ? { label: t("approval.action.alwaysAllow"), name: t("approval.action.alwaysAllowSession"), hint: t("approval.action.alwaysAllowSessionHint"), run: () => decide("allow", true) }
          : undefined;
  const isAppSetting = Boolean(card?.appSettingRequest);
  const isMcpServer = Boolean(card?.mcpServerRequest);
  const allowLabel = isMcpServer ? t("approval.action.connect") : isAppSetting
    ? card?.appSettingRequest?.requiresConfirmation ? t("approval.action.confirm") : t("approval.action.apply")
    : isLesson ? t("lesson.makeRule") : isTeamSetup ? card?.options[0] ?? t("approval.action.confirm") : isSkillRequest
    ? card?.skillRequest?.action === "update"
      ? t("approval.action.update")
      : t("approval.action.enable")
    : asksSoul
      ? t("approval.action.approve")
      : isRoutineRequest || isProfileRequest
        ? t("approval.action.confirm")
        : t("approval.action.allowOnce");
  const denyLabel = isAppSetting || isMcpServer ? t("approval.action.notNow") : isLesson ? t("lesson.discard") : asksSoul ? t("approval.action.refuse")
    : isRoutineRequest || isProfileRequest || isTeamSetup ? t("approval.action.cancel") : t("approval.action.deny");
  const declineWith = (reason: string) => {
    if (!reason) return decide("deny");
    api(`${APPROVALS_PATH}/${approvalId(threadId, pending.message.id)}/decline`, { method: "POST", body: JSON.stringify({ reason }) })
      .catch((error: unknown) => dispatch({ type: "error", message: error instanceof Error ? error.message : String(error) }));
  };
  return {
    allowOnce: { label: allowLabel, run: () => decide("allow"), disabled: isSkillRequest && !reviewedSha256 },
    releaseTask,
    alwaysAllow,
    deny: { label: denyLabel, run: () => decide("deny"), autoFocus: isTeamSetup },
    declineWith,
    critical,
    durable,
  };
}

export function DeclineForm({ onDecline, onCancel, submitLabel }: { onDecline: (reason: string) => void; onCancel: () => void; submitLabel?: string }) {
  const [reason, setReason] = useState("");
  const id = useId();
  return (
    <form
      data-approval-decline=""
      className="w-full basis-full space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        onDecline(reason.trim());
      }}
    >
      <label htmlFor={id} className="block text-[12.5px] font-medium text-ink-secondary">{t("approvals.decline.why")}</label>
      <textarea
        id={id}
        autoFocus
        rows={2}
        maxLength={DECLINE_REASON_MAX}
        value={reason}
        placeholder={t("approvals.decline.placeholder")}
        onChange={(event) => setReason(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onCancel();
          else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            onDecline(reason.trim());
          }
        }}
        className="w-full resize-none rounded-xl bg-inset px-3 py-2 text-[13px] leading-5 text-ink outline-none placeholder:text-ink-tertiary focus-visible:ring-2 focus-visible:ring-focus"
      />
      <p className="text-[12px] text-ink-tertiary">{t("approvals.decline.hint")}</p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" className={cn(APPROVAL_CONTROL, "bg-ink/[0.07] text-danger hover:bg-danger/15")}>{submitLabel ?? t("approvals.decline.send")}</button>
        <button type="button" onClick={onCancel} className={cn(APPROVAL_CONTROL, "bg-ink/[0.07] text-ink-secondary hover:bg-ink/[0.12] hover:text-ink")}>
          {t("approvals.decline.cancel")}
        </button>
      </div>
    </form>
  );
}

export function PendingDeclineForm({ pending, threadId, bot, onClose }: { pending: Pending; threadId: string; bot?: Pick<Bot, "id" | "name">; onClose: () => void }) {
  const { declineWith, deny } = useApprovalDecision(pending, threadId, bot);
  return <DeclineForm submitLabel={deny.label} onDecline={(reason) => { onClose(); declineWith(reason); }} onCancel={onClose} />;
}

export function PendingApprovalActions({
  pending,
  threadId,
  bot,
  onCancelTurn,
  part,
  quiet,
  onAskWhy,
}: {
  pending: Pending;
  threadId: string;
  bot?: Pick<Bot, "id" | "name">;
  onCancelTurn?: () => void;
  part?: "primary" | "more";
  /** The same answers in the quieter tone of the conversation's pills: only colour and weight change, never what a button does. */
  quiet?: boolean;
  /** Deny first asks for an optional reason, which the caller draws as a `PendingDeclineForm`. */
  onAskWhy?: () => void;
}) {
  const { allowOnce, releaseTask, alwaysAllow, deny, critical, durable } = useApprovalDecision(pending, threadId, bot);
  const more = part !== "primary" && !durable && onCancelTurn ? [
    <button key="cancel" type="button" onClick={onCancelTurn} className={cn(APPROVAL_CONTROL, "bg-ink/[0.07] text-ink-secondary hover:bg-ink/[0.12] hover:text-ink")}>
      {t("approval.action.cancelTurn")}
    </button>,
  ] : [];
  const primary = part !== "more" ? [
    critical
      ? <ApprovalHoldButton key="allow" onApprove={allowOnce.run} disabled={allowOnce.disabled} />
      : <button
        key="allow"
        type="button"
        onClick={allowOnce.run}
        disabled={allowOnce.disabled}
        className={cn(
          APPROVAL_CONTROL,
          quiet ? "bg-ink/[0.09] font-semibold text-ink hover:bg-ink/[0.15]" : "bg-accent text-white hover:bg-accent/90",
          "disabled:cursor-not-allowed disabled:opacity-40",
        )}
      >
        {allowOnce.label}
      </button>,
    releaseTask && (
      <button
        key="release"
        type="button"
        onClick={releaseTask.run}
        aria-label={releaseTask.name}
        title={releaseTask.hint}
        className={cn(APPROVAL_CONTROL, "bg-ink/[0.07] text-ink hover:bg-ink/[0.12]")}
      >
        {releaseTask.label}
      </button>
    ),
    alwaysAllow && (
      <button
        key="always"
        type="button"
        onClick={alwaysAllow.run}
        aria-label={alwaysAllow.name}
        title={alwaysAllow.hint}
        className={cn(APPROVAL_CONTROL, "bg-ink/[0.07] text-ink hover:bg-ink/[0.12]")}
      >
        {alwaysAllow.label}
      </button>
    ),
    <button
      key="deny"
      type="button"
      onClick={onAskWhy && !durable ? onAskWhy : deny.run}
      autoFocus={deny.autoFocus}
      className={cn(APPROVAL_CONTROL, "bg-ink/[0.07] text-danger hover:bg-danger/15")}
    >
      {deny.label}
    </button>,
  ].filter(Boolean) : [];
  if (part === "primary") return <>{primary}</>;
  if (part === "more") return more.length ? <div className="flex flex-wrap items-center gap-2">{more}</div> : null;
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {more}
      {primary}
    </div>
  );
}
