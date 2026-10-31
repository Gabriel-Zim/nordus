import { useContext, useEffect, useState } from "react";
import { Check, Undo2, X } from "lucide-react";
import { api, ApiError, StoreContext, type Message, type OptionCardData } from "@/state/store";
import { shareLearnedSkillsMode } from "@/lib/feature-flags";
import { cn } from "@/lib/cn";
import { t, tFromServer } from "@/lib/i18n";
import { useAdvancedMode } from "@/lib/interface-mode";
import { SimpleSystemLine } from "./SimpleSystemLine";
import { appSettingLine, appSettingWarning, settleAppSettingCard } from "@/lib/app-setting-cards";
import { SkillRequestPreview } from "@/components/SkillRequestPreview";
import { lessonLine, outboundSummary } from "@/lib/approval-summary";
import { toolLabel } from "@/lib/human-tool";
import { niceDate, niceTime, scheduleLabel } from "@/lib/schedule-label";
import { cronScheduleLabel } from "../../shared/cron-label";
import { PROFILE_REQUEST_FIELDS, profileItems } from "../../shared/profile-request";
import type { RoutineRequestSchedule } from "../../shared/routine-request";
import type { SkillShareRecord } from "../../shared/skill-request";
import { ApprovalTimelineCard, approvalView, type ApprovalBot } from "./ApprovalTimelineCard";
import { PROFILE_FIELD_LABEL } from "./PendingApproval";
import { cardAutomation } from "@/lib/automations";
import { TriggerCard } from "./TriggerCard";

const ROUTINE_SETTLED_LABEL = {
  create: "approval.status.routineScheduled",
  update: "approval.status.routineUpdated",
  pause: "approval.status.routinePaused",
  resume: "approval.status.routineResumed",
  run_now: "approval.status.routineRunQueued",
  delete: "approval.status.routineDeleted",
} as const;

const SKILL_SETTLED_LABEL = {
  create: "approval.status.skillEnabled",
  update: "approval.status.skillUpdated",
} as const;

/** Schedules and webhooks alike are "automations" to a person. */
const AUTOMATION_APPLIED_LINE = {
  create: "approval.applied.automation.create",
  update: "approval.applied.automation.update",
  pause: "approval.applied.automation.pause",
  resume: "approval.applied.automation.resume",
  run_now: "approval.applied.automation.runNow",
  delete: "approval.applied.automation.delete",
} as const;

const SKILL_APPLIED_LINE = {
  create: "approval.applied.skill.create",
  update: "approval.applied.skill.update",
} as const;

export function approvalCardOutcome(card: OptionCardData): string | undefined {
  if (card.expired === true) return t("approval.status.expired");
  if (!card.answered) return undefined;
  if (card.lessonRequest) return t(card.answered === "allow" ? "lesson.ruled" : "lesson.discarded");
  if (card.undone === true) return t("approval.status.undone");
  const isProposal = isProposalCard(card);
  if (card.answered !== "allow") return isProposal ? t("approval.status.cancelled") : t("approval.status.denied");
  if (card.teamSetupRequest) return t(card.teamSetupRequest.deletion ? "approval.status.teamDeleted" : "approval.status.teamApplied");
  const routineAction = card.routineRequest?.operation.action;
  if (routineAction) return t(ROUTINE_SETTLED_LABEL[routineAction]);
  const skillAction = card.skillRequest?.action;
  if (skillAction) return t(SKILL_SETTLED_LABEL[skillAction]);
  if (card.appSettingRequest) return t("approval.status.appSettingChanged");
  if (card.mcpServerRequest) return t("approval.status.appConnected");
  if (card.profileRequest) {
    const items = profileItems(card.profileRequest);
    const leftOut = items.filter((item) => item.outcome && item.outcome.state !== "applied");
    if (leftOut.length) {
      return t("approval.status.profileBatchPartial", {
        applied: items.length - leftOut.length, total: items.length, names: leftOut.map((item) => `@${item.targetName}`).join(", "),
      });
    }
    return items.length > 1 ? t("approval.status.profileBatchApplied", { count: items.length }) : t("approval.status.profileUpdated");
  }
  if (card.modelRequest) return t("approval.status.modelChanged");
  if (card.routineRequest) return t("approval.status.routineConfirmed");
  if (card.skillRequest) return t("approval.status.skillConfirmed");
  return t("approval.status.allowed");
}

