import { createContext, memo, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type ReactNode } from "react";
import { ImportedHistoryBar, liveThreadAway } from "./ImportedHistory";
import { OutboxBubbleStatus } from "./ComposerOutbox";
import { useAdvancedMode } from "@/lib/interface-mode";
import { ThreadLinkContext } from "@/components/ThreadLinkMenu";
import { useShowThreads } from "@/lib/thread-preferences";
import {
  AlertTriangle,
  CalendarClock,
  Check,
  Pause,
  ChevronLeft,
  ChevronRight,
  Monitor,
  RefreshCw,
  Square,
  Webhook,
  Mail,
  Zap,
} from "lucide-react";
import { WorkingDots } from "@/components/WorkingIndicator";
import { CopyButton, MESSAGE_ROW, MessageActions, messageActionClass, ReplyAction } from "@/components/MessageActions";
import { ReactAction, ReactionChips } from "@/components/Reactions";
import { useBotMessageMenu, userMessageMenu } from "@/components/message-menu";
import { useSpeech } from "@/lib/tts/useSpeech";
import { localSystemVoiceActive } from "@/lib/local-voice";
import { computerStartLine } from "@/lib/computer-start";
import { rememberComputerPanelOpen } from "@/lib/computer-panel-focus";
import { useCaptionChrome, useDesktopCapabilities } from "@/components/DesktopCapabilities";
import {
  api,
  currentTaskBot,
  useStore,
  formatTime,
  openNotificationTarget,
  openThread,
  visibleMessages,
  type Action,
  type Bot,
  type ConfigStatus,
  type InstanceInfo,
  type Message,
  type AppState,
  awayFromMainThread,
  openBot,
} from "@/state/store";
import { NotificationsHeaderButton } from "./NotificationsHeaderButton";
import { EngineSetup } from "./EngineSetup";
import { CHATGPT_USAGE_URL, ManageUsageLink } from "./ChatGptPlanStatus";
import { callTranscriptHidden } from "../../shared/live-call";
import { CODEX_USAGE_URL, codexUsageLimitReached } from "../../shared/codex-usage-limit";
import { ClaudeUpdatePrompt } from "./ClaudeUpdatePrompt";
import { MacCuaRecoveryActions } from "./MacCuaRecoveryActions";
import { macCuaPermissionMessage, missingMacCuaPermissions } from "@/lib/mac-cua-permissions";
import { failedTurnCause, refusalLine, signedOutEngine } from "@/lib/failed-turn";
import { RECOVERY_LABEL, doneStepsBefore, errorRecovery, mayAutoResume, resumeSendId, type RecoveryAction } from "@/lib/error-recovery";
import { classifyTurnError } from "../../shared/turn-error";
import { isModelUnavailableError } from "@/lib/plain-error";
import { openPlaceAction, placeRowViewFor, usePlaceSeat, worksOnSimpleLabel } from "@/lib/place-view";
import type { PlaceRow } from "../../shared/place-view";
import { trialCreditKind, type TrialCreditRefusal } from "../../shared/trial-credit";
import { TrialCreditNotice } from "./TrialCreditNotice";
import { isPureLeakedSystemHarnessMessage, stripLeakedSystemHarnessMessages } from "../../shared/system-message-guard.ts";
import { ConversationalReply, QuickModelNote, isConversational, useReplySegments, useThreadOpenedAt } from "./ConversationalReply";
import type { LocaleKey } from "@/locales";
import { isProviderSafetyBlock, PROVIDER_SAFETY_GUIDANCE, PROVIDER_SAFETY_HELP_URL } from "../../shared/provider-safety";
import { isCancelledTranscriptRow } from "../../shared/client-cancel";
import { BotAvatar } from "./Avatar";
import { OPEN_WORKING_NOW, TurnPresence } from "./TurnPresence";
import { placeGoalRuns, runningGoal } from "./GoalRunCard";
import { showToolCallsEnabled, skillAuthoringEnabled } from "@/lib/feature-flags";
import { stateForBot } from "@/lib/mascot";
import { conversationOrigin, peerLine, peerRequest } from "@/lib/peer-message";
import { peerReplyGroups } from "@/lib/peer-turns";
import { foldPerStretch } from "@/lib/stretch-fold";
import { HANDOFF_PILL, HANDOFF_ROW, foldHandoffs, handoffKind, handoffLabel, handoffLine } from "@/lib/handoff-label";
import { TaskDots, teammateLine, useBotWork } from "./WorkingNow";
import { isTeamHandoff } from "../../shared/team-work";
import { ClosePeerConversation, PeerConversationPill, TaskConversationTitle } from "./PeerConversation";
import { PeerLabel } from "./PeerLabel";
import { ReceivedWork, useReceivedWork, type ReceivedBlock } from "./ReceivedWork";
import { placeReceived } from "@/lib/received-work";
import { localizedGreeting } from "@/lib/seed-greeting";
import { producedFileVersions } from "@/lib/file-versions";
import { parseVoiceNote } from "@/lib/voice-note";
import { showWorkingDots } from "@/lib/turn-tail";
import { lastNonReceipt } from "@/lib/receipts";
import { commandPresence } from "@/lib/command-presence";
import { liveActivityPhrases } from "@/lib/live-activity";
import { isBrowserGoalTool } from "@/lib/browser-goal";
import { roomActivityVisible } from "@/lib/room-activity";
import { BrowserGoalCard } from "./BrowserGoalCard";
import { FloatingBrowser } from "./FloatingBrowser";
import { ChatMarkdown } from "./ChatMarkdown";
import { PinnedBanner, chiefOfStaffBadge } from "./PinnedBanner";
import { DaySeparator } from "./DaySeparator";
import { InterruptedNote, ReplyDraftBubble } from "./ReplyDraftBubble";
import { VoiceNoteBubble, type VoiceNoteAttachment } from "./VoiceNoteBubble";
import { RawMarkdownView, RawToggleAction } from "./RawMarkdownToggle";
import { ThreadChip } from "./ThreadChip";
import { askText, runSteps, runSummary, skillPrompt } from "@/lib/verify-steps";
import { sendsMessage, useSendKey } from "@/lib/send-key";
import { useColorUserBubbles } from "@/lib/user-bubble-preference";
import { userBubbleStyle } from "@/lib/user-bubble-tone";
import { ToolActivity } from "./ToolActivity";
import { DataResultChip } from "./DataResultChip";
import { ThreadRefText } from "./ThreadRefs";
import type { RoboSvg } from "./RoboAvatar";
import { waveRobot } from "@/lib/robo-wave";
import { optionsCardRow } from "./OptionsCardRow";
import { ApprovalGroup, approvalGroupKey, approvalGroupKind } from "./ApprovalGroup";
import { approvalRowName } from "./ApprovalCard";
import { MessageBoundary } from "./MessageBoundary";
import { WidgetMessage } from "./lazy-screens";
import { Composer } from "./Composer";
import { StarterRequests } from "./StarterRequests";
import { SkeletonMessages } from "./Skeleton";
import { ChatErrorBanner, ChatNotice } from "./ChatErrorBanner";
import { ChatModelSwitch } from "./ChatModelSwitch";
import { ChatHeaderMenu } from "./ChatHeaderMenu";
import { StarterChips } from "./StarterChips";
import { ModelUnavailableCard } from "./ModelUnavailableCard";
import { ThreadContextWarning } from "./ContextWarning";
import { EngineLimitNotice, useLimitResetContinue } from "./LimitResetContinue";
import { ChatFindBar } from "./ChatFindBar";
import { ReplyQuote } from "./ReplyQuote";
import { ConnectorCard } from "./ConnectorCard";
import { SecretRequestCard } from "./SecretRequestCard";
import { SignInRequestCard } from "./SignInRequestCard";
import { AutomationCaption, hasRoutineExecutionTask, RoutineRunCard } from "./RoutineRunCard";
import { CallRecordRow } from "./CallRecordRow";
import { AttachmentGallery, collectMessageFiles, replyAttachmentGroup, splitMessageAttachments } from "./AttachmentGallery";
import { ScreenFrame } from "./ScreenFrame";
import { narrationLine, plainChipShown, plainMechanicalLine, recoveredAfter, simpleWorkingLine } from "@/lib/plain-conversation";
import { CompactionChip } from "./DigestChip";
import { LinkedPictures } from "./LinkedPictures";
import { digestsByReply, openWhatItDid, whatItDidLines, WhatItDidPanel } from "./WhatItDid";
import { plainChatText, splitImagePaths } from "../../shared/plain-chat-text";
import { visibleBotText } from "@/lib/visible-bot-text";
import { arrangeTurns } from "@/lib/turn-attachments";
import { RenameTitle } from "./RenameTitle";
import { BotActivityPicker } from "./TaskPicker";
import { NewThreadButton } from "./BotProjects";
import { OtherThreadApproval } from "./OtherThreadApproval";
import { useChatFindRequests } from "@/lib/chat-find";
import { CitationSelectionToolbar, SentCitations } from "./CitationUI";
import { SpeakButton } from "./SpeakButton";
import { CallOverlay } from "./CallView";
import { LiveCallBar } from "./LiveCallBar";
import { LiveCallChip } from "./LiveCallPill";
import { effectivePlace, toolPlace, type EffectivePlace } from "@/lib/place";
import { cn } from "@/lib/cn";
import { activeLocale, t, waitingOnLabel } from "@/lib/i18n";
import { COMPACT_BUBBLE } from "@/lib/compact-chip";
import { groupTranscript, isStatusActivity } from "@/lib/activity-runs";
import { StatusActivityRow } from "@/components/StatusActivityRow";
import { CancelledTurnRow } from "./CancelledTurnRow";
import { ActivityRun } from "./ActivityRun";
import { TurnNarrationRun } from "./TurnNarrationRun";
import { webhookMessageView } from "@/lib/webhook-message";
import { triggerLabel, triggerLine, type TriggerLine } from "@/lib/trigger-message";
import { splitTranscriptAttachments } from "@/lib/composer-attachments";
import { TRANSCRIPT_END_PAD, useComposerDockHeight } from "@/lib/composer-dock";
import { GlassBar, GlassScrollFrame } from "./GlassScrollFrame";
import { useTranscriptViewport } from "@/hooks/use-transcript-viewport";
import { useUnreadDivider } from "@/hooks/use-unread-divider";
import { NewMessagesDivider } from "./NewMessagesDivider";
import { unreadMessageIds } from "@/lib/unread-divider";
import { appendComposerDraft, appendDraftAttachments, useReplyDraft } from "@/lib/drafts";
import { localDay, transcriptLookups, type TranscriptLookups } from "@/lib/transcript-derivations";
import { splitTranscriptCitations, type CitationAttachment } from "@/lib/citations";
import { highlightCitationSource } from "@/lib/citations-dom";
import { useCanWriteIn } from "@/lib/cloud-guest";
import { latestFailure, latestReply, type TranscriptSnapshot } from "@/lib/transcript-announcer";
import { pendingApprovals } from "./PendingApproval";
import { TranscriptAnnouncer } from "./TranscriptAnnouncer";
import { JumpToLatestButton, useArrivedWhileAway } from "./JumpToLatestButton";
import { useFitName } from "@/lib/fit-name";

const USER_COLLAPSE_CHARS = 600;
const USER_COLLAPSE_LINES = 8;
export const SIMPLE_BUBBLE = "rounded-[23px] font-normal";

interface ChatRows {
  botId: string;
  threadId: string;
  botName: string;
  voiceId?: string;
  tts: ConfigStatus["tts"];
  localVoice: boolean;
  busy: boolean;
  hasMore: boolean;
  bots: readonly Bot[];
  mentionPeers: readonly Bot[]; mentionPerson: { profileName?: string };
  focus: AppState["focusMessage"];
  showToolCalls: boolean;
  locale: string;
  bubbleStyle?: ReturnType<typeof userBubbleStyle>;
  fileVersions: ReadonlyMap<string, ReadonlyMap<string, number>>;
  peerView: boolean;
  dispatch: Dispatch<Action>;
  onBranch: (messageId: string) => boolean;
  conversational: boolean; canReact: boolean;
  openedAt: number;
  /** Turns the last reply's steps into a draft skill; only while that is allowed. */
  saveRun?: () => void;
}

const ChatRowsContext = createContext<ChatRows | null>(null);

function useChatRows(): ChatRows {
  const rows = useContext(ChatRowsContext);
  if (!rows) throw new Error("a chat row outside ChatView");
  return rows;
}

const drawnBot = (bot: Bot) =>
  [bot.id, bot.name, bot.section, bot.hidden, bot.color, bot.mascotBody, bot.mascotExpression, bot.avatarUrl, bot.avatarCrop, bot.avatarZoom, bot.avatarFocusX, bot.avatarFocusY].join("\u0001");

function useFileVersions(messages: readonly Message[]): ReadonlyMap<string, ReadonlyMap<string, number>> {
  const signature = messages
    .filter((message) => message.role === "bot" && message.attachments?.length)
    .map((message) => `${message.id}:${message.attachments!.map((attachment) => attachment.path).join(",")}`)
    .join("|");
  const cache = useRef<{ signature: string; versions: ReadonlyMap<string, ReadonlyMap<string, number>> } | null>(null);
  if (!cache.current || cache.current.signature !== signature) cache.current = { signature, versions: producedFileVersions(messages) };
  return cache.current.versions;
}