/** A tool approval that went stale or was withdrawn leaves no line in the conversation; an answered one stays as a record. */
export function isWithdrawnToolApproval(message: Pick<Message, "kind" | "card">): boolean {
  const card = message.card;
  if (message.kind !== "options" || !card?.requestId || !card.tool || card.questionRequest) return false;
  if (card.routineRequest || card.skillRequest || card.profileRequest || card.teamSetupRequest || card.modelRequest || card.lessonRequest || card.appSettingRequest || card.mcpServerRequest) return false;
  return approvalView(card).kind === "expired";
}

function plainWhen(schedule: RoutineRequestSchedule): string {
  if (schedule.type === "once") {
    return new Date(schedule.at).toDateString() === new Date().toDateString()
      ? t("approval.applied.today", { time: niceTime(schedule.at) })
      : `${niceDate(schedule.at)}, ${niceTime(schedule.at)}`;
  }
  if (schedule.type === "cron") {
    const label = cronScheduleLabel(schedule);
    return label.startsWith("Cron ") ? "" : label;
  }
  if (schedule.type === "interval") return scheduleLabel({ ...schedule, anchorAt: schedule.anchorAt ?? 0 });
  if (schedule.type === "limit_reset") return scheduleLabel({ ...schedule, at: null });
  return scheduleLabel(schedule);
}

export function appliedChange(card: OptionCardData, name: string): { line: string; canUndo: boolean } | undefined {
  const routine = card.routineRequest;
  if (routine) {
    const operation = routine.operation;
    const undo = routine.undo;
    const when = undo?.schedule && operation.action !== "pause" && operation.action !== "delete" && operation.action !== "run_now"
      ? plainWhen(undo.schedule)
      : "";
    const title = [
      undo?.name ?? (operation.action === "create" ? operation.routine.name : ""),
      operation.forBot ? t("approval.applied.forBot", { target: `@${operation.forBot.name}` }) : "",
    ].filter(Boolean).join(" · ") + (when ? `, ${when}` : "");
    const canUndo = operation.action === "create" ? Boolean(routine.resultId)
      : operation.action === "update" ? Boolean(undo?.before && undo.appliedUpdatedAt !== undefined)
        : operation.action === "pause" || operation.action === "resume" ? undo?.appliedUpdatedAt !== undefined
          : operation.action === "delete" ? Boolean(undo?.before)
            : false;
    return { line: t(AUTOMATION_APPLIED_LINE[operation.action], { name, title }), canUndo };
  }
  const webhook = card.webhookRequest;
  if (webhook) {
    const target = webhook.operation.forBot ? ` · ${t("approval.applied.forBot", { target: `@${webhook.operation.forBot.name}` })}` : "";
    return { line: t(AUTOMATION_APPLIED_LINE[webhook.operation.action], { name, title: `${webhook.undo?.name ?? ""}${target}` }), canUndo: webhook.operation.action !== "run_now" };
  }
  const skill = card.skillRequest;
  if (skill) {
    return {
      line: t(SKILL_APPLIED_LINE[skill.action], { name, title: skill.name }),
      canUndo: skill.action === "create" || Boolean(skill.previous),
    };
  }
  const profile = card.profileRequest;
  if (profile) {
    const [item] = profileItems(profile);
    const title = PROFILE_REQUEST_FIELDS.filter((field) => item!.changes[field] !== undefined)
      .map((field) => t(PROFILE_FIELD_LABEL[field])).join(", ");
    const line = item!.targetBotId === profile.botId
      ? t("approval.applied.profileOwn", { name, title })
      : t("approval.applied.profileOther", { name, target: `@${item!.targetName}`, title });
    return { line, canUndo: Boolean(profile.undo) };
  }
  const appSetting = card.appSettingRequest;
  if (appSetting) return { line: appSettingLine(appSetting), canUndo: true };
  const model = card.modelRequest;
  if (model) {
    const title = model.selection.model;
    const line = model.targetBotId === model.botId
      ? t("approval.applied.modelOwn", { name, title })
      : t("approval.applied.modelOther", { name, target: `@${model.targetName}`, title });
    return { line, canUndo: true };
  }
  const setup = card.teamSetupRequest;
  if (setup?.deletion) return { line: t("approval.applied.botDeleted", { name, target: `@${setup.deletion.name}` }), canUndo: false };
  if (setup?.result) {
    const names = (action: "created" | "updated") => setup.result!.bots.filter((bot) => bot.action === action).map((bot) => `@${bot.name}`).join(", ");
    const title = [names("created") && t("approval.applied.teamAdded", { names: names("created") }),
      names("updated") && t("approval.applied.teamUpdated", { names: names("updated") })].filter(Boolean).join("; ");
    return { line: t("approval.applied.teamSetup", { name, title }), canUndo: Boolean(setup.undo) };
  }
  if (card.teamMemoryRequest) {
    return { line: t("approval.applied.teamMemory", { name, title: card.subtitle.split(" — ")[0] ?? "" }), canUndo: Boolean(card.teamMemoryRequest.revision) };
  }
  return undefined;
}

/** Who a permission card speaks for: the bot that asked, else whoever sent the card. */
export function approvalRowName(message: Pick<Message, "from">, bot?: Pick<ApprovalBot, "name">): string {
  return bot?.name ?? message.from?.name ?? t("approval.someone");
}

/** A change a bot made on its own that the chat shows as one line with Undo; undefined for every other card. */
export function appliedSummary(card: OptionCardData, name: string): { line: string; canUndo: boolean } | undefined {
  return card.autoApplied === true && card.answered === "allow" && !card.held ? appliedChange(card, name) : undefined;
}

function isProposalCard(card: OptionCardData): boolean {
  return Boolean(card.routineRequest || card.skillRequest || card.profileRequest || card.modelRequest || card.teamSetupRequest || card.appSettingRequest || card.mcpServerRequest);
}

/** A plain tool permission the person already decided, which the chat keeps as one small record. */
export function isSettledPermission(card: OptionCardData): boolean {
  return !card.lessonRequest && !isProposalCard(card) && approvalView(card).kind === "settled";
}

function AppliedChangeLine({
  card,
  name,
  threadId,
  summary,
}: {
  card: OptionCardData;
  name: string;
  threadId?: string;
  summary: { line: string; canUndo: boolean };
}) {
  const advanced = useAdvancedMode();
  const [undoing, setUndoing] = useState(false);
  const [error, setError] = useState<string>();
  const [sharing, setSharing] = useState(false);
  // Kept until the card's own patch arrives, so the Share button cannot come back in between.
  const [sharedNow, setSharedNow] = useState<{ requestId: string; shared: SkillShareRecord }>();
  const config = useContext(StoreContext)?.state.config ?? null;
  const undone = card.undone === true;
  useEffect(() => settleAppSettingCard(card, config?.language), [card, config?.language]);
  const skill = card.skillRequest;
  const shared = skill?.shared ?? (sharedNow && sharedNow.requestId === card.requestId ? sharedNow.shared : undefined);
  const canShare = Boolean(skill && !shared && !undone && threadId && card.requestId)
    && shareLearnedSkillsMode(config) === "ask";
  const share = () => {
    const requestId = card.requestId;
    if (!threadId || !requestId || sharing) return;
    setSharing(true);
    setError(undefined);
    api<{ shared: SkillShareRecord }>(`/api/threads/${threadId}/share-skill`, { method: "POST", body: JSON.stringify({ requestId }) })
      .then((response) => setSharedNow({ requestId, shared: response.shared }))
      .catch((failure: unknown) => {
        setError(t("approval.applied.shareFailed", { error: failure instanceof Error ? failure.message : String(failure) }));
      })
      .finally(() => setSharing(false));
  };
  const sharedNames = shared?.assigned.filter((bot) => bot.botId !== skill?.botId).map((bot) => bot.name) ?? [];
  const skippedNames = shared?.skipped.map((bot) => bot.name) ?? [];
  const undo = () => {
    if (!threadId || !card.requestId || undoing) return;
    setUndoing(true);
    setError(undefined);
    api(`/api/threads/${threadId}/undo`, { method: "POST", body: JSON.stringify({ requestId: card.requestId }) })
      .catch((failure: unknown) => {
        setError(failure instanceof ApiError && failure.body?.code === "changed-since"
          ? t("approval.applied.changedSince")
          : t("approval.applied.undoFailed", { error: failure instanceof Error ? failure.message : String(failure) }));
      })
      .finally(() => setUndoing(false));
  };
  if (!advanced && card.routineRequest) {
    return (
      <SimpleSystemLine data-simple-event="routine">
        <span data-applied-change={name}>{summary.line}</span>
        {undone && <span> · {t("approval.applied.undone")}</span>}
        {!undone && summary.canUndo && threadId && (
          <button type="button" onClick={undo} disabled={undoing} className="ml-1 text-accent disabled:opacity-60">
            {undoing ? t("approval.applied.undoing") : t("approval.applied.undo")}
          </button>
        )}
      </SimpleSystemLine>
    );
  }
  return (
    <div className="w-full max-w-[840px] text-[12.5px] text-ink-tertiary" data-applied-change={name}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 leading-5">
        {undone ? <Undo2 size={13} className="shrink-0 self-center" /> : <Check size={13} className="shrink-0 self-center text-success/80" />}
        <span className="min-w-0 break-words">
          {summary.line}
          {shared && !undone && (
            <span> · {sharedNames.length ? t("approval.applied.sharedSkill", { names: sharedNames.join(", ") }) : t("approval.applied.sharedSkillNobody")}</span>
          )}
          {undone && <span> · {t("approval.applied.undone")}</span>}
        </span>
        {!undone && summary.canUndo && threadId && (
          <button
            type="button"
            onClick={undo}
            disabled={undoing}
            className={cn(TEXT_ACTION, "text-accent disabled:opacity-60")}
          >
            {undoing ? t("approval.applied.undoing") : t("approval.applied.undo")}
          </button>
        )}
        {canShare && (
          <button
            type="button"
            onClick={share}
            disabled={sharing}
            className="rounded-md px-1.5 py-0.5 font-medium text-accent hover:bg-inset disabled:opacity-60"
          >
            {sharing ? t("approval.applied.sharingSkill") : t("approval.applied.shareSkill")}
          </button>
        )}
      </div>
      {shared && !undone && skippedNames.length > 0 && (
        <div className="mt-1 text-[12.5px] text-ink-tertiary">{t("approval.applied.shareSkipped", { names: skippedNames.join(", ") })}</div>
      )}
      {!error && !shared && !undone && skill?.shareError && (
        <div className="mt-1 text-[12.5px] text-warning">{t("approval.applied.shareFailed", { error: skill.shareError })}</div>
      )}
      {error && <div role="alert" className="mt-1 text-[12.5px] text-warning">{error}</div>}
      {/* The raw change stays in the logs: the chat line says what happened in plain words. */}
    </div>
  );
}