/** Where "Fechar conversa" returns to: the last chat open before a bot-to-bot conversation. */
let peerReturn: { botId: string; threadId: string } | null = null;

function useDrawnBots(bots: readonly Bot[]): readonly Bot[] {
  const signature = bots.map(drawnBot).join("\u0002");
  const cache = useRef({ signature, bots });
  if (cache.current.signature !== signature) cache.current = { signature, bots };
  return cache.current.bots;
}

/** An error reads as one plain sentence in the chat; the technical text stays folded under Details. */
export function humanErrorHeadline(message: string): string {
  if (message.startsWith("CUA Driver is not ready for this computer")) return t("chat.error.computerNotReady");
  // The Nordus chat speaks Portuguese: the engine's English never reaches it, only one plain line.
  if (activeLocale() !== "en" && SIGNED_OUT_CAUSE.test(message)) return t("chat.error.reconnect");
  if (activeLocale() !== "en" && writtenInEnglish(message)) return t("chat.error.generic");
  const technical = /[`{}<>]|\b(error|failed|could not|cannot|not ready|ENOENT|ECONN\w*|HTTP|status code|exception|undefined|null|timeout|stack)\b|\b[a-z]+_[a-z_]+\b|\/[\w.-]+\//i;
  return technical.test(message) ? t("chat.error.generic") : message;
}

function writtenInEnglish(text: string): boolean {
  const words = text.toLowerCase().match(/[a-zà-ú']+/g) ?? [];
  if (words.length < 3) return false;
  const english = words.filter((word) => ENGLISH_WORDS.has(word)).length;
  return english >= 2 && english / words.length >= 0.15;
}

const ENGLISH_WORDS = new Set(["the", "is", "are", "was", "not", "your", "you", "this", "that", "it", "its", "missing", "please", "run", "could", "cannot", "can't", "failed", "error", "with", "for", "and", "to", "of", "in", "on", "recreate", "check", "try", "again", "existing", "unable", "found", "settings"]);

export function ErrorRow({
  message,
  headline: plainHeadline,
  onRetry,
  action,
  setupInstance,
  claudeUpdateInstance,
  actions,
  footer,
  why,
  hint,
  paused = false,
}: {
  message: string;
  headline?: string;
  /** why it stopped, in plain words, under the headline */
  why?: string;
  /** what the way out will do */
  hint?: string;
  /** the work stopped and can go on, rather than failed */
  paused?: boolean;
  onRetry?: () => void;
  action?: { label: string; onClick: () => void } | null;
  /** the ways out of this failure, first one the most likely */
  actions?: Array<{ label: string; onClick: () => void; retry?: boolean }>;
  footer?: ReactNode;
  setupInstance?: InstanceInfo;
  claudeUpdateInstance?: InstanceInfo;
}) {
  const { capabilities, ready } = useDesktopCapabilities();
  const failedPermissions = missingMacCuaPermissions(message);
  const currentPermissions = missingMacCuaPermissions(capabilities.localComputer.message);
  const macCuaReason = ready && capabilities.host.platform === "darwin" &&
    capabilities.localComputer.available === false && capabilities.localComputer.reasonCode !== "remote-server" &&
    message.startsWith("CUA Driver is not ready for this computer — ") &&
    failedPermissions.length > 0 && failedPermissions.join(",") === currentPermissions.join(",")
    ? macCuaPermissionMessage(currentPermissions)
    : null;
  const headline = macCuaReason ?? plainHeadline ?? humanErrorHeadline(message);
  const usageUrl = action ? null : message.includes("subscription_sharing_usage_limit_exceeded") ? CHATGPT_USAGE_URL : codexUsageLimitReached(message) ? CODEX_USAGE_URL : null;
  const button = (primary: boolean) => cn(
    "ui-button ui-button-md rounded-full",
    primary ? "border-transparent bg-ink text-app hover:brightness-110" : "border-hairline/50 bg-transparent text-ink hover:bg-ink/5",
  );
  return (
    <div className="flex justify-start">
      <div data-turn-error="" className="w-full max-w-[min(var(--chat-bubble-max),var(--chat-bubble-pct))] rounded-2xl border border-hairline/40 bg-card px-4 py-3 text-[13.5px] text-ink">
        <div className="flex items-start gap-2.5">
          <span className={cn("mt-px grid size-6 shrink-0 place-items-center rounded-full", paused ? "bg-warning/15 text-warning" : "bg-danger/10 text-danger")}>
            {paused ? <Pause size={12} /> : <AlertTriangle size={12} />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-medium leading-snug"><span className="min-w-0 break-words">{headline}</span></p>
            {why && <p className="mt-0.5 break-words text-[13px] leading-relaxed text-ink-secondary">{why}</p>}
            {hint && <p className="mt-1 text-[12.5px] leading-relaxed text-ink-tertiary">{hint}</p>}
            {macCuaReason &&
              <MacCuaRecoveryActions reason={message} />}
            {usageUrl ? (
              <ManageUsageLink href={usageUrl} className="ui-button ui-button-md mt-2 border-transparent bg-ink text-app hover:brightness-110" />
            ) : claudeUpdateInstance ? (
              <ClaudeUpdatePrompt instance={claudeUpdateInstance} onRetry={onRetry} />
            ) : isProviderSafetyBlock(message) ? (
              <p className="mt-2 text-[12.5px] leading-relaxed text-ink-secondary">
                {PROVIDER_SAFETY_GUIDANCE}{" "}
                <a href={PROVIDER_SAFETY_HELP_URL} target="_blank" rel="noreferrer" className="underline">About provider safety checks</a>
              </p>
            ) : setupInstance &&
            !(setupInstance.snapshot.state === "available" && setupInstance.snapshot.authenticated !== false) ? (
              <EngineSetup instance={setupInstance} className="mt-2 text-ink-secondary" />
            ) : actions?.length ? (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {actions.map(({ label, onClick, retry }, index) => (
                  <button key={label} type="button" onClick={onClick} className={button(index === 0)}>
                    {retry && <RefreshCw size={12} />} {label}
                  </button>
                ))}
              </div>
            ) : action !== undefined ? (
              action && (
                <button type="button" onClick={action.onClick} className={cn(button(true), "mt-2.5")}>
                  {action.label}
                </button>
              )
            ) : (
              onRetry && (
                <button onClick={onRetry} className={cn(button(true), "mt-2.5")}>
                  <RefreshCw size={12} /> {t("chat.retry")}
                </button>
              )
            )}
            {footer}
            {headline !== message && <details className="mt-2.5 text-[12px] text-ink-tertiary"><summary className="cursor-pointer select-none hover:text-ink-secondary">{macCuaReason ? t("computer.mac.permission.driverDetail") : t("chat.error.details")}</summary><p className="mt-1 break-words font-mono text-[11.5px]">{message}</p></details>}
          </div>
        </div>
      </div>
    </div>
  );
}

function PlaceFailedRow({ place, botId, threadId, onRetry }: {
  place: PlaceRow;
  botId: string;
  threadId?: string;
  onRetry?: () => void;
}) {
  const { state, dispatch } = useStore();
  const { capabilities } = useDesktopCapabilities();
  const seat = usePlaceSeat(state.config, capabilities.host.platform);
  const bot = state.bots.find((candidate) => candidate.id === botId);
  const view = placeRowViewFor(place, seat, worksOnSimpleLabel(bot?.computer, capabilities.host.platform));
  const id = view.action?.id;
  const onClick = !id ? undefined
    : id === "try-again" ? onRetry
    : () => { openPlaceAction(id, { botId, threadId }, dispatch); };
  return <ErrorRow message={view.line} action={view.action && onClick ? { label: view.action.label, onClick } : null} />;
}

const TRIAL_CREDIT_LINE: Record<"paused" | "too_low", LocaleKey> = { paused: "engines.trialCreditPaused", too_low: "engines.trialCreditTooLow" };
function TrialCreditFailedRow({ kind, onRetry }: { kind: TrialCreditRefusal; onRetry?: () => void }) {
  const { dispatch } = useStore();
  if (kind === "used_up" || kind === "ended") return <TrialCreditNotice kind={kind} />;
  if (kind === "paused") return <ErrorRow message={t(TRIAL_CREDIT_LINE[kind])} onRetry={onRetry} />;
  return <ErrorRow message={t(TRIAL_CREDIT_LINE[kind])} action={{ label: t("chat.error.connectOwnAi"), onClick: () => dispatch({ type: "toggleAppSettings", open: true, section: "engines" }) }} />;
}

export function claudeUpdateTarget(engine: InstanceInfo | undefined): InstanceInfo | undefined {
  return engine?.driverKind === "claudeAgent" && !engine.readOnly ? engine : undefined;
}

export function FailedTurnRow({ tool, engine, onRetry, botId, threadId, messageId, doneSteps = [], autoResume = false }: {
  tool: NonNullable<Message["tool"]>;
  engine: InstanceInfo | undefined;
  onRetry?: () => void;
  botId?: string;
  threadId?: string;
  /** the failure row's own id, which keeps its Resume to one send */
  messageId?: string;
  /** the steps this failed turn started, for "See what was done" */
  doneSteps?: string[];
  /** fresh enough, and not itself a failed resume, to resume on its own after a passing failure */
  autoResume?: boolean;
}) {
  if (tool.place && botId) return <PlaceFailedRow place={tool.place} botId={botId} threadId={threadId} onRetry={onRetry} />;
  const credit = trialCreditKind(failedTurnCause(tool.name) ?? "");
  if (credit) return <TrialCreditFailedRow kind={credit} onRetry={onRetry} />;
  const cause = failedTurnCause(tool.name) ?? tool.name;
  const refused = refusalLine(cause);
  if (refused) return <ErrorRow message={cause} headline={refused} onRetry={onRetry} />;
  // A model the provider refuses is fixed by choosing another one, not by retrying the same request.
  if (isModelUnavailableError(cause) && !(tool.setup && engine)) return <ModelUnavailableCard botId={botId} threadId={threadId} onRetry={onRetry} />;
  const signedOut = signedOutEngine(tool, engine);
  if (signedOut && activeLocale() === "en") {
    return (
      <ErrorRow
        message={cause}
        headline={t("chat.error.signedOut", { name: signedOut.displayName })}
        onRetry={onRetry}
        setupInstance={tool.setup ? engine : undefined}
      />
    );
  }
  return (
    <RecoveringErrorRow
      cause={cause}
      tool={tool}
      engine={engine}
      onRetry={onRetry}
      botId={botId}
      threadId={threadId}
      messageId={messageId}
      doneSteps={doneSteps}
      signedOut={Boolean(signedOut)}
      autoResume={autoResume}
    />
  );
}

/** The engine reports a sign-in now. English keeps the engine's words then; other languages always offer to sign in,
 * since an expired login can still read as signed in. */
function signedInAgain(engine: InstanceInfo | undefined): boolean {
  return engine?.snapshot.state === "available" && engine.snapshot.authenticated === true;
}

const SIGNED_OUT_CAUSE = /not logged in|please run \/login|\/login\b|sign in again|logged out|invalid api key|authentication required/i;

/** A failed turn's sentence and its ways out. Resume, like Retry, is offered only on the latest failure. */
function RecoveringErrorRow({ cause, tool, engine, onRetry, botId, threadId, messageId, doneSteps, signedOut, autoResume }: {
  cause: string;
  messageId?: string;
  tool: NonNullable<Message["tool"]>;
  engine: InstanceInfo | undefined;
  onRetry?: () => void;
  botId?: string;
  threadId?: string;
  doneSteps: string[];
  /** the engine itself reports no sign-in, whatever the cause says */
  signedOut: boolean;
  autoResume: boolean;
}) {
  const { dispatch } = useStore();
  const resume = useLimitResetContinue(botId, threadId, tool.limitResetsAt);
  const [showDone, setShowDone] = useState(false);
  const kind = tool.error ?? classifyTurnError(cause);
  const override = signedOut ? { ...kind, class: "signed-out" as const }
    : kind?.class === "signed-out" && activeLocale() === "en" && signedInAgain(engine) ? { ...kind, class: undefined } : undefined;
  const told = override ?? tool.error;
  // A row from before the server counted the turn's work: the steps the conversation shows are the only count.
  const recovery = errorRecovery(cause, !tool.error && doneSteps.length ? { ...(told ?? kind), done: doneSteps.length } : told);
  const openSettings = (section: "engines" | "backups" | "accountMoves") => () => dispatch({ type: "toggleAppSettings", open: true, section });
  const sendResume = onRetry && botId ? () => dispatch({ type: "send", botId, threadId, text: t("chat.recovery.resumeText"), ...(messageId ? { sendId: resumeSendId(messageId) } : {}) }) : undefined;
  const handlers: Record<RecoveryAction, (() => void) | undefined> = {
    retry: onRetry,
    "sign-in": openSettings("engines"),
    "open-engines": openSettings("engines"),
    "switch-account": openSettings("accountMoves"),
    "see-backups": openSettings("backups"),
    "see-done": () => setShowDone((shown) => !shown),
    resume: sendResume,
  };
  const recoveryActions = recovery.actions.flatMap((action) => {
    const onClick = handlers[action];
    if (!onClick) return [];
    const label = action === "see-done" && showDone ? t("chat.recovery.hideDone") : t(RECOVERY_LABEL[action]);
    return [{ label, onClick, retry: action === "retry" }];
  });
  // The scheduled continue, when the limit has a reset time, leads the ways out.
  const actions = resume ? [{ label: resume.label, onClick: resume.onClick, retry: false }, ...recoveryActions] : recoveryActions;
  const resumable = recovery.actions.includes("resume") && Boolean(sendResume);
  // Resume carries a send id fixed by the failure row, so a second tab or a remount still sends it once.
  const countdown = autoResume && recovery.passing && sendResume && messageId
    ? <AutoResumeCountdown id={messageId} onResume={sendResume} />
    : null;
  return (
    <ErrorRow
      message={cause}
      headline={recovery.title ?? recovery.line}
      why={recovery.title ? recovery.why ?? plainCause(cause) : undefined}
      hint={resumable ? t("chat.recovery.resumeHint") : undefined}
      paused={Boolean(recovery.title || recovery.passing)}
      onRetry={onRetry}
      setupInstance={tool.setup && !recovery.actions.includes("sign-in") ? engine : undefined}
      claudeUpdateInstance={tool.claudeUpdate ? claudeUpdateTarget(engine) : undefined}
      actions={actions}
      footer={(countdown || showDone) && <>{countdown}{showDone && <DoneStepList steps={doneSteps} />}</>}
    />
  );
}

/** The engine's own words when a person can read them, else that the reason is unknown. */
function plainCause(cause: string): string {
  const line = humanErrorHeadline(cause);
  return line === t("chat.error.generic") ? t("chat.recovery.why.unknown") : line;
}

const AUTO_RESUME_SECONDS = 10;
/** Failure rows whose automatic resume already ran or was declined, so a remount does not count down again. */
const autoResumeSettled = new Set<string>();

function AutoResumeCountdown({ id, onResume }: { id: string; onResume: () => void }) {
  const [left, setLeft] = useState(AUTO_RESUME_SECONDS);
  const [settled, setSettled] = useState(() => autoResumeSettled.has(id));
  const resume = useRef(onResume);
  resume.current = onResume;
  useEffect(() => {
    if (settled) return;
    if (left <= 0) {
      autoResumeSettled.add(id);
      setSettled(true);
      resume.current();
      return;
    }
    const timer = window.setTimeout(() => setLeft((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [id, left, settled]);
  if (settled) return null;
  return (
    <div role="status" data-auto-resume="" className="mt-2.5 flex items-center gap-2 text-[12.5px] text-ink-secondary">
      <span className="relative h-1 w-16 overflow-hidden rounded-full bg-ink/10">
        <span className="absolute inset-y-0 left-0 rounded-full bg-ink/50 transition-[width] duration-1000 ease-linear" style={{ width: `${((AUTO_RESUME_SECONDS - left) / AUTO_RESUME_SECONDS) * 100}%` }} />
      </span>
      <span>{t("chat.recovery.autoResume", { seconds: left })}</span>
      <button
        type="button"
        className="underline underline-offset-2 hover:text-ink"
        onClick={() => { autoResumeSettled.add(id); setSettled(true); }}
      >
        {t("chat.recovery.autoResumeCancel")}
      </button>
    </div>
  );
}

function DoneStepList({ steps }: { steps: string[] }) {
  if (!steps.length) return <p className="mt-2.5 text-[12.5px] text-ink-secondary">{t("chat.recovery.noSteps")}</p>;
  return (
    <ol className="mt-2.5 space-y-1 border-l border-hairline/50 pl-3 text-[12.5px] text-ink-secondary">
      {steps.map((step, index) => (
        <li key={index} className="flex items-start gap-1.5">
          <Check size={12} className="mt-[3px] shrink-0 text-success" />
          <span className="min-w-0 break-words">{step}</span>
        </li>
      ))}
    </ol>
  );
}

export { MessageBoundary };

function BubbleEditor({
  initial,
  onCancel,
  onSubmit,
  bubbleStyle,
}: {
  initial: string;
  onCancel: () => void;
  onSubmit: (text: string) => void;
  bubbleStyle?: ReturnType<typeof userBubbleStyle>;
}) {
  const [draft, setDraft] = useState(initial);
  const sendKey = useSendKey();
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  const submit = () => {
    if (draft.trim()) onSubmit(draft.trim());
  };
  return (
    <div className={cn("w-full max-w-[min(var(--chat-bubble-max),var(--chat-bubble-pct))] rounded-2xl bg-bubble-user px-4 py-3", bubbleStyle && "user-bubble-colored")} style={bubbleStyle}>
      <textarea
        ref={ref}
        dir="auto"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (sendsMessage(e.nativeEvent, sendKey)) {
            e.preventDefault();
            submit();
          }
          if (e.key === "Escape") onCancel();
        }}
        rows={Math.min(10, Math.max(2, draft.split("\n").length))}
        className="w-full resize-none bg-transparent text-[15px] leading-relaxed text-ink focus:outline-none"
      />
      <div className="mt-2 flex items-center justify-end gap-2">
        <button
          onClick={onCancel}
          className="rounded-full px-3 py-1 text-[13px] text-ink-secondary hover:bg-raised hover:text-ink"
        >
          {t("common.cancel")}
        </button>
        <button
          onClick={submit}
          disabled={!draft.trim()}
          className="rounded-full bg-accent px-3 py-1 text-[13px] font-medium text-white disabled:opacity-40"
        >
          {t("chat.send")}
        </button>
      </div>
    </div>
  );
}

const Bubble = memo(function Bubble({
  message,
  emerging = false,
  eagerAttachments = false,
  editing,
  pinned,
  versions,
  onStartEdit,
  onCancelEdit,
  onSubmitEdit,
  onRegenerate,
  replyTarget,
  onReply,
  blockStart,
  blockEnd,
  digest,
  lastReply = false,
  peerReplies,
}: {
  digest?: Message;
  lastReply?: boolean;
  /** In a conversation between two bots: whether this bubble opens and closes its speaker's run. */
  blockStart?: boolean;
  blockEnd?: boolean;
  peerReplies?: readonly { id: string; node: ReactNode }[];
  message: Message;
  emerging?: boolean;
  eagerAttachments?: boolean;
  editing: boolean;
  pinned: boolean;
  versions?: readonly Message[];
  onStartEdit: (messageId: string) => void;
  onCancelEdit: () => void;
  onSubmitEdit: (messageId: string, text: string) => void;
  onRegenerate?: () => void;
  replyTarget?: Message;
  onReply: (message: Message) => void;
}) {
  const { botId, threadId, botName, voiceId, tts, localVoice, busy, mentionPeers, mentionPerson, focus, dispatch, onBranch, bubbleStyle, conversational, openedAt, fileVersions, peerView, bots, saveRun, canReact } = useChatRows();
  const block = { start: blockStart, end: blockEnd };
  const remoteClient = window.ogb?.remoteClient?.active === true;
  const peer = peerLine(message) ?? peerRequest(message, botId);
  const peerCard = peer && (peer.botId ? peer.botId === botId : peer.name === botName) ? null : peer;
  // Between two bots the one who asked sits on the right, like the person asking; the one answering on the left.
  const speaker = peerView && message.role !== "user" || peerView && peer
    ? (peer ? bots.find((b) => b.id === peer.botId) ?? bots.find((b) => b.name === peer.name) : bots.find((b) => b.id === botId)) ?? null
    : null;
  const speakerName = peer?.name ?? botName;
  const asker = Boolean(peerView && peer);
  const user = message.role === "user" && !peer;
  const [expanded, setExpanded] = useState(false);
  const [peerOpen, setPeerOpen] = useState(false);
  const [peerClosedForFocus, setPeerClosedForFocus] = useState<number | null>(null);
  const focusedSearch = focus?.messageId === message.id && Boolean(focus.matchText);
  const peerFocus = focus && !focus.consumed &&
    (focus.messageId === message.id || Boolean(peerReplies?.some((reply) => reply.id === focus.messageId)))
    ? focus.nonce : null;
  const focusedHere = peerFocus !== null && peerClosedForFocus !== peerFocus;
  const peerShown = peerOpen || focusedHere;
  const [viewRaw, setViewRaw] = useState(false);
  const speech = useSpeech();
  const advanced = useAdvancedMode();
  const speaking = speech.messageId === message.id && speech.status !== "idle";
  const rawText = peer ? peer.body : (message.text ?? "");
  // (the "NEEDS INPUT:" marker of a question is for the app: the person reads just the question)
  const plain = user ? rawText : plainChatText(visibleBotText(localizedGreeting(stripLeakedSystemHarnessMessages(rawText), bots.find((candidate) => candidate.id === botId))));
  // Between two bots, the asker's "@Social" before its question repeats who it is talking to: the header already says it.
  const unaddressed = asker && botName && plain.startsWith(`@${botName}`) ? plain.slice(botName.length + 1).replace(/^[\s,:]+/, "") : plain;
  const pictures = useMemo(() => user ? { text: unaddressed, images: [] } : splitImagePaths(unaddressed), [user, unaddressed]);
  const text = pictures.text;
  const whatItDid = useMemo(() => whatItDidLines(digest), [digest]);
  const botMenu = useBotMessageMenu({
    text,
    botId,
    messageId: message.id,
    task: { threadId, messageId: message.id, text },
    voiceId,
    tts,
    localVoice,
    canSpeak: message.kind === "text" && !peer,
    viewRaw,
    onToggleRaw: () => setViewRaw((raw) => !raw),
    onRegenerate: !busy ? onRegenerate : undefined,
    onWhatItDid: whatItDid.length ? () => openWhatItDid(speakerName, whatItDid, lastReply ? saveRun : undefined) : undefined,
    pin: remoteClient ? undefined : {
      pinned,
      onToggle: () => dispatch({ type: "updateTask", botId, threadId, patch: { pinnedMessageId: pinned ? "" : message.id } }),
    },
  });
  const attached = useMemo(() => splitMessageAttachments(message.attachments), [message.attachments]);
  const generatedPaths = attached.images;
  const linkedFiles = useMemo(
    () => user ? [] : [...attached.files, ...collectMessageFiles(text, [...attached.images, ...attached.files.map((file) => file.path)])],
    [user, text, attached],
  );
  const group = useMemo(
    () => !user && text.trim() ? replyAttachmentGroup(text, message.attachments) : null,
    [user, text, message.attachments],
  );
  const voiceNotes = useMemo(
    () => message.attachments?.filter((attachment): attachment is VoiceNoteAttachment => attachment.kind === "audio") ?? [],
    [message.attachments],
  );
  const reply = useReplySegments(conversational && !user && !peer && !viewRaw && !replyTarget && message.kind === "text", text, message.at, openedAt);
  const split = reply.segments.length > 1;
  const webhookView = user ? webhookMessageView(text) : null;
  const cited = user && !webhookView ? splitTranscriptCitations(text) : null;
  const attachments = user && !webhookView ? splitTranscriptAttachments(cited?.display ?? text) : null;
  const visibleText = webhookView?.task ?? attachments?.display ?? text;
  const hasAttachments = Boolean(cited?.citations.length || (attachments && (attachments.images.length || attachments.files.length)));
  const attachmentsOnly = !webhookView && !replyTarget && !visibleText.trim() &&
    (user ? hasAttachments : generatedPaths.length + linkedFiles.length > 0);
  const collapsible =
    user && !webhookView && !expanded && (visibleText.length > USER_COLLAPSE_CHARS || visibleText.split("\n").length > USER_COLLAPSE_LINES);
  useEffect(() => {
    if (focusedSearch && collapsible) setExpanded(true);
  }, [focusedSearch, collapsible, focus?.nonce]);
  useEffect(() => {
    if (focusedHere) setPeerOpen(true);
  }, [focusedHere, focus?.nonce]);
  const togglePeer = () => {
    if (peerShown) {
      setPeerOpen(false);
      if (peerFocus !== null) setPeerClosedForFocus(peerFocus);
    } else {
      setPeerOpen(true);
    }
  };

  if (peerCard && !peerView && !peerShown) {
    return (
      <div {...{ [MESSAGE_ROW]: "" }} className="group flex w-full flex-col">
        <PeerLabel peer={peerCard} bots={bots} at={message.at} open={false} onToggle={togglePeer} />
      </div>
    );
  }

  const sentVoice = user ? parseVoiceNote(text) : null;
  if (sentVoice) {
    return (
      <div {...{ [MESSAGE_ROW]: "" }} data-voice-note-row="" className="group flex w-full flex-col items-end">
        <VoiceNoteBubble
          attachment={{ kind: "audio", path: sentVoice.path, mime: sentVoice.mime, durationMs: sentVoice.durationMs }}
          transcript={sentVoice.transcript}
          className="items-end"
          from="user"
        />
      </div>
    );
  }

  if (user && editing && !webhookView && !hasAttachments) {
    return (
      <div className="flex w-full justify-end">
        <BubbleEditor initial={text} bubbleStyle={bubbleStyle} onCancel={onCancelEdit} onSubmit={(edited) => onSubmitEdit(message.id, edited)} />
      </div>
    );
  }

  const forks = user && versions ? versions : [message];
  const versionIndex = forks.findIndex((v) => v.id === message.id);
  const switchTo = (v: Message | undefined) => {
    if (v && !busy && !v.id.startsWith("optimistic-")) dispatch({ type: "switchBranch", botId, threadId, messageId: v.id });
  };
  const togglePin = () =>
    dispatch({ type: "updateTask", botId, threadId, patch: { pinnedMessageId: pinned ? "" : message.id } });

  return (
    <div {...{ [MESSAGE_ROW]: "" }} data-side={user || asker ? "me" : "them"} data-seq-start={block?.start === false ? undefined : ""} data-seq-end={block?.end === false ? undefined : ""} className={cn("group flex w-full flex-col animate-msg-in", user || asker ? "items-end" : "items-start")}>
      {peerCard && !peerView && <PeerLabel peer={peerCard} bots={bots} at={message.at} open={peerShown} onToggle={togglePeer} />}
      {peerView && !user && block?.start !== false && (
        <span data-peer-speaker="" className={cn("bot-identity nb-name mb-1 text-[11px] font-semibold uppercase tracking-[0.06em]", asker ? "pr-[34px]" : "pl-[34px]")} data-bot-color={speaker?.color ?? "blue"}>
          {speakerName}
        </span>
      )}
      <div className={cn("flex w-full items-center gap-1.5", user || asker ? "justify-end" : "justify-start")}>
        {peerView && !user && !asker && <PeerSpeakerAvatar bot={speaker} name={speakerName} shown={block?.end !== false} />}
        {user && (
          <MessageActions
            side="user"
            menu={userMessageMenu({
              messageId: message.id,
              task: { threadId, messageId: message.id, text: visibleText },
              onEdit: message.kind === "text" && !webhookView && !hasAttachments && !busy && !message.id.startsWith("optimistic-")
                ? () => onStartEdit(message.id) : undefined,
              pin: remoteClient ? undefined : { pinned, onToggle: togglePin },
            })}
          >
            <ReplyAction onReply={() => onReply(message)} />
            {Boolean(visibleText.trim()) && <CopyButton text={visibleText} className={messageActionClass} />}
          </MessageActions>
        )}
        <div
          data-chat-bubble
          className={cn(
            "w-fit max-w-[min(var(--chat-bubble-max),var(--chat-bubble-pct))] rounded-2xl text-[15px] leading-relaxed",
            emerging && "turn-answer",
            user && webhookView
              ? "overflow-hidden border border-accent/25 bg-card text-ink"
              : attachmentsOnly || split
                ? "text-ink"
                : user
                  ? cn("bg-bubble-user px-4 py-2.5 whitespace-pre-wrap text-ink", bubbleStyle && "user-bubble-colored")
                  : cn("bg-card px-4 py-2.5 text-ink"),
          )}
          style={user && !webhookView && !attachmentsOnly
            ? bubbleStyle
            : asker && !attachmentsOnly ? { background: `color-mix(in srgb, var(--identity-${speaker?.color ?? "blue"}) 16%, var(--color-card))` } : undefined}
          title={new Date(message.at).toLocaleString()}
        >
          {replyTarget && (
            <div className="mb-2">
              <ReplyQuote
                message={replyTarget}
                fallbackName={botName}
                compact
                onJump={() =>
                  dispatch({ type: "focusMessage", threadId, messageId: replyTarget.id })
                }
              />
            </div>
          )}
          {user && webhookView ? (
            <div className="min-w-[300px] max-w-[520px]">
              <div className="flex items-center gap-2 border-b border-accent/15 bg-accent/[0.055] px-4 py-2.5 text-[11.5px] font-medium text-accent">
                <Webhook size={13} />
                <span>{t("chat.webhookTask")}</span>
              </div>
              <div className="chat-text px-4 py-3 whitespace-pre-wrap">{webhookView.task}</div>
              {webhookView.payload && (
                <details className="border-t border-hairline/30 bg-inset/25 px-4 py-2.5 text-[11.5px] text-ink-secondary">
                  <summary className="cursor-pointer select-none hover:text-ink">{t("chat.viewPayload")}</summary>
                  <pre className="mt-2 max-h-48 overflow-auto rounded-lg border border-hairline/25 bg-black/25 p-3 font-mono text-[10.5px] leading-relaxed whitespace-pre-wrap text-ink-secondary">{webhookView.payload}</pre>
                </details>
              )}
            </div>
          ) : user ? (
            <>
              {attachments && <AttachmentGallery images={attachments.images} files={attachments.files} message={{ threadId, messageId: message.id }} eager={eagerAttachments} className={!visibleText ? "mb-0" : undefined} />}
              {visibleText && (
                <div
                  className={cn("chat-text", collapsible && "max-h-40 overflow-hidden [mask-image:linear-gradient(to_bottom,black_60%,transparent)]")}
                  data-citation-source={message.id}
                  data-citation-owner-type="bot"
                  data-citation-owner={botId}
                  data-citation-thread={threadId}
                >
                  <ThreadRefText text={visibleText} peers={mentionPeers} />
                </div>
              )}
              {cited && <SentCitations
                citations={cited.citations}
                onNavigate={async (citation: CitationAttachment) => {
                  if (citation.source.ownerType !== "bot" || !onBranch(citation.source.messageId)) return false;
                  dispatch({ type: "focusMessage", threadId, messageId: citation.source.messageId });
                  return highlightCitationSource(citation);
                }}
              />}
              {advanced && message.quickModel && <QuickModelNote model={message.quickModel} />}
              {message.via === "call" && (
                <span className="mt-1 text-[11px] text-ink-tertiary" title={t("chat.viaCall")}>
                  {t("chat.viaCall")}
                </span>
              )}
              {collapsible && (
                <button onClick={() => setExpanded(true)} className="mt-1 text-[12.5px] text-ink-secondary hover:text-ink">
                  {t("chat.showFull")}
                </button>
              )}
              {expanded && (
                <button onClick={() => setExpanded(false)} className="mt-1 text-[12.5px] text-ink-secondary hover:text-ink">
                  {t("chat.showLess")}
                </button>
              )}
            </>
          ) : (
            <MessageBoundary key={viewRaw ? "raw" : "rendered"} fallbackText={text || t("chat.generatedImage")}>
              {voiceNotes.length > 0 && (
                <div className={cn("flex flex-col", (text || generatedPaths.length > 0 || linkedFiles.length > 0) && "mb-2")}>
                  {voiceNotes.map((note) => (
                    <VoiceNoteBubble key={note.path} attachment={note} />
                  ))}
                </div>
              )}
              {!group && <AttachmentGallery images={generatedPaths} files={linkedFiles} message={{ threadId, messageId: message.id }} className={text ? undefined : "mb-0"} eager={eagerAttachments} produced={{ by: message.from?.name ?? botName, versions: fileVersions.get(message.id) }} />}
              {split ? (
                <ConversationalReply segments={reply.segments} firstNew={reply.firstNew} citation={{ messageId: message.id, botId, threadId }}
                  renderSegment={(segment) => <ChatMarkdown text={segment} mentionPeers={mentionPeers} mentionPerson={mentionPerson} message={{ threadId, messageId: message.id }} delivered={group?.delivered} />} />
              ) : viewRaw && text ? (
                <div data-citation-source={message.id} data-citation-owner-type="bot" data-citation-owner={botId} data-citation-thread={threadId}><RawMarkdownView text={text} /></div>
              ) : text ? (
                <div data-citation-source={message.id} data-citation-owner-type="bot" data-citation-owner={botId} data-citation-thread={threadId}><ChatMarkdown text={text} mentionPeers={mentionPeers} mentionPerson={mentionPerson} message={{ threadId, messageId: message.id }} delivered={group?.delivered} /></div>
              ) : null}
              {message.interrupted && <InterruptedNote />}
              {pictures.images.length > 0 && <LinkedPictures paths={pictures.images} message={{ threadId, messageId: message.id }} />}
              {group && <AttachmentGallery images={group.images} files={group.files} message={{ threadId, messageId: message.id }} eager={eagerAttachments} beneath produced={{ by: message.from?.name ?? botName, versions: fileVersions.get(message.id) }} />}
            </MessageBoundary>
          )}
          <span data-message-time="" className="mt-0.5 block select-none text-right text-[11px] leading-none tabular-nums">{formatTime(message.at)}</span>
        </div>
        {!user && (
          <MessageActions side="bot" forceOpen={viewRaw || speaking} menu={botMenu}>
            <ReplyAction onReply={() => onReply(message)} />
            {canReact && !peer && <ReactAction threadId={threadId} message={message} />}
            {text && <CopyButton text={text} className={messageActionClass} />}
            {text && viewRaw && <RawToggleAction active onToggle={() => setViewRaw(false)} className={messageActionClass} />}
            {text && speaking && (
              <SpeakButton text={text} botId={botId} messageId={message.id} voiceId={voiceId} tts={tts} localVoice={localVoice} className={cn(messageActionClass, "text-accent")} />
            )}
          </MessageActions>
        )}
        {asker && <PeerSpeakerAvatar bot={speaker} name={speakerName} shown={block?.end !== false} />}
      </div>
      {peerCard && !peerView && peerShown && peerReplies && peerReplies.length > 0 && (
        <div
          data-peer-replies=""
          className="mt-1.5 flex w-full max-w-[min(var(--chat-bubble-max),var(--chat-bubble-pct))] flex-col gap-1.5 border-l-2 border-hairline/40 pl-2"
        >
          {peerReplies.map((reply) => (
            <div key={reply.id} className="contents" data-mid={reply.id}>
              {reply.node}
            </div>
          ))}
        </div>
      )}
      {user && message.sendId && <OutboxBubbleStatus sendId={message.sendId} />}
      <ReactionChips threadId={threadId} message={message} bots={bots} align={user ? "end" : "start"} canReact={canReact} />
      {forks.length > 1 && (
        <div className="mt-1 flex items-center gap-0.5 pr-1 text-[12px] text-ink-secondary">
          <button
            onClick={() => switchTo(forks[versionIndex - 1])}
            disabled={versionIndex <= 0 || busy}
            className="rounded p-0.5 hover:bg-raised hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent"
            title={t("chat.previousVersion")}
            aria-label={t("chat.previousVersion")}
          >
            <ChevronLeft size={14} />
          </button>
          <span className="tabular-nums">
            {versionIndex + 1}/{forks.length}
          </span>
          <button
            onClick={() => switchTo(forks[versionIndex + 1])}
            disabled={versionIndex >= forks.length - 1 || busy}
            className="rounded p-0.5 hover:bg-raised hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent"
            title={t("chat.nextVersion")}
            aria-label={t("chat.nextVersion")}
          >
            <ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  );
});

const TextRow = memo(function TextRow({
  message,
  editing,
  pinned,
  versions,
  replyTarget,
  digest,
  lastReply = false,
  retryable = false,
  emerging = false,
  eagerAttachments = false,
  peerReplies,
  blockStart,
  blockEnd,
  onStartEdit,
  onCancelEdit,
  onSubmitEdit,
  onRegenerate,
  onReply,
}: {
  message: Message;
  editing: boolean;
  pinned: boolean;
  versions?: readonly Message[];
  replyTarget?: Message;
  digest?: Message;
  lastReply?: boolean;
  retryable?: boolean;
  emerging?: boolean;
  eagerAttachments?: boolean;
  peerReplies?: readonly { id: string; node: ReactNode }[];
  blockStart?: boolean;
  blockEnd?: boolean;
  onStartEdit: (messageId: string) => void;
  onCancelEdit: () => void;
  onSubmitEdit: (messageId: string, text: string) => void;
  onRegenerate?: () => void;
  onReply: (message: Message) => void;
}) {
  const { botId, threadId } = useChatRows();
  if (isCancelledTranscriptRow(message)) {
    return <CancelledTurnRow onRetry={retryable ? onRegenerate : undefined} />;
  }
  // A notice to the Boss (an incident or a request for help) is its instructions; the chip above says what happened.
  if (message.peerAsk?.incident) return null;
  const peer = peerLine(message) ?? peerRequest(message, botId);
  const user = message.role === "user" && !peer;
  const trigger = user ? triggerLine(message.text) : null;
  if (trigger) return <TriggerEventRow trigger={trigger} at={message.at} />;
  if (!user && isModelUnavailableError(message.text ?? "")) return <ModelUnavailableCard botId={botId} threadId={threadId} />;
  if (!user && isPureLeakedSystemHarnessMessage(message.text) && !message.attachments?.length) return null;
  return (
    <Bubble
      message={message}
      emerging={emerging}
      eagerAttachments={eagerAttachments}
      editing={editing}
      pinned={pinned}
      versions={versions}
      onStartEdit={onStartEdit}
      onCancelEdit={onCancelEdit}
      onSubmitEdit={onSubmitEdit}
      onRegenerate={onRegenerate}
      replyTarget={replyTarget}
      onReply={onReply}
      digest={digest}
      lastReply={lastReply}
      peerReplies={peerReplies}
      blockStart={blockStart}
      blockEnd={blockEnd}
    />
  );
});

/** A line the server wrote about its own mechanics, said plainly in the Simple chat. */
function PlainLineRow({ text }: { text: string }) {
  return (
    <div role="status" className="flex w-fit max-w-full px-1 py-0.5 text-[13px] text-ink-secondary">
      <span className="min-w-0 break-words">{text}</span>
    </div>
  );
}

/** The bot's screen in the Simple chat: the newest frame of a stretch, shown only when the person asks. */
function ScreenOnRequest({ threadId, message }: { threadId: string; message: Message }) {
  const [open, setOpen] = useState(false);
  if (!message.hasImage && !message.png) return null;
  return (
    <div className="flex flex-col items-start gap-2">
      <button type="button" aria-expanded={open} onClick={() => setOpen((shown) => !shown)} className="ui-pill">
        <Monitor size={13} aria-hidden="true" />
        <span>{t(open ? "chat.screen.hide" : "chat.screen.show")}</span>
      </button>
      {open && <ScreenFrame threadId={threadId} message={message} />}
    </div>
  );
}

/** A turn nobody typed (an email that arrived, a webhook, a routine) reads as one quiet line; its prompt stays in the logs. */
function TriggerEventRow({ trigger, at }: { trigger: TriggerLine; at: number }) {
  const Icon = trigger.kind === "email" ? Mail : trigger.kind === "routine" ? CalendarClock : Zap;
  const label = triggerLabel(trigger);
  return (
    <div data-trigger-event={trigger.kind} className="flex w-full justify-center py-1">
      <span className="flex max-w-[min(100%,36rem)] items-center gap-1.5 rounded-full px-3 py-1 text-[12px] text-ink-tertiary" title={new Date(at).toLocaleString()}>
        <Icon size={13} aria-hidden="true" className="shrink-0" />
        <span className="min-w-0 truncate">{label}</span>
        <span className="shrink-0 tabular-nums">· {formatTime(at)}</span>
      </span>
    </div>
  );
}

/** The small round avatar beside the last bubble of a bot's run; a spacer keeps the run aligned above it. */
function PeerSpeakerAvatar({ bot, name, shown }: { bot: Bot | null; name: string; shown: boolean }) {
  if (!shown) return <span aria-hidden="true" className="w-[26px] shrink-0" />;
  return (
    <span className={cn("shrink-0 self-end rounded-full pb-0.5", bot && "cursor-pointer transition-transform hover:scale-105")} data-mention-bot={bot?.id} title={bot ? t("chat.openPrivate", { name: bot.name }) : undefined}>
      <BotAvatar bot={bot ?? { name, color: "blue" }} size={26} motion="none" motionKey={0} animated={false} />
    </span>
  );
}

const ActivityChip = memo(function ActivityChip({ message, place = "auto", count = 1 }: { message: Message; place?: EffectivePlace; count?: number }) {
  const { bots, dispatch, botId, threadId, botName, busy } = useChatRows();
  const tool = message.tool;
  if (!tool) return null;
  if (message.threadRef) return <ThreadChip message={message} count={count} />;
  if (isBrowserGoalTool(tool.name, tool.input) && !message.comm) {
    return (
      <BrowserGoalCard
        message={message}
        threadId={threadId}
        botId={botId}
        botName={botName}
        turnBusy={busy}
        onStop={() => dispatch({ type: "interrupt", botId, threadId })}
      />
    );
  }
  const comm = message.comm;
  if (comm) {
    const withBot = bots.find((b) => b.id === comm.withBotId);
    return (
      <div className={HANDOFF_ROW}>
        <button
          onClick={() => dispatch({ type: "select", id: comm.groupId })}
          title={handoffKind(tool.name) ? handoffLabel(tool.name) : t("chat.openConversationWith", { name: comm.withName })}
          className={HANDOFF_PILL}
        >
          <BotAvatar bot={withBot ?? { name: comm.withName, color: comm.withColor }} state="happy" size={20} animated={false} />
          <span className="max-w-[480px] truncate">{handoffKind(tool.name) ? handoffLine(tool.name, count, withBot?.name ?? comm.withName) : handoffLabel(tool.name)}</span>
          <ChevronRight size={13} aria-hidden="true" className="shrink-0 text-ink-tertiary" />
        </button>
      </div>
    );
  }
  return <ToolActivity tool={tool} place={toolPlace(tool.name, place)} />;
});

function RoutineRunRow({ message, botId }: { message: Message; botId: string }) {
  const { state, dispatch } = useStore();
  const showThreads = useShowThreads();
  const executionThreadId = message.routineRun?.executionThreadId;
  // A failure reaches the person as a bot's own message; the raw status stays in the routine's history.
  const failed = message.routineRun?.status === "failed" || message.routineRun?.status === "missed";
  const canOpen = executionThreadId && state.bots.some((candidate) =>
    candidate.threadId === executionThreadId || hasRoutineExecutionTask(candidate.tasks, executionThreadId)
  );
  if (failed) return null;
  return (
    <RoutineRunCard
      message={message}
      // The run's own conversation opens from Registros; from the chat only when the run is waiting for an answer.
      onOpen={canOpen && executionThreadId && message.routineRun?.goalStatus === "needs-input"
        ? () => openNotificationTarget(dispatch, { botId, threadId: executionThreadId }, state, showThreads)
        : undefined}
    />
  );
}

function EmptyChat({ bot }: { bot: Bot }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center py-16 text-center">
      <p className="max-w-[360px] text-[13px] text-ink-tertiary">{bot.description || t("chat.emptyPrompt")}</p>
      <StarterRequests bot={bot} onPick={(text) => appendComposerDraft(`bot:${bot.id}:${bot.threadId}`, text)} />
      <StarterChips setupOnly />
    </div>
  );
}

const MessagesList = memo(function MessagesList({
  messages: incoming,
  transcript,
  lookups,
  place,
  pinnedMessageId,
  today,
  editingId,
  lastBotTextId,
  emergingId,
  canRetryLast,
  engine,
  unreadDividerId,
  unreadDividerFading,
  received,
  olderHidden,
  onStartEdit,
  onCancelEdit,
  onSubmitEdit,
  onRegenerate,
  onReply,
}: {
  messages: Message[];
  transcript: Message[];
  lookups: TranscriptLookups;
  place: EffectivePlace;
  pinnedMessageId?: string;
  today: number;
  editingId: string | null;
  lastBotTextId: string | undefined;
  emergingId?: string | null;
  canRetryLast: boolean;
  engine: InstanceInfo | undefined;
  unreadDividerId: string | null;
  unreadDividerFading: boolean;
  received: readonly ReceivedBlock[];
  olderHidden: boolean;
  onStartEdit: (id: string) => void;
  onCancelEdit: () => void;
  onSubmitEdit: (id: string, text: string) => void;
  onRegenerate: () => void;
  onReply: (message: Message) => void;
}) {
  const { botId, threadId, botName, busy, hasMore, focus, showToolCalls, locale, bots, dispatch, peerView } = useChatRows();
  const advanced = useAdvancedMode();
  const owner = bots.find((candidate) => candidate.id === botId);
  const messages = useMemo(() => arrangeTurns(placeGoalRuns(incoming), () => busy), [incoming, busy]);
  const peerGroups = useMemo(
    () => peerView ? new Map<string, readonly Message[]>() : peerReplyGroups(messages, botId, botName),
    [messages, botId, botName, peerView],
  );
  const shownMessages = useMemo(() => {
    if (!peerGroups.size) return messages;
    const grouped = new Set<string>();
    for (const replies of peerGroups.values()) {
      for (const reply of replies) grouped.add(reply.id);
    }
    return grouped.size ? messages.filter((message) => !grouped.has(message.id)) : messages;
  }, [messages, peerGroups]);
  const items = useMemo(() => groupTranscript(shownMessages), [shownMessages, locale]);
  const digests = useMemo(() => digestsByReply(messages), [messages]);
  const handoffFolds = useMemo(
    () => foldHandoffs(messages.filter((m) =>
      !(m.kind === "activity" && ((m.comm?.groupId && !m.threadRef) || (!advanced && owner && isTeamHandoff(m, owner, bots))))
    )),
    [messages, advanced, owner, bots],
  );
  const ownerApprovalBot = owner ?? { name: botName };
  const approvalFolds = useMemo(
    () => advanced ? null : foldPerStretch(messages, (m) => {
      const key = approvalGroupKey(m, ownerApprovalBot);
      return key === null ? null : `${key}|${localDay(m.at)}`;
    }),
    [messages, advanced, owner, botName],
  );
  const newestMessageId = incoming.at(-1)?.id;
  let newestUserMessageId: string | undefined;
  for (let i = shownMessages.length - 1; i >= 0 && !newestUserMessageId; i--) {
    if (shownMessages[i]!.role === "user") newestUserMessageId = shownMessages[i]!.id;
  }
  const focusedId = focus && !focus.consumed ? focus.messageId : null;
  const unreadIds = useMemo(() => unreadMessageIds(incoming, unreadDividerId), [incoming, unreadDividerId]);
  const peerUnreadOwners = useMemo(() => {
    const owners = new Set<string>();
    if (!unreadIds) return owners;
    for (const [requestId, replies] of peerGroups) {
      if (replies.some((reply) => unreadIds.has(reply.id))) owners.add(requestId);
    }
    return owners;
  }, [peerGroups, unreadIds]);
  let dividerPlaced = false;
  const dividerAbove = (rows: readonly Message[]) => {
    if (!unreadIds || dividerPlaced || !rows.some((row) => unreadIds.has(row.id) || peerUnreadOwners.has(row.id))) return null;
    dividerPlaced = true;
    return <NewMessagesDivider fading={unreadDividerFading} />;
  };
  const prevMessage = (i: number) => { const item = items[i - 1]; return item?.kind === "message" ? item.message : null; };
  const nextMessage = (i: number) => { const item = items[i + 1]; return item?.kind === "message" ? item.message : null; };
  const speakerKey = (m: Message | null) => {
    if (!m || (m.kind && m.kind !== "text")) return null;
    const peer = peerLine(m) ?? peerRequest(m, botId);
    return peer ? `peer:${peer.botId ?? peer.name}` : m.role;
  };
  const peerReplyNodes = useMemo(() => {
    const nodes = new Map<string, readonly { id: string; node: ReactNode }[]>();
    const row = (reply: Message): ReactNode => {
      if (reply.kind === "activity") return showToolCalls ? <ActivityChip message={reply} place={place} /> : null;
      return (
        <TextRow
          message={reply}
          editing={false}
          pinned={reply.id === pinnedMessageId}
          versions={lookups.editVersions(reply)}
          replyTarget={lookups.replyTarget(reply)}
          digest={digests.get(reply.id)}
          onStartEdit={onStartEdit}
          onCancelEdit={onCancelEdit}
          onSubmitEdit={onSubmitEdit}
          onRegenerate={reply.id === lastBotTextId && !reply.automation ? onRegenerate : undefined}
          retryable={reply.id === lookups.retryableId && canRetryLast}
          lastReply={reply.id === lastBotTextId}
          emerging={reply.id === emergingId}
          eagerAttachments={reply.id === newestMessageId}
          onReply={onReply}
        />
      );
    };
    for (const [requestId, replies] of peerGroups) {
      nodes.set(requestId, replies.flatMap((reply) => {
        const node = row(reply);
        return node ? [{ id: reply.id, node }] : [];
      }));
    }
    return nodes;
  }, [peerGroups, showToolCalls, pinnedMessageId, digests, lookups, place, onStartEdit, onCancelEdit, onSubmitEdit, onReply, onRegenerate, canRetryLast, lastBotTextId, emergingId, newestMessageId]);
  const placedReceived = useMemo(
    () => placeReceived(items.map((item) => (item.kind === "message" ? item.message : item.messages[0]!).at), received, { older: olderHidden, newer: false }),
    [items, received, olderHidden],
  );
  const receivedAfter = (index: number) =>
    placedReceived.filter((entry) => entry.after === index).map(({ block }) => <ReceivedWork key={`received:${block.threadId}:${block.round.asks[0]!.id}`} block={block} />);
  const withReceived = (rows: ReactNode[]) => [...receivedAfter(-1), ...rows.flatMap((row, i) => [row, ...receivedAfter(i)])];
  return (
    <>
      {withReceived(items.map((item, i) => {
        const previous = items[i - 1];
        const prev = previous && (previous.kind === "message" ? previous.message : previous.messages.at(-1));
        const first = item.kind === "message" ? item.message : item.messages[0];
        const newDay = !prev || localDay(prev.at) !== localDay(first.at);
        const divider = dividerAbove(item.kind === "message" ? [item.message] : item.messages);
        if (item.kind === "turn") {
          return (
            <div key={item.id} className="contents">
              {newDay && <DaySeparator at={first.at} today={today} />}
              {divider}
              <TurnNarrationRun
                label={advanced ? item.label : narrationLine(item.messages) ?? item.label}
                forceOpen={item.messages.some((message) => message.id === focusedId)}
              >
                {item.messages.map((message) => (
                  <div key={message.id} className="contents" data-mid={message.id}>
                    <Bubble
                      message={message}
                      editing={false}
                      pinned={message.id === pinnedMessageId}
                      onStartEdit={onStartEdit}
                      onCancelEdit={onCancelEdit}
                      onSubmitEdit={onSubmitEdit}
                      replyTarget={lookups.replyTarget(message)}
                      onReply={onReply}
                    />
                  </div>
                ))}
              </TurnNarrationRun>
            </div>
          );
        }
        if (item.kind === "run") {
          if (!showToolCalls) return divider && <div key={item.id} className="contents">{divider}</div>;
          return (
            <div key={item.id} className="contents">
              {newDay && <DaySeparator at={first.at} today={today} />}
              {divider}
              <ActivityRun messages={item.messages} forceOpen={item.messages.some((step) => step.id === focusedId)}>
                {item.messages.map((step) => (
                  <div key={step.id} className="contents" data-mid={step.id}>
                    <ActivityChip message={step} place={place} />
                  </div>
                ))}
              </ActivityRun>
            </div>
          );
        }
        const m = item.message;
        const row = (() => {
          switch (m.kind === "widget" && !m.widget ? "text" : m.kind) {
            case "secret":
              return m.secret ? <SecretRequestCard botId={botId} threadId={threadId} message={m} /> : null;
            case "signin":
              return m.signIn ? <SignInRequestCard botId={botId} botName={botName} threadId={threadId} message={m} /> : null;
            case "connector":
              return m.connector ? <ConnectorCard botId={botId} threadId={threadId} message={m} /> : null;
            case "options": {
              const optionsRow = (message: Message) =>
                optionsCardRow({ message, transcript, botId, botName, bot: owner, threadId, onCancelTurn: () => dispatch({ type: "interrupt", botId, threadId }) });
              if (approvalFolds?.folded.has(m.id)) return null;
              const memberIds = approvalFolds?.members.get(m.id);
              if (!memberIds || memberIds.length < 2) return optionsRow(m);
              const members = memberIds.flatMap((id) => messages.find((message) => message.id === id) ?? []);
              const key = approvalGroupKey(m, ownerApprovalBot)!;
              return (
                <ApprovalGroup
                  kind={approvalGroupKind(key)}
                  name={approvalRowName(m, ownerApprovalBot)}
                  members={members}
                  forceOpen={memberIds.includes(focusedId ?? "")}
                >
                  {members.map((member) => <div key={member.id} className="contents" data-mid={member.id}>{optionsRow(member)}</div>)}
                </ApprovalGroup>
              );
            }
            case "widget":
              return <MessageBoundary fallbackText={m.text ?? ""}><WidgetMessage botId={botId} threadId={threadId} message={m} /></MessageBoundary>;
            case "routine.run":
              return <RoutineRunRow message={m} botId={botId} />;
            case "call":
              return m.call ? <CallRecordRow message={m} transcript={transcript} botName={botName} threadId={threadId} busy={busy} hasMore={hasMore} /> : null;
            case "activity": {
              if (isCancelledTranscriptRow(m)) {
                return <CancelledTurnRow onRetry={m.id === lookups.retryableId && canRetryLast ? onRegenerate : undefined} />;
              }
              if (m.dataResult) return <DataResultChip message={m} />;
              const plain = !advanced && m.tool ? plainMechanicalLine(m.tool.name) : null;
              if (plain) return "say" in plain ? <PlainLineRow text={plain.say} /> : null;
              if (isStatusActivity(m)) return <StatusActivityRow message={m} />;
              if (m.tool && failedTurnCause(m.tool.name) !== null) {
                if (!advanced && recoveredAfter(transcript, transcript.indexOf(m))) return null;
                return (
                  <FailedTurnRow
                    tool={m.tool}
                    engine={engine}
                    botId={botId}
                    threadId={threadId}
                    onRetry={m.id === lookups.retryableId && canRetryLast ? onRegenerate : undefined}
                    messageId={m.id}
                    doneSteps={doneStepsBefore(transcript, transcript.indexOf(m), m.turnId)}
                    autoResume={mayAutoResume(transcript, transcript.indexOf(m))}
                  />
                );
              }
              // A post the bot made in a room reads as its own sentence here; the room shows the post itself.
              if (m.comm?.groupId && !m.threadRef) return null;
              if (!advanced && owner && isTeamHandoff(m, owner, bots)) return null;
              if (!roomActivityVisible(m, showToolCalls)) return null;
              if (handoffFolds.folded.has(m.id)) return null;
              if (!advanced && (m.comm || m.threadRef) && !plainChipShown(m)) return null;
              return (
                <>
                  <ActivityChip message={m} place={place} count={handoffFolds.counts.get(m.id)} />
                  {handoffFolds.attachments.get(m.id)?.map((line) => {
                    const files = splitMessageAttachments(line.attachments);
                    return (
                      <div key={line.messageId} data-handoff-attachments="" className="flex justify-center">
                        <AttachmentGallery images={files.images} files={files.files} message={{ threadId, messageId: line.messageId }} eager={m.id === newestMessageId} />
                      </div>
                    );
                  })}
                </>
              );
            }
            case "digest":
              return null;
            case "compaction":
              return advanced ? <CompactionChip message={m} /> : null;
            case "screen":
              if (advanced) return <ScreenFrame threadId={threadId} message={m} />;
              return nextMessage(i)?.kind === "screen" ? null : <ScreenOnRequest threadId={threadId} message={m} />;
            default: {
              return (
                <TextRow
                  message={m}
                  editing={editingId === m.id}
                  pinned={m.id === pinnedMessageId}
                  versions={lookups.editVersions(m)}
                  replyTarget={lookups.replyTarget(m)}
                  digest={digests.get(m.id)}
                  onStartEdit={onStartEdit}
                  onCancelEdit={onCancelEdit}
                  onSubmitEdit={onSubmitEdit}
                  onRegenerate={m.id === lastBotTextId && !m.automation ? onRegenerate : undefined}
                  retryable={m.id === lookups.retryableId && canRetryLast}
                  lastReply={m.id === lastBotTextId}
                  emerging={m.id === emergingId}
                  eagerAttachments={m.id === newestMessageId || m.id === newestUserMessageId}
                  onReply={onReply}
                  peerReplies={peerReplyNodes.get(m.id)}
                  blockStart={speakerKey(prevMessage(i)) !== speakerKey(m)}
                  blockEnd={speakerKey(nextMessage(i)) !== speakerKey(m)}
                />
              );
            }
          }
        })();
        if (!row) {
          // A line folded into a newer one still opens its day, or the day would lose its separator.
          const foldedAway = handoffFolds.folded.has(m.id) || Boolean(approvalFolds?.folded.has(m.id));
          return (divider || (foldedAway && newDay)) && (
            <div key={m.id} className="contents">
              {foldedAway && newDay && <DaySeparator at={m.at} today={today} />}
              {divider}
            </div>
          );
        }
        return (
          <div key={m.id} className="contents" data-mid={m.id}>
            {newDay && <DaySeparator at={m.at} today={today} />}
            {divider}
            {m.automation && <AutomationCaption message={m} line={m.automation} botId={botId} />}
            {row}
          </div>
        );
      }))}
    </>
  );
});

const CHATHEAD_PILL = "flex min-w-0 items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] py-1 pl-1.5 text-ink";

export function ChatView({ bot: profile }: { bot: Bot }) {
  const bot = useMemo(() => currentTaskBot(profile), [profile]);
  const botWork = useBotWork(bot);
  const { state, dispatch } = useStore();
  useEffect(() => {
    const live = liveThreadAway(profile.tasks, profile.threadId, profile.mainThreadId);
    if (live) dispatch({ type: "switchTask", botId: profile.id, threadId: live });
  }, [profile.id, profile.threadId, profile.mainThreadId, profile.tasks, dispatch]);
  // The presence row's "Agora" link opens the profile, where the current task now lives.
  useEffect(() => {
    const open = () => dispatch({ type: "toggleSettings", open: true });
    window.addEventListener(OPEN_WORKING_NOW, open);
    return () => window.removeEventListener(OPEN_WORKING_NOW, open);
  }, [dispatch]);
  const showThreads = useShowThreads();
  const remoteClient = window.ogb?.remoteClient?.active === true;
  const { dragProps: headerDragProps, noDragStyle: headerNoDragStyle, controlsShiftStyle } = useCaptionChrome();
  const composerDockRef = useRef<HTMLDivElement>(null);
  const botNameRef = useRef<HTMLSpanElement>(null);
  useFitName(botNameRef, bot.name);
  useComposerDockHeight(composerDockRef);
  const advanced = useAdvancedMode();
  const canWrite = useCanWriteIn(bot.threadId);

  const computerStarting = computerStartLine(state.computerStarts[bot.id], bot.name);
  const mascotMotion = state.mascotMotion?.botId === bot.id ? state.mascotMotion : null;
  const [findOpen, setFindOpen] = useState(false);
  const { replyTo, selectReply, clearReply, consumeReply } = useReplyDraft(
    bot.threadId,
    bot.messages,
  );
  useEffect(() => setFindOpen(false), [bot.threadId]);
  useChatFindRequests(bot.threadId, findOpen, setFindOpen);
  useEffect(() => {
    const onFind = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setFindOpen(true);
      }
    };
    window.addEventListener("keydown", onFind);
    return () => window.removeEventListener("keydown", onFind);
  }, []);

  const { messages: allMessages, activeLeafId } = bot;
  const liveCall = state.liveCall && state.liveCall.threadId === bot.threadId && state.liveCall.status !== "ended" ? state.liveCall : null;
  const liveStartedAt = liveCall?.startedAt;
  const messages = useMemo(() => visibleMessages({ messages: allMessages, activeLeafId }), [allMessages, activeLeafId]);
  const callHidden = useMemo(() => callTranscriptHidden(messages, liveStartedAt === undefined ? null : { startedAt: liveStartedAt }), [messages, liveStartedAt]);
  const origin = useMemo(() => conversationOrigin(messages, bot), [messages, bot]);
  const handoffOrigin = origin?.kind === "handoff" ? origin.from : null;
  const openTask = bot.tasks?.find((task) => task.threadId === bot.threadId);
  const ownTask = origin ? origin.kind === "task" : openTask?.openedBy?.botId === bot.id;
  const ownTaskTitle = awayFromMainThread(profile, showThreads) && ownTask ? openTask?.title || null : null;
  // The robot in the header waves once as its conversation opens.
  const headRobo = useRef<RoboSvg | null>(null);
  useEffect(() => { waveRobot(headRobo.current); }, [profile.id]);
  const peerView = awayFromMainThread(profile, showThreads) && handoffOrigin !== null;
  const showsReceived = !awayFromMainThread(profile, showThreads) && !peerView && (!profile.mainThreadId || profile.threadId === profile.mainThreadId) &&
    (!openTask?.openedBy || openTask.openedBy.botId === bot.id);
  const received = useReceivedWork(profile, showsReceived);
  // Remember where the person was at the moment they open a bot-to-bot conversation, so "Fechar conversa" returns there.
  useEffect(() => {
    if (peerView) return;
    const here = { botId: bot.id, threadId: bot.threadId };
    const onClick = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest("[data-thread-chip]")) peerReturn = here;
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [peerView, bot.id, bot.threadId]);
  const closePeerView = () => {
    const back = peerReturn;
    if (back && (back.botId !== bot.id || back.threadId !== bot.threadId)) openThread(dispatch, back, state, showThreads);
    else openBot(dispatch, profile, false);
  };
  useEffect(() => {
    if (!peerView) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (document.querySelector("[role=dialog], [role=menu]")) return;
      closePeerView();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  const lookups = useMemo(() => transcriptLookups(allMessages, messages), [allMessages, messages]);
  const recordedRun = useMemo(() => runSteps(messages), [messages]);
  const recordedRunCounts = runSummary(recordedRun);
  const engineSupportsAgents = Boolean(
    state.instances.find((instance) => instance.instanceId === bot.modelSelection.instanceId)?.capabilities?.agentsMcp,
  );
  const canSaveRun =
    skillAuthoringEnabled(state.config) && engineSupportsAgents && recordedRunCounts.passed > 0 && recordedRunCounts.running === 0 && !bot.busy;
  const saveRun = useMemo(() => canSaveRun ? () => {
    appendComposerDraft(`bot:${bot.id}:${bot.threadId}`, skillPrompt(recordedRun, askText(messages)));
    composerDockRef.current?.querySelector("textarea")?.focus();
  } : undefined, [canSaveRun, bot.id, bot.threadId, recordedRun, messages]);

  const {
    scrollRef,
    transcriptRef,
    transcriptKey,
    following,
    renderedMessages,
    olderPending,
    olderFailed,
    loadOlder,
    jumpToLatest,
    scrollHandlers,
  } = useTranscriptViewport({
    ownerId: bot.id,
    threadId: bot.threadId,
    messages,
    pinOn: [bot.busy],
    hasMore: bot.hasMore,
  });

  const lastBotTextId = useMemo(
    () => [...messages].reverse().find((m) => m.role === "bot" && m.kind === "text")?.id,
    [messages],
  );
  const unreadDivider = useUnreadDivider({ threadId: bot.threadId, messages, following });
  const arrivedWhileAway = useArrivedWhileAway(messages, following);

  const bots = useDrawnBots(state.bots);
  // Every bot as it is named now, this one too: a request that names it ("@Revisor …") shows its face.
  const mentionPeers = bots;
  const focus = state.focusMessage?.threadId === bot.threadId ? state.focusMessage : null;
  // The Simple chat is conversation only: tool steps stay in Advanced.
  const showToolCalls = showToolCallsEnabled(state.config) && advanced;
  const tts = state.config?.tts;
  const localVoice = localSystemVoiceActive();
  const locale = activeLocale();
  const busy = Boolean(bot.busy);
  const openedAt = useThreadOpenedAt(bot.threadId);
  const headerAnimated = busy || (mascotMotion?.kind ?? "none") !== "none";
  const branch = useRef(messages);
  branch.current = messages;
  const onBranch = useCallback((messageId: string) => branch.current.some((m) => m.id === messageId), []);
  const colorMine = useColorUserBubbles();
  const bubbleStyle = useMemo(() => (colorMine ? userBubbleStyle(bot.color) : undefined), [colorMine, bot.color]);
  const hasMore = Boolean(bot.hasMore);
  const fileVersions = useFileVersions(messages);
  const rows = useMemo<ChatRows>(
    () => ({ botId: bot.id, threadId: bot.threadId, botName: bot.name, voiceId: bot.voice, tts, localVoice, busy, hasMore, bots, mentionPeers, mentionPerson: { profileName: state.config?.profile?.name }, focus, showToolCalls, locale, dispatch, onBranch, bubbleStyle, conversational: isConversational(bot.replyStyle), canReact: canWrite !== false, openedAt, fileVersions, peerView, saveRun }),
    [bot.id, bot.threadId, bot.name, bot.voice, tts, localVoice, busy, hasMore, bots, mentionPeers, state.config?.profile?.name, focus, showToolCalls, locale, dispatch, onBranch, bubbleStyle, bot.replyStyle, canWrite, openedAt, fileVersions, peerView, saveRun],
  );
  const place = effectivePlace(bot, bot.tasks?.find((task) => task.threadId === bot.threadId));

  const [editingId, setEditingId] = useState<string | null>(null);
  useEffect(() => setEditingId(null), [bot.id, bot.threadId]);
  const startEdit = useCallback((id: string) => setEditingId(id), []);
  const cancelEdit = useCallback(() => setEditingId(null), []);
  const submitEdit = useCallback(
    (messageId: string, text: string) => {
      setEditingId(null); // closes the editor first — a double Enter can't fork twice
      dispatch({ type: "editMessage", botId: bot.id, threadId: bot.threadId, messageId, text });
    },
    [bot.id, bot.threadId, dispatch],
  );
  const [lastUserMessage, lastTypedMessage] = useMemo(() => {
    const said = messages.filter((m) => m.role === "user" && m.kind === "text" && !peerLine(m));
    return [said.at(-1), said.findLast((m) => !m.reaction)];
  }, [messages]);
  const lastTypedMessageHasAttachments = useMemo(() => {
    if (!lastTypedMessage?.text) return false;
    const cited = splitTranscriptCitations(lastTypedMessage.text);
    const attached = splitTranscriptAttachments(cited.display);
    return cited.citations.length > 0 || attached.images.length > 0 || attached.files.length > 0;
  }, [lastTypedMessage]);

  const lastMessage = lastNonReceipt(messages);
  const toolInFlight = lastMessage?.kind === "activity" && lastMessage.tool?.ok === undefined;
  const commandLine = commandPresence(messages, openTask?.steps);
  const presencePlace = toolInFlight && lastMessage?.tool && !commandLine ? (isBrowserGoalTool(lastMessage.tool.name, lastMessage.tool.input) ? "browser" : toolPlace(lastMessage.tool.name, place)) : null;
  const inBrowser = presencePlace === "browser";
  const activity = commandLine ?? (inBrowser ? { phase: "chat.activity.working", phrases: [t("chat.activity.working")] } : liveActivityPhrases(lastMessage));
  const waiting = Boolean(
    bot.busy &&
      bot.activity !== "waiting-on-you" &&
      showWorkingDots(bot.busy, lastMessage),
  );
  const wasWaiting = useRef(false);
  const [popping, setPopping] = useState<string | null>(null);
  const poppingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (poppingTimer.current) clearTimeout(poppingTimer.current);
  }, []);
  useLayoutEffect(() => {
    if (poppingTimer.current) clearTimeout(poppingTimer.current);
    poppingTimer.current = null;
    wasWaiting.current = false;
    setPopping(null);
  }, [bot.id]);
  useEffect(() => {
    if (waiting) wasWaiting.current = true;
  }, [waiting]);
  useLayoutEffect(() => {
    if (lastMessage?.role !== "bot" || lastMessage.kind !== "text" || lastMessage.quickAck || !wasWaiting.current) return;
    wasWaiting.current = false;
    const messageId = lastMessage.id;
    if (poppingTimer.current) clearTimeout(poppingTimer.current);
    setPopping(messageId);
    poppingTimer.current = setTimeout(() => {
      poppingTimer.current = null;
      setPopping((current) => current === messageId ? null : current);
    }, 520);
  }, [lastMessage?.id, lastMessage?.role, lastMessage?.kind]);
  const presenceVisible = waiting || popping !== null;
  const announcement = useMemo((): TranscriptSnapshot => {
    const approval = pendingApprovals(messages)[0];
    return {
      busy: Boolean(bot.busy),
      reply: latestReply(messages, () => bot.name),
      failure: latestFailure(messages, () => bot.name),
      approval: approval ? { id: approval.requestId, name: bot.name } : undefined,
    };
  }, [messages, bot.busy, bot.name]);
  const [busySince, setBusySince] = useState<number | null>(null);
  useEffect(() => {
    setBusySince(bot.busy ? bot.turnStartedAt ?? Date.now() : null);
  }, [bot.busy, bot.id, bot.threadId, bot.turnStartedAt]);

  const regenerate = useCallback(() => {
    if (lastUserMessage?.text && !bot.busy && !lastUserMessage.id.startsWith("optimistic-")) {
      dispatch({ type: "editMessage", botId: bot.id, threadId: bot.threadId, messageId: lastUserMessage.id, text: lastUserMessage.text });
    }
  }, [lastUserMessage, bot.busy, bot.id, bot.threadId, dispatch]);

  const currentLink = profile.tasks?.find((task) => task.threadId === bot.threadId)?.link;
  const threadLink = useMemo(() => canWrite !== false
    ? { link: currentLink, assign: (link: string | null) => dispatch({ type: "updateTask", botId: bot.id, threadId: bot.threadId, patch: { link } }) }
    : null, [canWrite, currentLink, bot.id, bot.threadId, dispatch]);

  // A run's conversation that has become the bot's main one (someone wrote there) is just the conversation now.
  const routineExecution = bot.threadId === profile.mainThreadId
    ? undefined
    : state.routineRuns.find((run) => run.target === "bot" && run.botId === bot.id && run.threadId === bot.threadId);
  const conversationThreadId = profile.mainThreadId && profile.tasks?.some((task) => task.threadId === profile.mainThreadId)
    ? profile.mainThreadId
    : profile.tasks?.find((task) => !task.routineRunId && task.threadId !== bot.threadId)?.threadId;
  const backToConversation = useCallback(() => {
    if (conversationThreadId) dispatch({ type: "switchTask", botId: profile.id, threadId: conversationThreadId });
  }, [conversationThreadId, dispatch, profile.id]);
  useEffect(() => {
    if (!routineExecution) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || document.querySelector("[role=dialog], [role=menu]")) return;
      backToConversation();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [routineExecution, backToConversation]);

  return (
    <ThreadLinkContext value={threadLink}>
    <main className="relative flex h-full min-w-0 flex-1 flex-col bg-app">
      <CallOverlay bot={bot} />
      <GlassScrollFrame className="flex-1 [--glass-tint:var(--color-app)]">
      {/* z-[25]: above the room set-up card (z-20), below the CallOverlay (z-30). */}
      <GlassBar edge="top" className="z-[25]" data-chat-topbar="">
      <div
        {...headerDragProps}
        data-chat-head=""
        className={cn(
          // A container query never matches the container itself, so the row that wraps is the child below.
          "@container/chathead px-5 py-3",
          "pl-11 md:pl-5",
        )}
      >
        {peerView && handoffOrigin && (
          <PeerConversationPill
            from={{ name: handoffOrigin.name, bot: state.bots.find((candidate) => candidate.id === handoffOrigin.botId) ?? state.bots.find((candidate) => candidate.name === handoffOrigin.name) }}
            to={{ name: bot.name, bot }}
          />
        )}
        {ownTaskTitle && <TaskConversationTitle title={ownTaskTitle} />}
        {!peerView && !bot.busy && bot.waitingForTeammates && (
          <div className="flex justify-center pb-2">
            <span
              data-chathead-worker=""
              role="status" onClick={bot.waitingOn?.[0]?.onPerson ? () => dispatch({ type: "switchTask", botId: bot.waitingOn![0]!.botId, threadId: bot.waitingOn![0]!.threadId }) : undefined}
              title={botWork?.team[0] ? teammateLine(botWork.team[0]) : undefined}
              className={cn("max-w-[min(100%,36rem)] truncate text-center text-[12.5px] text-ink-secondary", bot.waitingOn?.[0]?.onPerson && "cursor-pointer text-warning underline-offset-2 hover:underline")}
            >
              {botWork?.team[0] && !bot.waitingOn?.[0]?.onPerson ? teammateLine({ ...botWork.team[0], title: undefined }) : waitingOnLabel(bot.waitingOn, t("chat.teammatesWorking"))}
            </span>
          </div>
        )}
        <div data-chathead-row className={cn("flex items-center justify-between @max-[30rem]/chathead:flex-wrap @max-[30rem]/chathead:gap-y-1 @min-[30rem]/chathead:grid @min-[30rem]/chathead:grid-cols-[minmax(0,1fr)_minmax(0,auto)_minmax(max-content,1fr)]")} style={peerView ? { display: "none" } : undefined}>
        <div data-chathead-identity className="relative flex min-w-0 items-center gap-2 @max-[30rem]/chathead:basis-full @min-[30rem]/chathead:col-start-2 @min-[30rem]/chathead:justify-self-center" style={headerNoDragStyle}>
          {advanced ? (
            <div data-chathead-pill className={cn(CHATHEAD_PILL, "pr-1")}>
              <button
                type="button"
                data-preload="bot-settings"
                onClick={() => dispatch({ type: "toggleSettings", open: true })}
                className="flex shrink-0 items-center justify-center rounded-full"
                title={t("chat.openProfile")}
                aria-label={t("chat.openProfileAria", { name: bot.name })}
              >
                <BotAvatar
                  bot={bot}
                  roboRef={headRobo}
                  state={stateForBot({ ...bot, messages })}
                  size={24}
                  motion={mascotMotion?.kind ?? "none"}
                  motionKey={mascotMotion?.nonce ?? 0}
                  animated={headerAnimated}
                />
              </button>
              <RenameTitle
                value={bot.name}
                onCommit={(name) => {
                  if (window.ogb?.remoteClient?.active) {
                    void api(`/api/bots/${bot.id}/profile`, { method: "PATCH", body: JSON.stringify({ name }) })
                      .then(({ bot: updated }) => dispatch({ type: "botPatched", bot: updated }))
                      .catch((cause) => dispatch({ type: "error", message: cause instanceof Error ? cause.message : String(cause) }));
                  } else {
                    dispatch({ type: "updateBot", botId: bot.id, patch: { name } });
                  }
                }}
                onActivate={() => dispatch({ type: "toggleSettings", open: true })}
                showEditButton
                className="nb-name truncate text-[14px] text-ink"
                editButtonClassName="size-6 rounded-full"
                inputClassName="max-w-[220px] rounded-full bg-inset px-2 py-0.5 text-[14px] font-medium normal-case tracking-normal"
              />
              {chiefOfStaffBadge(bot)}
              {botWork && (
                <button type="button" onClick={() => dispatch({ type: "toggleSettings", open: true })} title={t("workingNow.open", { name: bot.name })} aria-label={t("workingNow.open", { name: bot.name })} className="rounded-full px-1.5 py-2">
                  <TaskDots />
                </button>
              )}
            </div>
          ) : (
            <button
              type="button"
              data-chathead-pill data-tour="bot-pill"
              data-preload="bot-settings"
              // Nordus: the name always opens the profile panel; while the bot works, "Agora" sits at its top.
              onClick={() => dispatch({ type: "toggleSettings", open: true })}
              title={botWork ? t("workingNow.open", { name: bot.name }) : t("chat.openProfile")}
              aria-label={botWork ? t("workingNow.open", { name: bot.name }) : t("chat.openProfileAria", { name: bot.name })}
              className={cn(CHATHEAD_PILL, "pr-3.5 hover:bg-raised-hover")}
            >
              <BotAvatar
                bot={bot}
                roboRef={headRobo}
                state={stateForBot({ ...bot, messages })}
                size={24}
                motion={mascotMotion?.kind ?? "none"}
                motionKey={mascotMotion?.nonce ?? 0}
                animated={headerAnimated}
              />
              <span className="flex min-w-0 flex-col items-start">
                <span ref={botNameRef} data-fit-name="" className="nb-name min-w-0 truncate text-[14px] leading-[18px] text-ink">{bot.name}</span>
                {botWork && <TaskDots />}
              </span>
              {chiefOfStaffBadge(bot)}
              <ChevronRight size={14} aria-hidden="true" className="-ml-2.5 w-0 shrink-0 text-ink-secondary opacity-0 transition-[width,margin,opacity] duration-150 group-hover:ml-0 group-hover:w-3.5 group-hover:opacity-100 group-focus-visible:ml-0 group-focus-visible:w-3.5 group-focus-visible:opacity-100" />
            </button>
          )}
          {canWrite !== false && <NewThreadButton bot={profile} iconOnly />}
          <span role="status" className="sr-only" data-chathead-status>{bot.busy ? t("sidebar.preview.working") : ""}</span>
          {awayFromMainThread(profile, showThreads) && handoffOrigin && (
            <span data-chathead-handoff className="truncate text-[12px] text-ink-secondary">
              {t("handoff.header", { from: handoffOrigin.name, to: bot.name })}
            </span>
          )}
        </div>
        <div
          data-chathead-controls
          className="flex shrink-0 items-center gap-2 @max-[30rem]/chathead:ml-auto @max-[30rem]/chathead:flex-wrap @max-[30rem]/chathead:justify-end @min-[30rem]/chathead:col-start-3 @min-[30rem]/chathead:justify-self-end"
          style={controlsShiftStyle}
        >
          {advanced && (bot.busy || bot.waitingForTeammates) && (
            <button
              onClick={() => dispatch({ type: "interrupt", botId: bot.id, threadId: bot.threadId })}
              className={cn(
                "flex items-center gap-1.5 rounded-full border border-hairline/40 bg-raised/60 px-2.5 py-1 text-[13px] text-ink-secondary hover:bg-raised hover:text-ink",
                COMPACT_BUBBLE,
              )}
              title={t("chat.stopTurn")}
            >
              <Square size={12} className="fill-current" />
              <span className="@max-4xl/chathead:hidden">{t("chat.stop")}</span>
            </button>
          )}
          <ChatModelSwitch bot={bot} threadId={bot.threadId} />
          <ThreadContextWarning bot={bot} messages={messages} quietMeter={advanced} />
          {advanced && <EngineLimitNotice engine={bot.modelSelection?.instanceId} />}
          <LiveCallChip currentBotId={bot.id} onOpen={(botId, threadId) => openThread(dispatch, { botId, threadId }, state, showThreads)} />
          <button
            data-tour="computer"
            data-preload="computer"
            data-chathead-phone-hide=""
            onClick={(event) => { if (!state.computerOpen) rememberComputerPanelOpen({ botId: bot.id, opener: event.currentTarget, tabs: event.detail === 0 }); dispatch({ type: "toggleComputer" }); }}
            className={cn(
              "relative rounded-md p-1.5 hover:bg-raised",
              state.computerOpen ? "text-accent" : "text-ink-secondary hover:text-ink",
            )}
            title={t("chat.computer")} aria-label={busy && place === "browser" ? `${t("chat.computer")}, ${t("place.live")}` : t("chat.computer")}
          >
            <Monitor size={18} />{busy && place === "browser" && <span aria-hidden="true" className="absolute right-1 top-1 size-1.5 animate-pulse rounded-full bg-success" data-testid="computer-button-live" />}
          </button>
          <span data-chathead-phone-hide="" className="contents"><NotificationsHeaderButton unreadOnly /></span>
          <ChatHeaderMenu key={`menu:${bot.threadId}`} bot={bot} messages={messages} findOpen={findOpen} onFind={() => setFindOpen((open) => !open)} />
        </div>
        </div>
      </div>

      <BotActivityPicker bot={bot} />
      {routineExecution && <div data-routine-execution-bar="" className="mx-5 mb-2 flex flex-wrap items-center gap-2 rounded-[12px] border border-hairline/40 bg-inset px-2 py-1.5 text-[12px] text-ink-secondary">
        <button type="button" onClick={backToConversation} className="flex items-center gap-1 rounded-[9px] bg-ink/[0.07] px-2.5 py-1 font-medium text-ink hover:bg-ink/[0.12]">
          <ChevronLeft size={14} aria-hidden="true" />{t("routines.backToConversation")}
        </button>
        <span className="min-w-0 flex-1 truncate">{t("routines.executionDetails", { name: routineExecution.routineName })}</span>
        <button type="button" onClick={() => dispatch({ type: "showRoutines", section: "logs", routineId: routineExecution.routineId, botId: bot.id })} className="rounded px-2 py-1 hover:bg-raised hover:text-ink">{t("routines.logs")}</button>
      </div>}
      {findOpen && <ChatFindBar threadId={bot.threadId} onClose={() => setFindOpen(false)} />}
      <WhatItDidPanel />

      <ChatErrorBanner message={state.error} onDismiss={() => dispatch({ type: "error", message: null })} />
      <ChatNotice notice={state.notice} />

      <PinnedBanner
        bot={bot}
        pinnedId={bot.pinnedMessageId}
        messages={messages}
        onJump={(messageId) =>
          dispatch({ type: "focusMessage", threadId: bot.threadId, messageId })
        }
        onUnpin={remoteClient ? undefined : () =>
          dispatch({ type: "updateTask", botId: bot.id, threadId: bot.threadId, patch: { pinnedMessageId: "" } })
        }
      />
      <LiveCallBar bot={bot} placement="top" />
      </GlassBar>

      <div
        ref={scrollRef}
        className="glass-scroller h-full overflow-x-hidden overflow-y-auto overscroll-y-contain px-5 [overflow-anchor:none]"
        {...scrollHandlers}
      >
        <div
          ref={transcriptRef}
          className="glass-scroller-content chat-column flex w-full flex-col gap-3"
          style={{ paddingBottom: TRANSCRIPT_END_PAD }}
          role="log"
          // off: a polite log re-reads every tick and chip while the bot works; TranscriptAnnouncer speaks once when
          // done.
          aria-live="off"
          aria-label={t("chat.conversationWith", { name: bot.name })}
        >
          {olderPending ? (
            <SkeletonMessages />
          ) : olderFailed ? (
            <div className="flex flex-col items-center gap-1 py-3 text-xs text-ink-tertiary" role="status">
              <span>{t("chat.loadEarlierFailed")}</span>
              <button type="button" onClick={loadOlder} className="ui-pill">{t("chat.loadEarlier")}</button>
            </div>
          ) : null}
          {renderedMessages.length === 0 && !bot.busy && <EmptyChat bot={bot} />}
          <ChatRowsContext.Provider value={rows}>
            <MessagesList
              messages={callHidden.size ? renderedMessages.filter((message) => !callHidden.has(message.id)) : renderedMessages}
              transcript={messages}
              lookups={lookups}
              place={place}
              pinnedMessageId={bot.pinnedMessageId}
              today={localDay(Date.now())}
              editingId={editingId}
              lastBotTextId={lastBotTextId}
              emergingId={popping}
              canRetryLast={!bot.busy && Boolean(lastUserMessage)}
              engine={state.instances.find((i) => i.instanceId === bot.modelSelection.instanceId)}
              unreadDividerId={unreadDivider.messageId}
              unreadDividerFading={unreadDivider.fading}
              received={received}
              olderHidden={Boolean(bot.hasMore)}
              onStartEdit={startEdit}
              onCancelEdit={cancelEdit}
              onSubmitEdit={submitEdit}
              onRegenerate={regenerate}
              onReply={selectReply}
            />
          </ChatRowsContext.Provider>
          <ReplyDraftBubble threadId={bot.threadId} messages={messages} />
          {computerStarting && (
            <div className="flex justify-start">
              <div className="ui-pill">
                <WorkingDots size={3.5} />
                {computerStarting}
              </div>
            </div>
          )}
          <TurnPresence
            avatar={
              <BotAvatar
                bot={bot}
                state={toolInFlight ? "working" : "thinking"}
                size={36}
                forward={false}
                lookAround={1}
                trackPointer={false}
              />
            }
            visible={presenceVisible}
            phrases={advanced ? activity.phrases : [simpleWorkingLine(openTask?.steps)]}
            phase={advanced ? activity.phase : `simple:${simpleWorkingLine(openTask?.steps)}`}
            seed={`${bot.id}:${bot.threadId ?? ""}:${busySince ?? ""}`}
            answering={popping !== null}
            names={advanced ? [bot.name] : []}
            since={advanced ? commandLine?.since : null}
            turnSince={busySince}
            place={advanced && inBrowser ? "browser" : null}
            goal={advanced ? runningGoal(messages) : null}
          />
        </div>
      </div>

      <TranscriptAnnouncer threadKey={transcriptKey} snapshot={announcement} />

      <div ref={composerDockRef} data-composer-dock="" className="pointer-events-none absolute inset-x-0 bottom-0 z-[2] chat-column-dock">
      {!peerView && <FloatingBrowser bot={bot} />}
      {!following && (
        <div className="relative">
          <JumpToLatestButton onClick={jumpToLatest} className="pointer-events-auto bottom-2" count={arrivedWhileAway} />
        </div>
      )}
      <LiveCallBar bot={bot} />
      <OtherThreadApproval bot={profile} />
      {awayFromMainThread(profile, showThreads) && !peerView && !routineExecution && !bot.tasks?.find((task) => task.threadId === bot.threadId)?.importedFrom && (
        <div className="pointer-events-auto flex justify-center pb-2">
          <button
            type="button"
            data-back-to-conversation=""
            onClick={() => openBot(dispatch, profile, false)}
            className="nb-pill rounded-full px-4 py-1.5 text-[12.5px] font-medium text-ink-secondary transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            {t("chat.backToMainThread")}
          </button>
        </div>
      )}
      {bot.tasks?.find((task) => task.threadId === bot.threadId)?.importedFrom ? (
        <ImportedHistoryBar onBack={() => openBot(dispatch, profile, false)} />
      ) : peerView ? (
        <ClosePeerConversation onClose={closePeerView} />
      ) : canWrite === false ? (
        <NewConversationInstead onNew={() => dispatch({ type: "newTask", botId: bot.id })} />
      ) : routineExecution && conversationThreadId ? (
        <div className="pointer-events-auto px-5 pb-4">
          <button
            type="button"
            data-routine-composer=""
            onClick={() => {
              backToConversation();
              setTimeout(() => composerDockRef.current?.querySelector("textarea")?.focus(), 60);
            }}
            className="flex w-full items-center rounded-3xl bg-composer px-5 py-3.5 text-left text-[15px] text-ink-tertiary ring-1 ring-composer-ring hover:text-ink-secondary"
          >
            {t("routines.writeInConversation", { name: bot.name })}
          </button>
        </div>
      ) : (
      <Composer
        key={bot.threadId}
        bot={profile}
        replyTo={replyTo}
        onClearReply={clearReply}
        onConsumeReply={consumeReply}
        onEditLast={lastTypedMessage && !lastTypedMessageHasAttachments && !bot.busy && !lastTypedMessage.id.startsWith("optimistic-")
          ? () => setEditingId(lastTypedMessage.id)
          : undefined}
      />
      )}
      {canWrite !== false && (
      <CitationSelectionToolbar
        key={`${bot.id}:${bot.threadId}`}
        viewportRef={scrollRef}
        onAdd={(citation) => appendDraftAttachments(`bot:${citation.source.ownerId}:${citation.source.threadId}`, [citation])}
      />
      )}
      </div>
      </GlassScrollFrame>

    </main>
    </ThreadLinkContext>
  );
}

export function NewConversationInstead({ onNew }: { onNew: () => void }) {
  return (
    <div className="pointer-events-auto mx-5 mb-4 flex items-center justify-between gap-3 rounded-2xl border border-hairline/60 bg-raised px-4 py-3" data-testid="cloud-guest-composer">
      <p className="text-[13px] text-ink-secondary">{t("chat.cloudGuest.notYours")}</p>
      <button type="button" onClick={onNew} className="shrink-0 rounded-full bg-accent px-3 py-1 text-[13px] font-medium text-white">
        {t("chat.cloudGuest.newConversation")}
      </button>
    </div>
  );
}