const TEXT_ACTION =
  "inline-flex h-6 items-center rounded-full px-2 hover:bg-inset focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus";

export function ApprovalCard({
  bot,
  message,
  threadId,
  onCancelTurn,
}: {
  bot?: ApprovalBot;
  message: Message;
  threadId?: string;
  /** Interrupts whatever the card's bot is doing: its own turn in a private chat, the room's turn in a room. */
  onCancelTurn?: () => void;
}) {
  const card = message.card;
  if (!card) return null;
  if (cardAutomation(card)) return <TriggerCard card={card} threadId={threadId} />;
  const name = approvalRowName(message, bot);
  const applied = appliedSummary(card, name);
  if (applied) return <AppliedChangeLine card={card} name={name} threadId={threadId} summary={applied} />;
  const view = approvalView(card);
  if (card.lessonRequest && view.kind !== "pending") {
    return (
      <div
        data-lesson-card=""
        title={lessonLine(card)}
        className="-my-1 flex w-full max-w-[640px] items-center gap-1.5 text-[11px] leading-4 text-ink-tertiary opacity-50"
      >
        {card.answered === "allow" ? <Check size={10} className="shrink-0" aria-hidden="true" /> : <X size={10} className="shrink-0" aria-hidden="true" />}
        <span className="min-w-0 truncate">
          {card.answered === "allow" ? t("lesson.savedLine", { lesson: lessonLine(card) }) : t("lesson.discardedLine")}
        </span>
      </div>
    );
  }
  if (view.kind !== "expired") {
    const isProposal = isProposalCard(card);
    // A proposal that was answered says what became of it ("Rotina agendada"), not what was asked.
    const settledLine = isProposal && view.kind === "settled" ? approvalCardOutcome(card) : undefined;
    return <ApprovalTimelineCard message={message} view={view} bot={bot} threadId={threadId} onCancelTurn={onCancelTurn} settledLine={settledLine} />;
  }
  if (isWithdrawnToolApproval(message)) return null;

  const outbound = outboundSummary(card);
  const isRoutineRequest = Boolean(card.routineRequest);
  const isSkillRequest = Boolean(card.skillRequest);
  const isProfileRequest = Boolean(card.profileRequest);
  const isTeamSetup = Boolean(card.teamSetupRequest);
  const isMcpServer = Boolean(card.mcpServerRequest);
  const routineAction = card.routineRequest?.operation.action;
  const skillAction = card.skillRequest?.action;
  const heldNote = tFromServer(card.heldCode, card.held);
  const displayTool = isRoutineRequest
    ? routineAction === "create" ? "schedule_routine" : "manage_routine"
    : isSkillRequest
      ? skillAction === "update" ? "update_skill" : "stage_skill"
    : isProfileRequest
      ? "update_profile"
    : card.tool;
  const appSettingHeader = card.appSettingRequest ? appSettingLine(card.appSettingRequest) : undefined;
  const profileTargets = card.profileRequest ? profileItems(card.profileRequest) : [];
  const profileHeader = profileTargets.length > 1
    ? t("approval.card.profileWantsToBatch", { name, count: profileTargets.length })
    : profileTargets[0]
      ? profileTargets[0].targetBotId === card.profileRequest!.botId
        ? t("approval.card.profileWantsToOwn", { name })
        : t("approval.card.profileWantsToOther", { name, target: profileTargets[0].targetName })
      : undefined;

  // Only a proposal that went stale reaches this card: it stays faded, with no way to answer it.
  return (
    <div className="w-full max-w-[840px] rounded-2xl border border-hairline/30 bg-card p-4 opacity-70">
      <div className="text-[15px] font-semibold text-ink">
        {isTeamSetup ? card.title : outbound ? outbound.headline : appSettingHeader ?? (isMcpServer
          ? t("approval.card.connectApp", { name: card.mcpServerRequest?.serverName ?? t("approval.someone") })
          : profileHeader ?? t("approval.card.namedWantsTo", { name, action: toolLabel(displayTool) }))}
      </div>
      {outbound?.summary && <div className="mt-0.5 text-[13px] text-ink-secondary">{outbound.summary}</div>}
      <pre
        tabIndex={0}
        aria-label={
          isRoutineRequest
            ? t("approval.aria.routineDetails")
            : isSkillRequest
              ? t("approval.aria.skillDetails")
              : isProfileRequest
                ? t("approval.aria.profileChange")
                : t("approval.aria.details")
        }
        className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-inset px-3 py-2 font-mono text-[12.5px] leading-relaxed text-ink"
      >
        {card.appSettingRequest
          ? [appSettingLine(card.appSettingRequest), appSettingWarning(card.appSettingRequest)].filter(Boolean).join("\n\n")
          : card.mcpServerRequest
            ? t("approval.card.connectAppDetail", { name: card.mcpServerRequest.serverName })
            : card.subtitle}
      </pre>
      {card.skillRequest && <SkillRequestPreview request={card.skillRequest} />}
      {heldNote && (
        <div className="mt-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-[12.5px] text-warning">
          {heldNote}
        </div>
      )}
      <div className="mt-3 flex items-center gap-1.5 text-[13px] text-ink-secondary">
        <X size={14} /> {approvalCardOutcome(card) ?? t("approval.status.expired")}
      </div>
    </div>
  );
}
