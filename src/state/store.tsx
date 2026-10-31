import { registerListLoader, type LazyListKey } from "./lazy-lists";
import { MCP_HEALTH_EVENT } from "@/lib/mcp-health-event";
import { cloudAsleep, onCloudPower } from "../lib/cloud-power";
import { api, ApiError } from "./api";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import type { BotAudience, BotVisibility, CardAnswerer, CloudBackend, ConnectorToolGrant, EffortLevel, InstalledPackageMetadata, LiveCallState, ServerFrame, GroupThreadUsage, SteerQueueReason, WireGroup, OptionCardData as WireOptionCard } from "../../shared/wire";
import { movesThreadToTop } from "../../shared/wire";
import { applyDraftFrame, clearDrafts, runtimeFrameAction } from "./runtime-frames";
import { DATA_ROUTES, type DataSheet, type DataTable } from "../../shared/data-surface";
import type { NotificationLogEntry } from "../../shared/notification";
import { reduceNotificationFeed, type NotificationFeedAction } from "./notification-feed";
import { bumpThreadUpdatedAt, mergeTaskStamps, rewindThreadUpdatedAt } from "./thread-stamps";
import { sessionIsGuest } from "@/lib/viewer";
import { botOpensTo, openBot, openNotificationTarget, visibleNotificationThread } from "./thread-navigation";
import { patchGroupTask } from "./thread-edits";
import { savedStateAction, type SavedOwner, type SavedSnapshot } from "./saved-state";
export { awayFromMainThread, botOpensTo, openBot, openBotThread, openNotificationTarget, openThread, openWhereBotWaits, visibleNotificationThread, type ThreadTarget } from "./thread-navigation";
import type { TurnDigest } from "../../shared/digest";
import type { ToolScope } from "../../shared/tool-scope";
import type { TeamLeadPolicy } from "../../shared/team-lead";
import type { ModelVariantOption, RuntimeEvent } from "../../shared/runtime-events";
import type { CritterColor, CritterMotion } from "@/lib/mascot";
import type { BotAvatarCrop } from "../../shared/bot-avatar";
import { approvalModeFor, type ApprovalMode } from "../../shared/approval-mode";
import { desktopCapabilitiesNow } from "@/lib/desktop";
import { preloadAvatars } from "@/lib/avatar-preload";
import { sameModelSelection } from "../../shared/thread-model";
import type { BotBodyId } from "../../shared/bot-body";
import type { QuestionRequestCardData } from "../../shared/ask-question";
import type { ProfileRequestCardData } from "../../shared/profile-request";
import type { ModelRequestCardData } from "../../shared/model-request";
import type { RoutineRequestCardData } from "../../shared/routine-request";
import type { RoutineRunCardData } from "../../shared/routine-run";
import type { GroupGoalRunCardData } from "../../shared/group-goal-run";
import type { PlaceRow } from "../../shared/place-view";
import {
  reviewedSkillSha256,
  skillRequestBehavior,
  type SkillRequestCardData,
} from "../../shared/skill-request";
import type { Routine, RoutineInput, RoutineRun, RoutineRunStatusFilter } from "@/lib/routines";
import type { WebhookAttempt, WebhookIngressStatus, WebhookTrigger } from "@/lib/webhooks";
import { duplicateBotProfile, restrictedCopyRequest } from "@/lib/bot-duplicate";
import { botShowsUnread, hiddenUnreadThreads } from "@/lib/bot-unread";
import { firstUnreadMessageId, threadOpensUnread, threadReadCursor } from "@/lib/unread-divider";
import type { ComputerStart } from "@/lib/computer-start";
import { parseComputerHelp } from "@/lib/computer-control";
import { answerResponse, dismissResponse } from "@/lib/card-answer";
import { currentCall } from "@/lib/call";
import { readLastConversation, rememberConversation } from "@/lib/last-conversation";
import { LIST_PREVIEW_MESSAGES, STARTUP_MESSAGES, hasEarly, takeEarly } from "@/lib/early-requests";
import { readLastBotSection, rememberBotSection } from "@/lib/last-bot-section";
import { showNotification, type NotificationTarget } from "@/lib/notify";
import { enablePush, onNotificationOpen, registerServiceWorker, startPushPresence, takeNotificationTarget } from "@/lib/web-push";
import { finishedNotificationsEnabled, notificationSoundsEnabled } from "@/lib/notification-preferences";
import { useShowThreads } from "@/lib/thread-preferences";
import { adoptsMessageLeaf } from "@/lib/branch-leaf";
import { speaker } from "@/lib/tts";
import { roleProfilePatch, type BotRole } from "@/lib/bot-roles";
import { t } from "@/lib/i18n";
import { showToast } from "@/lib/toast";
import { createBotPatchQueue, type BotUpdatePatch } from "./bot-patch-queue";
import { useChatErrorClear } from "./chat-error";
import { applyConfig, configOnce, resetConfigCache } from "@/lib/config-cache";
import { openLiveEvents, publishLiveFrame, publishMissedFrames } from "@/lib/live-events";
import { noteServedBuild } from "@/lib/page-build";
import { trimRoutineRuns } from "./routine-runs";
import { signedOutWatch } from "@/lib/signed-out";
import { applyScrollbackPage, beginScrollbackPage, bumpTranscriptGeneration, bumpTranscriptGenerations, foldConfirmedMessage, mergedHasMore, mergeSnapshotTranscript, mergeTranscriptLeaf, mergeTranscriptRows, movedBranchTranscript, optimisticMessageId, optimisticUserMessage } from "@/lib/transcript-merge";

export type { CritterColor } from "@/lib/mascot";
export type { RoutineRunCardData } from "../../shared/routine-run";

export interface OptionCardData extends Pick<WireOptionCard, "fixedOptions" | "webhookRequest" | "appTriggerRequest" | "byText" | "approval"> {
  title: string;
  subtitle: string;
  options: string[];
  requestType?: "permission" | "question";
  optionHints?: Record<string, string>;
  multiSelect?: boolean;
  answered?: string;
  answeredText?: string;
  answeredBy?: CardAnswerer;
  answeredAt?: number;
  dismissed?: boolean;
  requestId?: string;
  tool?: string;
  /** permission cards: what the action does, in plain Portuguese, for the title. */
  intent?: string;
  /** permission cards: what the bot wants and why, in its own words. */
  explanation?: string;
  held?: string;
  expired?: boolean;
  heldCode?: string;
  allowKey?: string;
  allowSession?: boolean;
  commandAllowlist?: { command: string; cwd: string; providerInstanceId: string };
  approvalScope?: "local-computer";
  canReleaseTask?: true;
  releasedTask?: true;
  autoApplied?: boolean;
  undone?: boolean;
  routineRequest?: RoutineRequestCardData;
  skillRequest?: SkillRequestCardData;
  outboundRequest?: { tool: string; app: string | null; calls?: Array<{ app: string | null; label: string }> };
  teamMemoryRequest?: { section: string; entryId: string; kind: string; revision?: string };
  lessonRequest?: { lesson: string; client?: string };
  profileRequest?: ProfileRequestCardData;
  modelRequest?: ModelRequestCardData;
  appSettingRequest?: import("../../shared/app-setting-request").AppSettingRequestCardData;
  mcpServerRequest?: import("../../shared/mcp-server-request").McpServerRequestCardData;
  teamSetupRequest?: import("../../shared/team-setup").TeamSetupRequest;
  questionRequest?: QuestionRequestCardData;
}

export interface ConnectorCardData {
  slug: string;
  label: string;
  description: string;
  status: "required" | "authorizing" | "connected" | "failed";
  resumeKey: string;
  alias?: string;
  error?: string;
  dismissed?: boolean;
  resumed?: boolean;
  stopped?: boolean;
}

export interface SecretRequestCardData {
  target: import("../../shared/credential-request").CredentialTargetId | import("../../shared/env-secret").EnvSecretTarget;
  envName?: string;
  envScope?: import("../../shared/env-secret").EnvSecretScope;
  envPurpose?: string;
  label: string;
  description: string;
  placeholder: string;
  helpUrl: string;
  requestKey: string;
  provided?: boolean;
  dismissed?: boolean;
  superseded?: boolean;
  resumed?: boolean;
  error?: string;
  stopped?: boolean;
}

export type ComputerControlState = { held: boolean; helpReason: string | null; help?: import("../../shared/wire").ComputerHelpRef | null };

export interface Message extends Pick<import("../../shared/wire").WireMessage, "widget" | "routedBy" | "quickModel" | "quickAck" | "fromTask" | "streamId" | "interrupted" | "automation" | "textAsk" | "answersAsk" | "sender"> {
  id: string;
  role: "bot" | "user";
  kind: "text" | "options" | "activity" | "screen" | "connector" | "secret" | "signin" | "routine.run" | "goal.run" | "digest" | "compaction" | "call" | "widget";
  text?: string;
  digest?: TurnDigest;
  compaction?: import("../../shared/wire").WireMessage["compaction"];
  attachments?: import("@/lib/turn-attachments").ShownAttachment[];
  card?: OptionCardData;
  connector?: ConnectorCardData;
  secret?: SecretRequestCardData;
  signIn?: import("../../shared/wire").SignInRequestCardData;
  routineRun?: RoutineRunCardData;
  goalRun?: GroupGoalRunCardData;
  call?: import("../../shared/wire").LiveCallRecord;
  channelMode?: "chat" | "goal";
  tool?: { name: string; ok?: boolean; spoken?: string; setup?: boolean; claudeUpdate?: boolean; place?: PlaceRow; limitResetsAt?: number; error?: import("../../shared/turn-error").TurnError; summary?: string; input?: string; output?: string ; itemId?: string; outputPath?: string; fullResult?: boolean; approved?: boolean; awaitingApproval?: boolean; cancelled?: boolean };
  steered?: boolean;
  via?: "api" | "call";
  callId?: string;
  requestMessageId?: string;
  turnId?: string;
  turnTerminal?: boolean;
  turnSucceeded?: boolean;
  turnCompletedAt?: number;
  optimisticThreadOrderAt?: number;
  hasImage?: boolean;
  png?: string;
  mime?: string;
  at: number;
  parentId?: string | null;
  replyToId?: string;
  sendId?: string;
  from?: { botId: string; name: string; color: CritterColor };
  peerAsk?: { botId: string; name: string; unattended?: boolean; incident?: { threadId: string; notified?: boolean } };
  roomRequest?: { id: string; phase: "request" | "result"; awaited?: boolean };
  reactions?: import("../../shared/wire").WireMessage["reactions"];
  reaction?: string;
  comm?: { groupId: string; threadId?: string; withBotId: string; withName: string; withColor: CritterColor };
  threadRef?: import("../../shared/wire").WireMessage["threadRef"];
  dataResult?: import("../../shared/wire").WireMessage["dataResult"];
  queued?: boolean;
  queueId?: string;
}

export type GroupDefaultResponder = import("../../shared/wire").GroupDefaultResponder;

export interface Group extends Pick<WireGroup, "memberContext" | "queue" | "general" | "people" | "createdBy"> {
  usage?: GroupThreadUsage | null;
  id: string;
  threadId: string;
  name: string;
  memberIds: string[];
  defaultResponder: GroupDefaultResponder;
  bulletin: string;
  description?: string;
  avatarUrl?: string;
  favoriteMessageIds?: string[];
  unread: boolean;
  lastReadMessageId?: string;
  createdAt: number;
  dm?: boolean;
  busyBotId?: string | null;
  turnStartedAt?: number | null;
  steps?: import("../../shared/work-steps").WorkStepLine[];
  working?: boolean;
  cwd?: string;
  pinnedCwd?: string | null;
  pinnedMessageId?: string;
  section?: string;
  setupCompletedAt?: number | null;
  setupSkippedAt?: number | null;
  turnTimeoutMinutes?: number | null;
  conversation?: boolean;
  holds?: Record<string, import("../../shared/wire").RoomHold>;
  heldMessages?: Record<string, import("../../shared/wire").RoomHeldMessage[]>;
  tasks?: GroupTask[];
  /** Nordus: the client this room is for (wire `client`); null right after the room panel clears it. */
  client?: string | null;
  messages: Message[];
  hasMore?: boolean;
}

export interface GroupTask {
  importedFrom?: "grok";
  threadId: string;
  title: string;
  createdAt: number;
  pinnedCwd?: string | null;
  pinnedMessageId?: string;
  pinned?: boolean;
  updatedAt?: number;
  turnTimeoutMinutes?: number;
  lastThreadOrderAt?: number;
  working?: boolean;
  busyBotId?: string | null;
  steps?: import("../../shared/work-steps").WorkStepLine[];
  /** Nordus: the clients this room conversation named, when the room has no client of its own. */
  clients?: string[];
}

export interface ModelSelection {
  instanceId: string;
  model: string;
  effort?: EffortLevel;
  variant?: string;
}

export interface Task {
  importedFrom?: "grok";
  /** Nordus: what the bot is doing now, in plain words, and the thing it works on. */
  doing?: string;
  /** Nordus: the clients this conversation works for; sticky until another is named. */
  clients?: string[];
  doingObject?: string;
  /** Nordus: the steps of the turn running here, oldest first. */
  steps?: import("../../shared/work-steps").WorkStepLine[];
  /** Nordus: the task's steps across turns and teammates, with its plan, credits and place. */
  journal?: import("../../shared/work-steps").WorkJournal;
  waitingForTeammates?: boolean; waitingOn?: import("../../shared/waiting-on").WaitingOn[];
  threadId: string;
  routineRunId?: string;
  projectId?: string;
  title: string;
  createdAt: number;
  pinned?: boolean;
  link?: string;
  updatedAt?: number;
  lastThreadOrderAt?: number;
  attentionAt?: number;
  usage?: TaskUsage;
  cacheKeepWarm?: import("../../shared/wire").CacheKeepWarmStatus;
  cwd?: string | null;
  modelSelection?: ModelSelection;
  followsBotModel?: boolean;
  approvalMode?: ApprovalMode;
  autoApprove?: boolean;
  alwaysAllow?: string[];
  activity?: Bot["activity"];
  busy?: boolean;
  turnStartedAt?: number;
  unread?: boolean;
  lastReadMessageId?: string;
  pinnedMessageId?: string;
  surface?: "cloud" | "vm" | "local" | "browser";
  surfaceAuto?: true;
  openedBy?: ThreadOpener;
  closedBy?: ThreadCloser;
  archivedAt?: number;
  snoozedUntil?: number;
  releasedAt?: number;
}

export interface ThreadOpener {
  botId: string;
  name: string;
  delegationId?: string;
  kind?: "pair" | "work";
  threadId?: string;
  /** A room job's thread: it belongs to its room, not to the bot's own conversations. */
  roomLane?: true;
  at: number;
}

export interface ThreadCloser {
  botId: string;
  name: string;
  at: number;
}

export interface TaskUsage {
  input: number;
  output: number;
  cachedInput?: number;
  costUsd: number | null;
  turns: number;
  lastTurn?: { input: number; output: number; cachedInput?: number; costUsd: number | null };
  context?: { tokens: number; window?: number };
}

export interface Bot {
  toolScope?: ToolScope;
  waitingForTeammates?: boolean; waitingOn?: import("../../shared/waiting-on").WaitingOn[];
  id: string;
  threadId: string;
  mainThreadId?: string;
  tasks?: Task[];
  projects?: BotProject[];
  name: string;
  title: string;
  tag?: string;
  description: string;
  soul?: string;
  soulDrift?: boolean;
  notifications: boolean;
  color: CritterColor;
  mascotExpression?: string | null;
  mascotBody?: BotBodyId | null;
  robot?: import("../../shared/wire").WireRobotLook | null;
  avatarUrl?: string | null;
  avatarCrop?: BotAvatarCrop;
  avatarZoom?: number;
  avatarFocusX?: number;
  avatarFocusY?: number;
  unread: boolean;
  busy?: boolean;
  activity?: "working" | "waiting-on-you" | "idle" | "no-signal" | "dead" | "parked.computer";
  turnStartedAt?: number | null;
  modelSelection: ModelSelection;
  computer?: "cloud" | "vm" | "local" | "browser" | "off";
  cloudBackend?: CloudBackend;
  autoStartVps?: boolean;
  vpsAlias?: string;
  cwd?: string;
  autoApprove?: boolean;
  approvalMode?: ApprovalMode;
  alwaysAllow?: string[];
  speakReplies?: boolean;
  replyStyle?: import("../../shared/wire").WireBot["replyStyle"];
  greeting?: string;
  voice?: string;
  voiceNotes?: boolean; xResearch?: boolean;
  memoryEnabled?: boolean;
  /** Nordus: always on the chosen model; the decision model never sizes it down. */
  modelFixed?: boolean;
  audience?: BotAudience;
  /** Nordus: the person who answers for this agent (lowercased email); absent means the workspace admins. */
  owner?: string;
  /** Set by the server from `audience` and the second brain; only an internal bot without `mcpServers` mounts every server. */
  internal?: boolean;
  pinned?: boolean;
  hidden?: boolean;
  section?: string;
  pinnedMessageId?: string;
  chiefOfStaff?: boolean;
  teamLead?: TeamLeadPolicy;
  managedSections?: string[];
  approvePeerComms?: boolean;
  peers?: string[];
  composio?: boolean;
  connectorTools?: Record<string, ConnectorToolGrant>;
  connectorScopes?: { apps: Record<string, "read" | "write"> };
  outbound?: { policy: "ask" | "allow"; dailyCap: number };
  fallback?: Array<{ instanceId: string; model: string }>;
  browser?: boolean;
  recordBrowserSteps?: boolean;
  memoryUpkeep?: boolean;
  cacheKeepWarm?: boolean | null;
  helperModel?: boolean;
  mcpServers?: string[] | null;
  browserProfile?: string | null;
  liveVoice?: string;
  liveVoiceSource?: "manual" | "auto";
  visibility?: BotVisibility;
  installedPackage?: InstalledPackageMetadata;
  messages: Message[];
  hasMore?: boolean;
  awaitingThreadSnapshot?: boolean;
  /** The server announces a switch before its snapshot lands; until then this, not threadId, is on screen. */
  switchingTo?: string;
  activeLeafId?: string | null;
}

export interface BotProject {
  id: string;
  name: string;
  emoji?: string;
}

export type ProjectUpdatePatch = { name?: string; emoji?: string | null };

let resyncHandle: (() => Promise<void>) | null = null;

/** Loads the whole snapshot again, as the stream does after a gap (pull to refresh on a phone). */
export function resyncNow(): Promise<void> {
  return resyncHandle?.() ?? Promise.resolve();
}

export function threadApprovalModes(bot: Pick<Bot, "approvalMode" | "autoApprove" | "tasks">): ApprovalMode[] {
  return (bot.tasks ?? []).map((task) => approvalModeFor({
    approvalMode: task.approvalMode ?? (task.autoApprove === undefined ? bot.approvalMode : undefined),
    autoApprove: task.autoApprove ?? bot.autoApprove,
  }));
}

export function currentTaskBot(bot: Bot, threadId = bot.threadId): Bot {
  const task = bot.tasks?.find((candidate) => candidate.threadId === threadId);
  if (!task) return bot;
  return {
    ...bot,
    threadId,
    modelSelection: task.modelSelection ?? bot.modelSelection,
    approvalMode: task.approvalMode ?? (task.autoApprove === undefined ? bot.approvalMode : undefined),
    autoApprove: task.autoApprove ?? bot.autoApprove,
    alwaysAllow: task.alwaysAllow ?? bot.alwaysAllow,
    activity: task.activity ?? bot.activity,
    busy: task.busy ?? (task.activity ? task.activity === "working" || task.activity === "waiting-on-you" : bot.busy),
    unread: task.unread ?? bot.unread,
    pinnedMessageId: task.pinnedMessageId,
    turnStartedAt: task.turnStartedAt ?? null,
    waitingForTeammates: task.waitingForTeammates ?? false, waitingOn: task.waitingOn,
  };
}

export type TaskUpdatePatch = Partial<Pick<Task, "modelSelection" | "approvalMode" | "autoApprove" | "pinnedMessageId">> & {
  acknowledgeLocalAuto?: boolean;
  updateBotDefault?: boolean;
  resetApprovalToAsk?: boolean;
  projectId?: string | null;
  archivedAt?: number | null;
  snoozedUntil?: number | null;
  surface?: Task["surface"] | null;
  pinned?: boolean;
  link?: string | null;
};

function taskPatchFields(patch: TaskUpdatePatch): Partial<Task> {
  const { acknowledgeLocalAuto: _localAck, updateBotDefault: _modelDefault, resetApprovalToAsk, projectId, archivedAt, snoozedUntil, surface, pinned, link, ...fields } = patch;
  return { ...fields, ...(resetApprovalToAsk ? { approvalMode: "ask", autoApprove: false, alwaysAllow: [] } : {}),
    ...(projectId === undefined ? {} : { projectId: projectId ?? undefined }),
    ...(archivedAt === undefined ? {} : { archivedAt: archivedAt ?? undefined }),
    ...(snoozedUntil === undefined ? {} : { snoozedUntil: snoozedUntil ?? undefined }),
    ...(surface === undefined ? {} : { surface: surface ?? undefined, surfaceAuto: undefined }),
    ...(pinned === undefined ? {} : { pinned: pinned ? true : undefined }),
    ...(link === undefined ? {} : { link: link ?? undefined }) };
}

function openedUnreadDivider(state: AppState, threadId: string, unread: boolean, messages: readonly Message[], lastReadMessageId?: string): AppState["unreadDivider"] {
  if (!unread) return state.unreadDivider?.threadId === threadId ? state.unreadDivider : null;
  const messageId = firstUnreadMessageId(messages, lastReadMessageId);
  return messageId ? { threadId, messageId } : null;
}

export function visibleMessages(bot: Pick<Bot, "messages" | "activeLeafId">): Message[] {
  const leafId = bot.activeLeafId;
  if (!leafId) return bot.messages;
  const byId = new Map(bot.messages.map((m) => [m.id, m]));
  if (!byId.has(leafId)) return bot.messages;
  const path: Message[] = [];
  let cur = byId.get(leafId);
  while (cur) {
    path.push(cur);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return path.reverse();
}

import { retainOffscreenMessages } from "./message-retention";
import type { BrowserEngineSummary, BrowserProfile, ConfigStatus, ManagedPolicySummary } from "./config-status";
export type { BrowserEngineSummary, BrowserProfile, ConfigStatus, ManagedPolicySummary };

// A section left out here is wiped from state.config whenever a config frame lands.
export type ConfigStatusFrame = Pick<
  ConfigStatus,
  "xai" | "mistral" | "cerebras" | "groq" | "meta" | "xResearch" | "treg" | "anthropic" | "openai" | "openrouter" | "gemini" | "openaiCompat" | "fleet" | "composio" | "box" | "vps" | "rooms" | "mcp" | "threads" | "automaticRecovery" | "cacheKeepWarm" | "localVm" | "opencodeGo" | "tts" | "decider" | "imageGen" | "live" | "profile" | "language" | "features" | "onboarding" | "browserEngine" | "browserProfiles" | "edition" | "budgets" | "billing" | "managedPolicy" | "cloudHome"
>;

export function configStatusFromFrame(frame: ConfigStatusFrame): ConfigStatus {
  return {
    xai: frame.xai,
    mistral: frame.mistral,
    cerebras: frame.cerebras,
    groq: frame.groq,
    meta: frame.meta, xResearch: frame.xResearch, treg: frame.treg,
    anthropic: frame.anthropic,
    openai: frame.openai,
    openrouter: frame.openrouter,
    gemini: frame.gemini,
    openaiCompat: frame.openaiCompat,
    fleet: frame.fleet,
    composio: frame.composio,
    box: frame.box,
    vps: frame.vps,
    rooms: frame.rooms,
    mcp: frame.mcp,
    threads: frame.threads,
    automaticRecovery: frame.automaticRecovery,
    cacheKeepWarm: frame.cacheKeepWarm,
    localVm: frame.localVm,
    opencodeGo: frame.opencodeGo,
    tts: frame.tts,
    decider: frame.decider,
    imageGen: frame.imageGen,
    live: frame.live,
    profile: frame.profile,
    language: frame.language,
    features: frame.features,
    onboarding: frame.onboarding,
    browserEngine: frame.browserEngine,
    browserProfiles: frame.browserProfiles,
    edition: frame.edition,
    budgets: frame.budgets,
    billing: frame.billing,
    managedPolicy: frame.managedPolicy,
    ...(frame.cloudHome ? { cloudHome: true } : {}),
  };
}

export interface EngineInstall {
  platform?: "darwin" | "win32" | "linux";
  command?: Partial<Record<"darwin" | "win32" | "linux", string>>;
  docsUrl?: string;
  signInCommand?: string;
  needsNode?: boolean;
  managed?: { label: string; downloadBytes: number };
  server?: { package: string };
  settings?: "connections";
}

export interface InstanceInfo {
  instanceId: string;
  driverKind: string;
  displayName: string;
  icon?: import("../../shared/provider-icon").ProviderIcon;
  readOnly?: boolean;
  trialCredit?: "active" | "used_up" | "ended";
  managed?: { organizationId: string; organizationName: string };
  policy?: { organizationName: string; reason: string };
  snapshot: {
    state: "available" | "unavailable";
    reason?: string;
    authenticated?: boolean;
    chatgptPlan?: boolean;
    authenticationUnavailableReason?: string;
    account?: { email?: string; organization?: string; method?: "login" | "api-key" };
    version?: string | null;
    update?: {
      title: string;
      message: string;
      command: string;
    };
    billing?: "metered" | "subscription";
    warning?: {
      title: string;
      message: string;
    };
  };
  models: { default: string; options: Array<{ id: string; label: string; custom?: boolean; loaded?: boolean; provider?: string; variants?: ModelVariantOption[] }> };
  capabilities?: {
    computerMcp?: boolean;
    agentsMcp?: boolean;
    composioMcp?: boolean;
    /** the engine can mount the native HighLevel tools (a connected app without Composio) */
    highlevelMcp?: boolean;
    browserMcp?: boolean;
    images?: boolean;
    effortLevels?: readonly EffortLevel[];
    modelVariants?: boolean;
    queueing?: boolean;
    localComputerMcp?: boolean;
    approvalReview?: boolean;
    backgroundText?: boolean;
  };
  access?: "subscription" | "custom" | "api";
  authentication?: { method: "device-code" | "paste-code" | "browser" | "browser-pkce"; signOut?: boolean };
  install?: EngineInstall;
  cli?: string;
  cliDefault?: string;
  cliCandidates?: string[];
  claudeAccount?: { configDir: string; signInCommand: string; signInShell: "powershell" | "sh"; isDefault: boolean };
  freeUpSpace?: boolean;
}

export type AppSettingsSection =
  | "general"
  | "desktopWorkspaces"
  | "organization"
  | "cloudAccount"
  | "appearance"
  | "experimental"
  | "connections"
  | "decisionModel"
  | "accountMoves"
  | "engines"
  | "companion"
  | "remote"
  | "computer"
  | "logins"
  | "usage"
  | "people"
  | "activity"
  | "health"
  | "backups"
  | "workspaces"
  | "skills" | "import";

export type BotSettingsSection =
  | "overview"
  | "identity"
  | "slack"
  | "soul"
  | "skills"
  | "memory"
  | "routines"
  | "access"
  | "model"
  | "permissions"
  | "voice"
  | "visibility"
  | "team"
  | "history"
  | "usage";

export interface ModelVariantSession {
  instanceId: string;
  model: string;
  turnId: string;
  startedAt: string;
  acceptingUpdates: boolean;
  variants?: { options: ModelVariantOption[]; currentValue?: string };
}

export interface AppState {
  bots: Bot[];
  groups: Group[];
  sections?: string[];
  instances: InstanceInfo[];
  modelVariantSessions: Record<string, ModelVariantSession>;
  config: ConfigStatus | null;
  liveCall: LiveCallState | null;
  liveCallVersion: number;
  liveCallLookupSeq: number;
  selectedId: string;
  activeView: "chat" | "team-map" | "routines" | "files" | "today" | "board" | "inbox" | "drive" | "wiki" | "direct";
  /** The direct message open while `activeView` is "direct". */
  directId?: string | null;
  /** Folders a finished move left on this computer, for Files to offer sharing. */
  filesSuggest: string[] | null;
  routines: Routine[];
  routineRuns: RoutineRun[];
  routinesLoadState: "loading" | "ready" | "error";
  routinesFocus: { section?: "schedule" | "logs"; view?: "calendar" | "list"; botId?: string; routineId?: string; runStatus?: RoutineRunStatusFilter; nonce: number };
  webhooks: WebhookTrigger[];
  webhookAttempts: WebhookAttempt[];
  webhookIngress: WebhookIngressStatus | null;
  settingsOpen: boolean;
  pluginsOpen: boolean;
  pluginsSurface: "apps" | "mcp";
  newBotOpen: boolean;
  botCreationPending: boolean;
  computerOpen: boolean;
  inspectorOpen: boolean;
  activityOpen: boolean;
  /** Cross-bot, so a bot switch leaves it open; pinned, opening another side panel leaves it open too. */
  notificationsOpen: boolean;
  notificationsPinned: boolean;
  notifications: NotificationLogEntry[];
  appSettingsOpen: boolean;
  appSettingsSection: AppSettingsSection;
  appSettingsCloudLink: number;
  appSettingsPhonePairing: number;
  shortcutsOpen: boolean;
  cloudAdd: { source: import("@/lib/cloud-plan").CloudSource; signIn?: true } | null;
  cloudHowTo: boolean;
  welcomeOpen: boolean;
  tourOpen: boolean;
  botSettingsSection: BotSettingsSection;
  botSettingsExpandAccordion: boolean;
  botSettingsSectionStored: boolean;
  botSettingsExpandRemembered: boolean;
  computerStarts: Record<string, ComputerStart>;
  deletingBots: Record<string, true>;
  computerControl: Record<string, ComputerControlState>;
  dataSheets: Record<string, DataSheet>;
  dataTables: Record<string, DataTable[]>;
  dataResultFocus: { botId: string; id: string; requestId: number; consumed: boolean } | null;
  signInFocus: { botId: string; messageId: string; url: string; site: string; place: import("../../shared/wire").Surface; requestId: number; consumed: boolean } | null;
  dataView: import("@/lib/composer-attachments").DataViewContext | null;
  focusMessage: { threadId: string; messageId: string; matchText?: string; nonce: number; consumed: boolean } | null;
  unreadDivider: { threadId: string; messageId: string } | null;
  connected: boolean;
  hydrated?: true;
  error: string | null;
  errorInformational: boolean;
  notice: { kind: "thread-gone" | "bot-gone" | "steer-images" | "note"; botName: string | null; text?: string } | null;
  revealThread: { threadId: string; nonce: number } | null;
  mascotMotion: {
    botId: string;
    nonce: number;
    kind: Exclude<CritterMotion, "none">;
  } | null;
  pendingQueued: Record<string, Array<{ queueId: string; text: string; reason?: SteerQueueReason }>>;
  consumedQueueIds: Record<string, true>;
  backgroundThreadEvents: Record<string, Array<Extract<Action, { type: "messageAdded" | "messagePatched" | "threadActive" | "optimisticMessageRemoved" }>>>;
  loadingOlder: Record<string, true>;
  /** Threads whose last scrollback page failed; the open conversation offers a retry instead of paging again. */
  olderFailed: Record<string, true>;
  /** Bumped when a transcript is replaced or its branch moves, never on append; stale scrollback pages are dropped. */
  transcriptGeneration: Record<string, number>;
}

const MAX_CONSUMED_QUEUE_IDS = 64;

function rememberConsumedQueueId(
  consumed: AppState["consumedQueueIds"],
  queueId: string,
): AppState["consumedQueueIds"] {
  const next = { ...consumed, [queueId]: true as const };
  const overflow = Object.keys(next).length - MAX_CONSUMED_QUEUE_IDS;
  if (overflow > 0) {
    for (const id of Object.keys(next).slice(0, overflow)) delete next[id];
  }
  return next;
}

interface QueueReceiptSnapshot {
  messages?: Message[];
}

/** Leaves a tombstone so a slower POST continuation cannot add a drained chip back. */
function reconcileSnapshotQueues(
  state: AppState,
  conversations: QueueReceiptSnapshot[],
): AppState {
  const landed: Array<{ queueId: string; at: number }> = [];
  for (const conversation of conversations) {
    for (const message of conversation.messages ?? []) {
      if (message.queueId) landed.push({ queueId: message.queueId, at: message.at });
    }
  }
  if (landed.length === 0) return state;

  const landedIds = new Set(landed.map((entry) => entry.queueId));
  const pendingQueued: AppState["pendingQueued"] = {};
  for (const [threadId, entries] of Object.entries(state.pendingQueued)) {
    const waiting = entries.filter((entry) => !landedIds.has(entry.queueId));
    if (waiting.length > 0) pendingQueued[threadId] = waiting;
  }

  let consumedQueueIds: AppState["consumedQueueIds"] = {};
  landed.sort((left, right) => left.at - right.at);
  for (const entry of landed) {
    consumedQueueIds = rememberConsumedQueueId(consumedQueueIds, entry.queueId);
  }
  // Live receipts are newer than any loaded history; never evict them for a late POST.
  for (const queueId of Object.keys(state.consumedQueueIds)) {
    consumedQueueIds = rememberConsumedQueueId(consumedQueueIds, queueId);
  }
  return { ...state, pendingQueued, consumedQueueIds };
}

function replaceBotQueues(state: AppState, queues: AppState["pendingQueued"]): AppState {
  const groupThreads = new Set(state.groups.flatMap((group) => [group.threadId, ...(group.tasks ?? []).map((task) => task.threadId)]));
  const liveIds = new Set(Object.values(queues).flatMap((entries) => entries.map((entry) => entry.queueId)));
  const pendingQueued = { ...queues };
  let consumedQueueIds = state.consumedQueueIds;
  for (const [threadId, entries] of Object.entries(state.pendingQueued)) {
    if (groupThreads.has(threadId)) pendingQueued[threadId] = entries;
    else for (const entry of entries) {
      if (!liveIds.has(entry.queueId)) consumedQueueIds = rememberConsumedQueueId(consumedQueueIds, entry.queueId);
    }
  }
  return { ...state, pendingQueued, consumedQueueIds };
}

export type BotAnnouncement = Omit<Bot, "messages"> & { messages?: Message[] };

export type Action =
  | {
      type: "hydrate";
      /** A delta leaves out each conversation the device holds that did not change. */
      delta?: boolean;
      /** The conversation each bot and room showed when the snapshot was asked for. */
      askedThreads?: AskedThreads;
      bots: BotAnnouncement[];
      groups: Array<Omit<Group, "messages"> & { messages?: Message[] }>;
      sections?: string[];
      computerControl: Record<string, ComputerControlState>;
      botQueuedMessages?: AppState["pendingQueued"];
      resumeId?: string;
    }
  | { type: "botQueues"; queues: AppState["pendingQueued"] }
  | { type: "sections"; sections: string[] }
  | { type: "sectionDeleted"; section: string; sections: string[] }
  | { type: "showRoutines"; section?: "schedule" | "logs"; view?: "calendar" | "list"; botId?: string; routineId?: string; runStatus?: RoutineRunStatusFilter }
  | { type: "showTeamMap" } | { type: "showToday" } | { type: "showBoard" } | { type: "showInbox" } | { type: "showDrive" } | { type: "showWiki" }
  | { type: "showFiles"; suggest?: string[] }
  | { type: "showChat" }
  | { type: "showDirect"; id: string }
  | { type: "routinesHydrated"; routines: Routine[]; runs: RoutineRun[] }
  | { type: "routinesLoadFailed" }
  | { type: "routinePatched"; routine: Routine }
  | { type: "routineDeleted"; routineId: string }
  | { type: "routineRunPatched"; run: RoutineRun }
  | NotificationFeedAction
  | { type: "toggleNotifications"; open?: boolean }
  | { type: "toggleNotificationsPinned"; pinned?: boolean }
  | { type: "webhooksHydrated"; webhooks: WebhookTrigger[]; attempts: WebhookAttempt[]; ingress: WebhookIngressStatus }
  | { type: "webhookPatched"; webhook: WebhookTrigger }
  | { type: "webhookAttempted"; attempt: WebhookAttempt }
  | { type: "webhookDeleted"; webhookId: string }
  | { type: "createRoutine"; input: RoutineInput }
  | { type: "updateRoutine"; routineId: string; patch: Partial<RoutineInput> }
  | { type: "deleteRoutine"; routineId: string }
  | { type: "runRoutine"; routineId: string; onStarted?: (run: RoutineRun) => void; onError?: (error: unknown) => void; onSettled?: () => void }
  | { type: "cancelRoutineRun"; runId: string }
  | { type: "markRoutineRunSeen"; runId: string }
  | { type: "markAllRoutineRunsSeen" }
  | { type: "groupPatched"; group: Partial<Group> & { id: string } }
  | { type: "groupDeleted"; groupId: string }
  | { type: "createGroup"; memberIds: string[]; name?: string; section?: string; people?: string[] }
  | {
      type: "sendGroup";
      groupId: string;
      text: string;
      sendId?: string;
      replyToId?: string;
      threadId?: string;
      mode?: "chat" | "goal";
      onError?: (error: unknown) => void;
      /** The send outbox retries on its own and shows the state itself: no error toast. */
      quiet?: boolean;
      onSent?: () => void;
    }
  | {
      type: "patchGroup";
      groupId: string;
      patch: Partial<Pick<Group, "name" | "bulletin" | "memberIds" | "defaultResponder" | "pinnedMessageId" | "section" | "conversation" | "description" | "avatarUrl" | "favoriteMessageIds" | "client">>;
    }
  | { type: "deleteGroup"; groupId: string }
  | { type: "newGroupTask"; groupId: string }
  | { type: "switchGroupTask"; groupId: string; threadId: string }
  | { type: "renameGroupTask"; groupId: string; threadId: string; title: string }
  | { type: "pinGroupTask"; groupId: string; threadId: string; pinned: boolean; title: string }
  | { type: "setConversationTurnLimit"; groupId: string; threadId: string; minutes: number | null; dm: boolean }
  | { type: "deleteGroupTask"; groupId: string; threadId: string }
  | { type: "interruptGroup"; groupId: string; threadId?: string; onError?: () => void }
  | { type: "setGroupHold"; groupId: string; botId: string; held: boolean }
  | { type: "instances"; instances: InstanceInfo[] }
  | { type: "configStatus"; config: ConfigStatus }
  | { type: "liveCall"; call: LiveCallState | null }
  /** Applied only if no live.call frame landed and no later lookup answered while it was out. */
  | { type: "liveCallLookup"; call: LiveCallState | null; since: number; seq: number }
  | { type: "profileSaved"; profile: Partial<NonNullable<ConfigStatus["profile"]>> }
  | { type: "select"; id: string }
  | {
      type: "send";
      botId: string;
      text: string;
      sendId?: string;
      replyToId?: string;
      threadId?: string;
      dataContext?: import("../../shared/data-context").DataContext;
      onError?: (error: unknown) => void;
      quiet?: boolean;
      onSent?: () => void;
    }
  | { type: "pendingQueued"; threadId: string; queueId: string; text: string; reason?: SteerQueueReason }
  | { type: "consumePendingQueued"; threadId: string; queueId: string }
  | { type: "cancelQueued"; botId: string; queueId: string; threadId?: string; onCancelled?: () => void }
  | { type: "steerQueued"; botId: string; queueId: string; threadId?: string; onError?: () => void; onSettled?: () => void }
  | { type: "cancelGroupQueued"; groupId: string; threadId: string; queueId: string; onCancelled?: () => void }
  | { type: "steerGroupQueued"; groupId: string; queueId: string; threadId?: string; onError?: () => void; onSettled?: () => void }
  | { type: "editMessage"; botId: string; messageId: string; text: string; threadId?: string; sendId?: string }
  | { type: "switchBranch"; botId: string; messageId: string; threadId?: string }
  | { type: "threadActive"; threadId: string; activeLeafId: string }
  | { type: "loadOlderMessages"; threadId: string; limit?: number }
  | { type: "olderMessages"; threadId: string; generation: number; messages: Message[]; hasMore: boolean; failed?: boolean; canceled?: boolean }
  | { type: "answerCard"; botId: string; messageId: string; answer: string; threadId?: string; groupId?: string }
  | { type: "dismissCard"; botId: string; messageId: string; threadId?: string; groupId?: string }
  | {
      type: "decideRequest";
      threadId: string;
      requestId: string;
      behavior: "allow" | "deny" | "answer";
      message?: string;
      reviewedSha256?: string;
      alwaysAllow?: { botId: string; key: string };
      always?: boolean;
      rememberCommand?: boolean;
      releaseTask?: boolean;
      onError?: (message: string) => void;
    }
  | { type: "revokeTaskRelease"; botId: string; threadId: string }
  | { type: "newTask"; botId: string; projectId?: string; cwd?: string; onCreated?: () => void; onError?: (message: string) => void }
  | { type: "switchTask"; botId: string; threadId: string; whole?: true }
  | { type: "switchTaskFailed"; botId: string; threadId: string }
  | { type: "taskSwitched"; bot: Bot }
  | { type: "renameTask"; botId: string; threadId: string; title: string }
  | { type: "regenerateTaskTitle"; botId: string; threadId: string; onSettled?: (ok: boolean) => void }
  | { type: "deleteTask"; botId: string; threadId: string }
  | { type: "newBot"; role?: BotRole; visibility?: BotVisibility; section?: string; preserveSelection?: boolean; onCreated?: (bot: Bot) => void; onError?: (message: string) => void }
  | { type: "botCreationPending"; on: boolean }
  | { type: "updateTask"; botId: string; threadId: string; patch: TaskUpdatePatch }
  | { type: "refreshTaskPermissions"; botId: string; threadId: string; acknowledgeLocalAuto?: boolean }
  | { type: "followBotModel"; botId: string; onSettled?: (result: { busy: number }) => void }
  | { type: "createProject"; botId: string; name: string; emoji?: string | null; onCreated?: (project: BotProject) => void; onError?: (message: string) => void }
  | { type: "updateProject"; botId: string; projectId: string; patch: ProjectUpdatePatch; onSaved?: () => void; onError?: (message: string) => void }
  | { type: "deleteProject"; botId: string; projectId: string; onDeleted?: () => void; onError?: (message: string) => void }
  | { type: "reorderProjects"; botId: string; projectIds: string[]; onSaved?: () => void; onError?: (message: string) => void }
  | { type: "botAdded"; bot: Bot; preserveSelection?: boolean }
  | { type: "deleteBot"; botId: string }
  | { type: "botDeletionPending"; botId: string; on: boolean }
  | { type: "duplicateBot"; botId: string }
  | { type: "markUnread"; botId: string }
  | { type: "botPatched"; bot: BotAnnouncement }
  | { type: "messageAdded"; threadId: string; message: Message }
  | { type: "messagePatched"; threadId: string; message: Message }
  | { type: "optimisticMessageRemoved"; threadId: string; sendId: string; restoreLeafId?: string | null }
  | { type: "computerStart"; botId: string; start: ComputerStart | null }
  | ({ type: "computerControl"; botId: string } & ComputerControlState)
  | { type: "dataSheet"; sheet: DataSheet; tables?: DataTable[] }
  | { type: "dataView"; view: AppState["dataView"] }
  | { type: "loadDataSheet"; botId: string; onError?: (message: string) => void }
  | { type: "modelVariantRuntime"; event: RuntimeEvent }
  | { type: "setModel"; botId: string; selection: ModelSelection; threadId?: string; updateBotDefault?: boolean; resetApprovalToAsk?: boolean }
  | { type: "interrupt"; botId: string; threadId?: string; onError?: () => void }
  | { type: "connected"; value: boolean }
  | { type: "error"; message: string | null; informational?: boolean }
  | { type: "notice"; notice: AppState["notice"] }
  | { type: "revealThread"; threadId: string }
  | { type: "toggleSettings"; open?: boolean; section?: BotSettingsSection; botId?: string }
  | { type: "togglePlugins"; open?: boolean; surface?: "apps" | "mcp" }
  | { type: "toggleNewBot"; open?: boolean }
  | { type: "toggleComputer"; open?: boolean; botId?: string }
  | { type: "openDataResult"; botId: string; cardId: string }
  | { type: "dataResultFocusConsumed"; requestId: number }
  | { type: "openSignIn"; botId: string; messageId: string; url: string; site: string; place: import("../../shared/wire").Surface }
  | { type: "signInFocusConsumed"; requestId: number }
  | { type: "toggleInspector"; open?: boolean }
  | { type: "toggleActivity"; open?: boolean }
  | { type: "focusMessage"; threadId: string; messageId: string; matchText?: string }
  | { type: "focusMessageConsumed"; nonce: number }
  | { type: "unreadDividerDone"; threadId: string }
  | { type: "toggleAppSettings"; open?: boolean; section?: AppSettingsSection; cloudLink?: boolean; phonePairing?: boolean }
  | { type: "toggleShortcuts"; open?: boolean }
  | { type: "openCloudAdd"; source: import("@/lib/cloud-plan").CloudSource; signIn?: true }
  | { type: "closeCloudAdd" }
  | { type: "cloudHowTo"; open: boolean }
  | { type: "toggleWelcome"; open?: boolean }
  | { type: "toggleTour"; open?: boolean }
  | {
      type: "updateBot";
      botId: string;
      patch: BotUpdatePatch;
    };

const PROFILE_TEXT_FIELDS = ["name", "title", "description", "soul"] as const;

function reconcileModelVariantSessions(state: AppState): AppState {
  const sessions = Object.entries(state.modelVariantSessions);
  const kept = sessions.filter(([threadId, session]) => {
    const owner = state.bots.find((bot) => bot.threadId === threadId || bot.tasks?.some((task) => task.threadId === threadId));
    if (!owner) return false;
    const selection = currentTaskBot(owner, threadId).modelSelection;
    return selection.instanceId === session.instanceId && selection.model === session.model;
  });
  return kept.length === sessions.length ? state : { ...state, modelVariantSessions: Object.fromEntries(kept) };
}

export function pinBotThreadAction(action: Action, bots: Bot[]): Action {
  if (!("botId" in action) || ("threadId" in action && action.threadId) ||
      !["send", "interrupt", "editMessage", "switchBranch", "answerCard", "dismissCard", "cancelQueued", "steerQueued"].includes(action.type)) return action;
  const botId = action.botId;
  const threadId = bots.find((bot) => bot.id === botId)?.threadId;
  return { ...action, threadId } as Action;
}

/** A delta folds only the conversations it carries pages for: the rest keep their pending events and failed pages. */
function keptThreadState(
  state: AppState,
  owners: ReadonlyArray<{ threadId: string; messages?: Message[] }>,
): Pick<AppState, "backgroundThreadEvents" | "olderFailed"> {
  const carried = new Set(owners.filter((owner) => Array.isArray(owner.messages)).map((owner) => owner.threadId));
  const kept = <V,>(record: Record<string, V>) => Object.fromEntries(Object.entries(record).filter(([threadId]) => !carried.has(threadId)));
  return { backgroundThreadEvents: kept(state.backgroundThreadEvents), olderFailed: kept(state.olderFailed) };
}

function updateBot(state: AppState, botId: string, fn: (b: Bot) => Bot): AppState {
  return { ...state, bots: state.bots.map((b) => (b.id === botId ? fn(b) : b)) };
}

function withMascotMotion(
  state: AppState,
  botId: string,
  kind: Exclude<CritterMotion, "none">,
): AppState {
  return {
    ...state,
    mascotMotion: {
      botId,
      nonce: (state.mascotMotion?.nonce ?? 0) + 1,
      kind,
    },
  };
}

function withPatchedCard(messages: Message[], messageId: string, patch: Partial<OptionCardData>): Message[] {
  return messages.map((m) => (m.id === messageId && m.card ? { ...m, card: { ...m.card, ...patch } } : m));
}

function patchCard(state: AppState, botId: string, messageId: string, patch: Partial<OptionCardData>): AppState {
  return updateBot(state, botId, (b) => ({ ...b, messages: withPatchedCard(b.messages, messageId, patch) }));
}

function patchGroupCard(state: AppState, groupId: string, messageId: string, patch: Partial<OptionCardData>): AppState {
  return {
    ...state,
    groups: state.groups.map((g) =>
      g.id === groupId ? { ...g, messages: withPatchedCard(g.messages, messageId, patch) } : g,
    ),
  };
}

function openOnboardingCard(bot: Bot): Message | undefined {
  return bot.messages.find(
    (message) => message.kind === "options" && message.card && !message.card.requestId && !message.card.dismissed,
  );
}

function dismissOnboardingCard(state: AppState, botId: string): AppState {
  const bot = state.bots.find((candidate) => candidate.id === botId);
  const quiz = bot ? openOnboardingCard(bot) : undefined;
  return quiz ? patchCard(state, botId, quiz.id, { dismissed: true }) : state;
}

export const CLOUD_LINK_SETTINGS = { type: "toggleAppSettings", open: true, section: "cloudAccount", cloudLink: true } as const satisfies Action;

/** The app's reducer with conversations off screen held to a bounded tail, so a day-long session cannot grow forever. */
export function retainingReducer(state: AppState, action: Action): AppState {
  return retainOffscreenMessages(reducer(state, action));
}

export function reducer(state: AppState, action: Action): AppState {
  if (action.type === "messageAdded" || action.type === "messagePatched" || action.type === "threadActive" || action.type === "optimisticMessageRemoved") {
    const owner = state.bots.find((bot) => (bot.threadId !== action.threadId || bot.awaitingThreadSnapshot) && bot.tasks?.some((task) => task.threadId === action.threadId));
    if (owner) {
      const frames = [...(state.backgroundThreadEvents[action.threadId] ?? []), action].slice(-256);
      const buffered = { ...state, backgroundThreadEvents: { ...state.backgroundThreadEvents, [action.threadId]: frames } };
      return (action.type === "messageAdded" || action.type === "messagePatched") && movesThreadToTop(action.message)
        ? bumpThreadUpdatedAt(buffered, action.threadId, action.message.at, true, action.message.turnCompletedAt ?? action.message.at)
        : action.type === "messageAdded" ? bumpThreadUpdatedAt(buffered, action.threadId, action.message.at) : buffered;
    }
  }
  switch (action.type) {
    case "hydrate": {
      const known = (id: string) => action.bots.some((b) => b.id === id) || action.groups.some((g) => g.id === id);
      const resume = action.resumeId;
      const resumed =
        resume && (action.bots.some((b) => b.id === resume && !b.hidden) || action.groups.some((g) => g.id === resume)) ? resume : "";
      const selectedId = state.selectedId && known(state.selectedId) ? state.selectedId : resumed || (action.bots[0]?.id ?? "");
      const rebasedThreads: string[] = [];
      const transcriptOf = (...args: Parameters<typeof snapshotTranscript>) => {
        const { rebased, ...transcript } = snapshotTranscript(...args);
        if (rebased) rebasedThreads.push(args[0].threadId);
        return transcript;
      };
      const bots = action.bots.map((bot) => {
        const previous = state.bots.find((candidate) => candidate.id === bot.id);
        const merged: Bot = { ...bot, ...transcriptOf(bot, previous, action.delta === true, action.askedThreads?.bots[bot.id]) };
        return previous ? { ...merged, tasks: mergeTaskStamps(previous.tasks, bot.tasks) } : merged;
      });
      const groups = action.groups.map((group) => {
        const previous = state.groups.find((candidate) => candidate.id === group.id);
        const merged: Group = { ...group, ...transcriptOf(group, previous, action.delta === true, action.askedThreads?.groups[group.id]) };
        return previous ? { ...merged, tasks: mergeTaskStamps(previous.tasks, group.tasks) } : merged;
      });
      const hydrated = {
        ...state,
        bots,
        groups,
        sections: action.sections ?? [],
        computerControl: action.computerControl,
        selectedId,
        hydrated: true as const,
        ...(action.delta ? keptThreadState(state, [...action.bots, ...action.groups]) : { backgroundThreadEvents: {}, olderFailed: {} }),
        transcriptGeneration: bumpTranscriptGenerations(state.transcriptGeneration, rebasedThreads),
        modelVariantSessions: {},
      };
      return reconcileSnapshotQueues(
        action.botQueuedMessages ? replaceBotQueues(hydrated, action.botQueuedMessages) : hydrated,
        [...action.bots, ...action.groups],
      );
    }
    case "loadOlderMessages":
      return state.loadingOlder[action.threadId]
        ? state
        : { ...state, ...beginScrollbackPage(state, action.threadId) };
    case "olderMessages":
      return { ...state, ...applyScrollbackPage(state, action) };
    case "sectionDeleted":
      return {
        ...state, sections: action.sections,
        bots: state.bots.map(bot => bot.section === action.section ? { ...bot, section: undefined } : bot),
        groups: state.groups.map(group => group.section === action.section ? { ...group, section: undefined } : group),
      };
    case "sections":
      return { ...state, sections: action.sections };
    case "botQueues":
      return reconcileSnapshotQueues(replaceBotQueues(state, action.queues), [...state.bots, ...state.groups]);
    case "showRoutines":
      return {
        ...state,
        activeView: "routines",
        routinesFocus: { section: action.section, view: action.view, botId: action.botId, routineId: action.routineId, runStatus: action.runStatus, nonce: state.routinesFocus.nonce + 1 },
        settingsOpen: false,
        computerOpen: false,
        inspectorOpen: false,
        activityOpen: false,
        notificationsOpen: false,
        appSettingsOpen: false,
        pluginsOpen: false,
      };
    case "showChat":
      return state.activeView === "chat" ? state : { ...state, activeView: "chat" };
    case "showDirect":
      return {
        ...state,
        activeView: "direct",
        directId: action.id,
        settingsOpen: false, computerOpen: false, inspectorOpen: false, activityOpen: false, appSettingsOpen: false, pluginsOpen: false,
      };
    case "showTeamMap":
    case "showFiles": case "showToday": case "showBoard": case "showInbox":
      return {
        ...state,
        activeView: action.type === "showFiles" ? "files" : action.type === "showToday" ? "today" : action.type === "showBoard" ? "board" : action.type === "showInbox" ? "inbox" : "team-map",
        filesSuggest: action.type === "showFiles" && action.suggest?.length ? action.suggest : null,
        settingsOpen: false, computerOpen: false, inspectorOpen: false, activityOpen: false, appSettingsOpen: false, pluginsOpen: false,
      };
    case "showDrive": case "showWiki":
      return {
        ...state,
        activeView: action.type === "showDrive" ? "drive" : "wiki",
        settingsOpen: false, computerOpen: false, inspectorOpen: false, activityOpen: false, appSettingsOpen: false, pluginsOpen: false,
      };
    case "routinesHydrated":
      return { ...state, routines: action.routines, routineRuns: trimRoutineRuns(action.runs), routinesLoadState: "ready" };
    case "routinesLoadFailed":
      return { ...state, routinesLoadState: "error" };
    case "routinePatched": {
      const existing = state.routines.find((routine) => routine.id === action.routine.id);
      // A PATCH's answer and the server's broadcast of it can arrive in either order: never step back to an older edit.
      if (existing && existing.updatedAt > action.routine.updatedAt) return state;
      return {
        ...state,
        routines: existing
          ? state.routines.map((routine) => (routine.id === action.routine.id ? action.routine : routine))
          : [action.routine, ...state.routines],
      };
    }
    case "routineDeleted":
      return { ...state, routines: state.routines.filter((routine) => routine.id !== action.routineId) };
    case "routineRunPatched": {
      const exists = state.routineRuns.some((run) => run.id === action.run.id);
      const runs = exists
        ? state.routineRuns.map((run) => (run.id === action.run.id ? action.run : run))
        : [action.run, ...state.routineRuns];
      return {
        ...state,
        routineRuns: trimRoutineRuns(runs),
      };
    }
    case "webhooksHydrated":
      return { ...state, webhooks: action.webhooks, webhookAttempts: action.attempts, webhookIngress: action.ingress };
    case "webhookPatched": {
      const exists = state.webhooks.some((webhook) => webhook.id === action.webhook.id);
      return {
        ...state,
        webhooks: exists
          ? state.webhooks.map((webhook) => (webhook.id === action.webhook.id ? action.webhook : webhook))
          : [action.webhook, ...state.webhooks],
      };
    }
    case "webhookDeleted":
      return {
        ...state,
        webhooks: state.webhooks.filter((webhook) => webhook.id !== action.webhookId),
        webhookAttempts: state.webhookAttempts.filter((attempt) => attempt.webhookId !== action.webhookId),
      };
    case "webhookAttempted": {
      const attempts = state.webhookAttempts.some((attempt) => attempt.id === action.attempt.id)
        ? state.webhookAttempts.map((attempt) => attempt.id === action.attempt.id ? action.attempt : attempt)
        : [...state.webhookAttempts, action.attempt];
      return { ...state, webhookAttempts: attempts.slice(-2_000) };
    }
    case "groupPatched": {
      const exists = state.groups.some((g) => g.id === action.group.id);
      const previous = state.groups.find((g) => g.id === action.group.id);
      const sameThread = Boolean(previous && (action.group.threadId === undefined || action.group.threadId === previous.threadId));
      const merged = previous && sameThread && action.group.messages ? mergeTranscriptRows(previous.messages, action.group.messages) : null;
      const fenced = action.group.messages && !sameThread
        ? bumpTranscriptGeneration(state, action.group.threadId)
        : bumpTranscriptGeneration(state, merged?.rebased && previous ? previous.threadId : undefined);
      const groups = exists
        ? fenced.groups.map((g) => (g.id === action.group.id ? {
            ...g, ...action.group,
            section: typeof action.group.threadId === "string" || Object.hasOwn(action.group, "section") ? action.group.section : g.section,
            // A whole room leaves `client` out once it is cleared, so only a partial patch keeps the one held here.
            client: typeof action.group.threadId === "string" || Object.hasOwn(action.group, "client") ? action.group.client : g.client,
            people: typeof action.group.threadId === "string" || Object.hasOwn(action.group, "people") ? action.group.people : g.people,
            steps: typeof action.group.threadId === "string" || Object.hasOwn(action.group, "steps") ? action.group.steps : g.steps,
            tasks: action.group.tasks ? mergeTaskStamps(g.tasks, action.group.tasks) : g.tasks,
            turnTimeoutMinutes: Object.hasOwn(action.group, "turnTimeoutMinutes")
              ? (action.group.turnTimeoutMinutes ?? undefined)
              : g.turnTimeoutMinutes,
            messages: action.group.messages ? (merged ? merged.messages : action.group.messages) : g.messages,
            hasMore: action.group.messages
              ? merged ? mergedHasMore(merged.rebased, action.group.hasMore, g.hasMore) : Boolean(action.group.hasMore)
              : g.hasMore,
          } : g))
        : [{ ...(action.group as Group), messages: action.group.messages ?? [] }, ...fenced.groups];
      return { ...fenced, groups };
    }
    case "groupDeleted": {
      const groups = state.groups.filter((g) => g.id !== action.groupId);
      const selectedId = state.selectedId === action.groupId ? (state.bots[0]?.id ?? "") : state.selectedId;
      return { ...state, groups, selectedId };
    }
    case "instances":
      return { ...state, instances: action.instances };
    case "configStatus":
      return { ...state, config: action.config };
    case "liveCall":
      return { ...state, liveCall: action.call, liveCallVersion: state.liveCallVersion + 1 };
    case "liveCallLookup":
      return action.since === state.liveCallVersion && action.seq > state.liveCallLookupSeq
        ? { ...state, liveCall: action.call, liveCallLookupSeq: action.seq }
        : state;
    case "profileSaved":
      return state.config ? {
        ...state,
        config: { ...state.config, profile: { name: "", email: "", ...state.config.profile, ...action.profile } },
      } : state;
    case "select": {
      const room = state.groups.find((g) => g.id === action.id);
      if (room) {
        return {
          ...state,
          unreadDivider: openedUnreadDivider(state, room.threadId, room.unread, room.messages, room.lastReadMessageId),
          activeView: "chat",
          selectedId: action.id,
          groups: state.groups.map((g) => (g.id === action.id ? { ...g, unread: false } : g)),
        };
      }
      const opened = state.bots.find((b) => b.id === action.id);
      return updateBot(
        withMascotMotion(
          {
            ...state,
            unreadDivider: opened
              ? openedUnreadDivider(state, opened.threadId, threadOpensUnread(opened), visibleMessages(opened), threadReadCursor(opened))
              : state.unreadDivider,
            activeView: "chat",
            selectedId: action.id,
          },
          action.id,
          "switch",
        ),
        action.id,
        (b) => {
          // Opening a bot reads its conversation and the side conversations the list no longer shows.
          const hidden = new Set(hiddenUnreadThreads(b, b.threadId));
          const tasks = b.tasks?.map((task) => task.threadId === b.threadId || hidden.has(task.threadId) ? { ...task, unread: false } : task);
          return { ...b, unread: botShowsUnread({ unread: false, tasks }), tasks };
        },
      );
    }
    case "answerCard": {
      if (action.groupId) return patchGroupCard(state, action.groupId, action.messageId, { answered: action.answer });
      const bot = state.bots.find((candidate) => candidate.id === action.botId);
      const card = bot?.messages.find((message) => message.id === action.messageId)?.card;
      return withMascotMotion(
        patchCard(state, action.botId, action.messageId, {
          answered: action.answer,
          ...(card?.requestId ? {} : { dismissed: true }),
        }),
        action.botId,
        "working",
      );
    }
    case "dismissCard":
      if (action.groupId) return patchGroupCard(state, action.groupId, action.messageId, { dismissed: true });
      return patchCard(state, action.botId, action.messageId, { dismissed: true });
    case "decideRequest":
    case "revokeTaskRelease":
      return state;
    case "botAdded":
      return withMascotMotion({
        ...state,
        // The HTTP response and its SSE broadcast race; fold both without showing the bot twice.
        bots: [action.bot, ...state.bots.filter((bot) => bot.id !== action.bot.id)],
        ...(action.preserveSelection ? {} : { activeView: "chat" as const, selectedId: action.bot.id }),
      }, action.bot.id, "arrive");
    case "deleteBot": {
      const bots = state.bots.filter((b) => b.id !== action.botId);
      const selectedId =
        state.selectedId === action.botId ? (bots.find((b) => !b.hidden)?.id ?? bots[0]?.id ?? "") : state.selectedId;
      const { [action.botId]: _deleted, ...deletingBots } = state.deletingBots;
      return reconcileModelVariantSessions({ ...state, bots, selectedId, deletingBots });
    }
    case "botDeletionPending": {
      if (action.on) {
        if (state.deletingBots[action.botId]) return state;
        return { ...state, deletingBots: { ...state.deletingBots, [action.botId]: true } };
      }
      if (!state.deletingBots[action.botId]) return state;
      const { [action.botId]: _settled, ...deletingBots } = state.deletingBots;
      return { ...state, deletingBots };
    }
    case "markUnread":
      return updateBot(withMascotMotion(state, action.botId, "surprise"), action.botId, (b) => ({ ...b, unread: true }));
    case "botPatched": {
      const before = state.bots.find((b) => b.id === action.bot.id);
      if (!before) {
        const added = {
          ...state,
          bots: [{ ...action.bot, messages: action.bot.messages ?? [] }, ...state.bots],
        };
        return reconcileSnapshotQueues(added, [action.bot]);
      }
      const kind =
        action.bot.unread && !before?.unread
          ? "surprise"
          : action.bot.busy === true && !before?.busy
            ? "working"
            : action.bot.busy === false && before?.busy
              ? "celebrate"
              : null;
      const motioned = kind ? withMascotMotion(state, action.bot.id, kind) : state;
      const animated = action.bot.busy === false && before?.busy && motioned.computerStarts[action.bot.id]
        ? reducer(motioned, { type: "computerStart", botId: action.bot.id, start: null }) : motioned;
      const next = action.bot.chiefOfStaff
        ? {
            ...animated,
            bots: animated.bots.map((b) =>
              b.id === action.bot.id || (b.section?.trim() || "") !== (action.bot.section?.trim() || "")
                ? b
                : { ...b, chiefOfStaff: false },
            ),
          }
        : animated;
      const switchedThread =
        typeof action.bot.threadId === "string" && action.bot.threadId !== before.threadId &&
        !action.bot.tasks?.some((task) => task.threadId === before.threadId);
      let switching = next;
      if (switchedThread) {
        const { [action.bot.threadId]: _stale, ...otherThreadEvents } = next.backgroundThreadEvents;
        switching = { ...next, backgroundThreadEvents: otherThreadEvents };
      }
      if ((switchedThread || (before.awaitingThreadSnapshot && action.bot.threadId === before.threadId)) &&
          Array.isArray(action.bot.messages)) {
        // The slim deletion broadcast can beat the full snapshot; later duplicate snapshots must not overwrite newer messages.
        return reducer(switching, { type: "taskSwitched", bot: { ...before, ...action.bot, computer: action.bot.computer, section: action.bot.section, teamLead: action.bot.teamLead, managedSections: action.bot.managedSections, toolScope: action.bot.toolScope, messages: action.bot.messages, browserProfile: action.bot.browserProfile, vpsAlias: action.bot.vpsAlias } });
      }
      const patched = updateBot(switching, action.bot.id, (b) => ({
        ...b,
        ...action.bot,
        threadId: switchedThread ? action.bot.threadId : b.threadId,
        activeLeafId: switchedThread ? null : b.activeLeafId,
        awaitingThreadSnapshot: switchedThread || b.awaitingThreadSnapshot,
        // Complete frames omit cleared optional fields; copy them so the spread cannot keep stale values.
        browserProfile: action.bot.browserProfile,
        computer: action.bot.computer,
        toolScope: action.bot.toolScope,
        section: action.bot.section,
        teamLead: action.bot.teamLead,
        managedSections: action.bot.managedSections,
        vpsAlias: action.bot.vpsAlias,
        owner: action.bot.owner,
        tasks: action.bot.tasks ? mergeTaskStamps(b.tasks, action.bot.tasks) : b.tasks,
        // Old approvals must never be sent to the replacement thread while its transcript loads.
        messages: switchedThread ? [] : b.messages,
        hasMore: switchedThread ? undefined : b.hasMore,
      }));
      return reconcileModelVariantSessions(patched);
    }
    case "messageAdded": {
      const bot = state.bots.find((b) => b.threadId === action.threadId);
      if (!bot) {
        const group = state.groups.find((g) => g.threadId === action.threadId || g.tasks?.some((task) => task.threadId === action.threadId));
        if (!group) return state;
        if (group.threadId !== action.threadId) {
          return bumpThreadUpdatedAt(state, action.threadId, action.message.at, movesThreadToTop(action.message), action.message.turnCompletedAt ?? action.message.at);
        }
        const folded = foldConfirmedMessage(group.messages, action.message);
        if (folded.duplicate) {
          return folded.optimisticId
            ? { ...state, groups: state.groups.map((g) => (g.id === group.id ? { ...g, messages: folded.messages } : g)) }
            : state;
        }
        const stamped = bumpThreadUpdatedAt(state, action.threadId, action.message.at, movesThreadToTop(action.message), action.message.turnCompletedAt ?? action.message.at);
        return { ...stamped, groups: stamped.groups.map((g) => (g.id === group.id ? { ...g, messages: folded.messages } : g)) };
      }
      // The POST response and its SSE frame race; moving the leaf back to a repeat can hide a newer reply.
      const folded = foldConfirmedMessage(bot.messages, action.message);
      const optimisticId = folded.optimisticId;
      if (folded.duplicate) {
        if (!optimisticId) return state;
        return updateBot(state, bot.id, (current) => ({
          ...current,
          messages: folded.messages,
          activeLeafId: current.activeLeafId === optimisticId ? action.message.id : current.activeLeafId,
        }));
      }
      const stamped = bumpThreadUpdatedAt(state, action.threadId, action.message.at, movesThreadToTop(action.message), action.message.turnCompletedAt ?? action.message.at);
      if (optimisticId) {
        return updateBot(stamped, bot.id, (current) => ({
          ...current,
          messages: folded.messages,
          activeLeafId: current.activeLeafId === optimisticId ? action.message.id : current.activeLeafId,
        }));
      }
      const next = updateBot(stamped, bot.id, (b) => {
        const adoptsLeaf = adoptsMessageLeaf(b.messages, b.activeLeafId, action.message);
        return { ...b, messages: [...b.messages, action.message], activeLeafId: adoptsLeaf ? action.message.id : b.activeLeafId };
      });
      const motion =
        action.message.role === "user" && action.message.kind === "text" && Boolean(action.message.queueId)
          ? "working"
          : action.message.kind === "options"
          ? "thinking"
          : action.message.kind === "activity"
            ? action.message.tool?.ok === false
              ? "failure"
              : action.message.tool?.ok === true
                ? "success"
                : "working"
            : action.message.role === "bot" && action.message.kind === "text"
              ? "blink"
              : null;
      const animated = motion ? withMascotMotion(next, bot.id, motion) : next;
      return animated;
    }
    case "optimisticMessageRemoved": {
      const id = optimisticMessageId(action.sendId);
      const remove = (messages: Message[], optimistic: Message) => messages
        .filter((message) => message.id !== id)
        .map((message) => message.optimisticThreadOrderAt === optimistic.at
          ? { ...message, optimisticThreadOrderAt: optimistic.optimisticThreadOrderAt }
          : message);
      const bot = state.bots.find((candidate) => candidate.threadId === action.threadId);
      if (bot) {
        const optimistic = bot.messages.find((message) => message.id === id);
        if (!optimistic) return state;
        const cleared = updateBot(state, bot.id, (current) => ({
          ...current,
          messages: remove(current.messages, optimistic),
          activeLeafId: current.activeLeafId === id
            ? (action.restoreLeafId !== undefined ? action.restoreLeafId : (optimistic.parentId ?? null))
            : current.activeLeafId,
        }));
        const task = bot.tasks?.find((candidate) => candidate.threadId === action.threadId);
        const kept = cleared.bots.find((candidate) => candidate.id === bot.id)?.messages ?? [];
        return rewindThreadUpdatedAt(cleared, action.threadId, kept, task?.createdAt ?? 0, bot.hasMore ? optimistic.optimisticThreadOrderAt : undefined);
      }
      const group = state.groups.find((candidate) => candidate.threadId === action.threadId);
      const optimistic = group?.messages.find((message) => message.id === id);
      if (!group || !optimistic) return state;
      const cleared = {
        ...state,
        groups: state.groups.map((candidate) => candidate.id === group.id
          ? { ...candidate, messages: remove(candidate.messages, optimistic) }
          : candidate),
      };
      const task = group.tasks?.find((candidate) => candidate.threadId === action.threadId);
      const kept = cleared.groups.find((candidate) => candidate.id === group.id)?.messages ?? [];
      return rewindThreadUpdatedAt(cleared, action.threadId, kept, task?.createdAt ?? group.createdAt, group.hasMore ? optimistic.optimisticThreadOrderAt : undefined);
    }
    case "messagePatched": {
      const stamped = movesThreadToTop(action.message) ? bumpThreadUpdatedAt(state, action.threadId, action.message.at, true, action.message.turnCompletedAt ?? action.message.at) : state;
      const bot = stamped.bots.find((b) => b.threadId === action.threadId);
      if (!bot) {
        const group = stamped.groups.find((g) => g.threadId === action.threadId);
        if (!group) return stamped;
        return {
          ...stamped,
          groups: stamped.groups.map((g) =>
            g.id === group.id
              ? { ...g, messages: g.messages.map((m) => (m.id === action.message.id ? action.message : m)) }
              : g,
          ),
        };
      }
      const motion =
        action.message.kind === "activity"
          ? action.message.tool?.ok === false
            ? "failure"
            : action.message.tool?.ok === true
              ? "success"
              : "working"
          : null;
      const next = motion ? withMascotMotion(stamped, bot.id, motion) : stamped;
      return updateBot(next, bot.id, (b) => ({
        ...b,
        messages: b.messages.map((m) => (m.id === action.message.id ? action.message : m)),
      }));
    }
    case "computerStart": {
      const { [action.botId]: _ended, ...others } = state.computerStarts;
      return {
        ...(action.start ? withMascotMotion(state, action.botId, "launch") : state),
        computerStarts: action.start ? { ...others, [action.botId]: action.start } : others,
      };
    }
    case "computerControl":
      return {
        ...state,
        computerControl: {
          ...state.computerControl,
          [action.botId]: { held: action.held, helpReason: action.helpReason, help: action.help ?? null },
        },
      };
    case "modelVariantRuntime": {
      const event = action.event;
      if (!event.turnId) return state;
      const owner = state.bots.find((bot) => bot.threadId === event.threadId || bot.tasks?.some((task) => task.threadId === event.threadId));
      if (!owner) return state;
      const selection = currentTaskBot(owner, event.threadId).modelSelection;
      if (selection.instanceId !== event.providerInstanceId ||
          !state.instances.find((instance) => instance.instanceId === selection.instanceId)?.capabilities?.modelVariants) return state;
      const previous = state.modelVariantSessions[event.threadId];
      if (event.type === "turn.started") {
        if (previous && (previous.turnId === event.turnId || Date.parse(previous.startedAt) > Date.parse(event.createdAt))) return state;
        return { ...state, modelVariantSessions: { ...state.modelVariantSessions, [event.threadId]: {
          instanceId: selection.instanceId, model: selection.model, turnId: event.turnId, startedAt: event.createdAt, acceptingUpdates: true,
        } } };
      }
      if (!previous?.acceptingUpdates || previous.turnId !== event.turnId || previous.instanceId !== selection.instanceId || previous.model !== selection.model) return state;
      if (event.type === "session.model-variants" && event.model === selection.model) {
        return { ...state, modelVariantSessions: { ...state.modelVariantSessions, [event.threadId]: { ...previous, variants: event.variants } } };
      }
      if (event.type === "turn.completed") {
        return { ...state, modelVariantSessions: { ...state.modelVariantSessions, [event.threadId]: { ...previous, acceptingUpdates: false } } };
      }
      return state;
    }
    case "setModel":
      if (action.threadId) {
        const picked = reducer(state, { type: "updateTask", botId: action.botId, threadId: action.threadId,
          patch: { modelSelection: action.selection, resetApprovalToAsk: action.resetApprovalToAsk } });
        return updateBot(picked, action.botId, (bot) => ({ ...bot, tasks: bot.tasks?.map((task) => task.threadId !== action.threadId ? task
          : { ...task, followsBotModel: Boolean(action.updateBotDefault) || sameModelSelection(action.selection, bot.modelSelection) }) }));
      }
      return reconcileModelVariantSessions(updateBot(state, action.botId, (b) => ({ ...b, modelSelection: action.selection })));
    case "updateTask": {
      const patch = taskPatchFields(action.patch);
      return reconcileModelVariantSessions(updateBot(state, action.botId, (bot) => ({
        ...bot,
        tasks: (bot.tasks ?? [{ threadId: bot.threadId, title: "New thread", createdAt: Date.now() }]).map((task) =>
          task.threadId === action.threadId ? { ...task, ...patch } : task),
      })));
    }
    case "connected":
      return { ...state, connected: action.value };
    case "error":
      return {
        ...(action.message && state.selectedId
          ? withMascotMotion(state, state.selectedId, "alert")
          : state),
        error: action.message,
        errorInformational: action.informational === true,
      };
    case "toggleSettings": {
      if (action.botId !== undefined && !state.bots.some((bot) => bot.id === action.botId && !bot.hidden)) return state;
      const selectedId = action.botId ?? state.selectedId;
      const open = action.open ?? (action.botId !== undefined || !state.settingsOpen);
      const freshOpen = open && !state.settingsOpen;
      const named = action.section !== undefined;
      return {
        ...state,
        selectedId,
        settingsOpen: open,
        activityOpen: open ? false : state.activityOpen,
        botSettingsSection: action.section ?? state.botSettingsSection,
        botSettingsExpandAccordion: open ? named || (freshOpen && state.botSettingsSectionStored) : false,
        botSettingsExpandRemembered: open ? !named && freshOpen && state.botSettingsSectionStored : false,
        botSettingsSectionStored: named || state.botSettingsSectionStored,
        appSettingsOpen: open ? false : state.appSettingsOpen,
      };
    }
    case "togglePlugins": {
      const open = action.open ?? !state.pluginsOpen;
      return {
        ...state,
        pluginsOpen: open,
        pluginsSurface: action.surface ?? state.pluginsSurface,
        ...(open ? { settingsOpen: false, appSettingsOpen: false, newBotOpen: false, shortcutsOpen: false } : {}),
      };
    }
    case "botCreationPending":
      return { ...state, botCreationPending: action.on };
    case "toggleNewBot": {
      const open = action.open ?? !state.newBotOpen;
      return {
        ...state, newBotOpen: open,
        ...(open ? { settingsOpen: false, appSettingsOpen: false, pluginsOpen: false, shortcutsOpen: false } : {}),
      };
    }
    case "notice":
      return { ...state, notice: action.notice };
    case "revealThread":
      return { ...state, revealThread: { threadId: action.threadId, nonce: (state.revealThread?.nonce ?? 0) + 1 } };
    case "focusMessage":
      return {
        ...state,
        focusMessage: {
          threadId: action.threadId,
          messageId: action.messageId,
          matchText: action.matchText,
          nonce: (state.focusMessage?.nonce ?? 0) + 1,
          consumed: false,
        },
      };
    case "focusMessageConsumed":
      if (!state.focusMessage || state.focusMessage.nonce !== action.nonce) return state;
      return { ...state, focusMessage: { ...state.focusMessage, consumed: true } };
    case "unreadDividerDone":
      return state.unreadDivider?.threadId === action.threadId ? { ...state, unreadDivider: null } : state;
    case "openDataResult": {
      if (!state.bots.some((bot) => bot.id === action.botId)) return state;
      const selected = reducer(reducer(state, { type: "select", id: action.botId }), { type: "toggleComputer", open: true });
      return { ...selected, dataResultFocus: { botId: action.botId, id: action.cardId, requestId: (state.dataResultFocus?.requestId ?? 0) + 1, consumed: false } };
    }
    case "dataResultFocusConsumed":
      return state.dataResultFocus?.requestId === action.requestId
        ? { ...state, dataResultFocus: { ...state.dataResultFocus, consumed: true } } : state;
    case "openSignIn": {
      if (!state.bots.some((bot) => bot.id === action.botId)) return state;
      const selected = reducer(reducer(state, { type: "select", id: action.botId }), { type: "toggleComputer", open: true });
      const { type: _, ...request } = action;
      return { ...selected, signInFocus: { ...request, requestId: (state.signInFocus?.requestId ?? 0) + 1, consumed: false } };
    }
    case "signInFocusConsumed":
      return state.signInFocus?.requestId === action.requestId
        ? { ...state, signInFocus: { ...state.signInFocus, consumed: true } } : state;
    case "toggleComputer": {
      const open = action.open ?? !state.computerOpen;
      return {
        ...state, selectedId: action.botId !== undefined && state.bots.some((bot) => bot.id === action.botId) ? action.botId : state.selectedId,
        computerOpen: open,
        settingsOpen: open ? false : state.settingsOpen,
        inspectorOpen: open ? false : state.inspectorOpen,
        activityOpen: open ? false : state.activityOpen,
        appSettingsOpen: open ? false : state.appSettingsOpen,
        notificationsOpen: open && !state.notificationsPinned ? false : state.notificationsOpen,
      };
    }
    case "toggleInspector": {
      const open = action.open ?? !state.inspectorOpen;
      return {
        ...state,
        inspectorOpen: open,
        settingsOpen: open ? false : state.settingsOpen,
        computerOpen: open ? false : state.computerOpen,
        activityOpen: open ? false : state.activityOpen,
        appSettingsOpen: open ? false : state.appSettingsOpen,
        notificationsOpen: open && !state.notificationsPinned ? false : state.notificationsOpen,
      };
    }
    case "toggleActivity": {
      const open = action.open ?? !state.activityOpen;
      return {
        ...state,
        activityOpen: open,
        settingsOpen: open ? false : state.settingsOpen,
        computerOpen: open ? false : state.computerOpen,
        inspectorOpen: open ? false : state.inspectorOpen,
        appSettingsOpen: open ? false : state.appSettingsOpen,
        notificationsOpen: open && !state.notificationsPinned ? false : state.notificationsOpen,
      };
    }
    case "toggleNotifications": {
      const open = action.open ?? !state.notificationsOpen;
      return {
        ...state,
        notificationsOpen: open,
        settingsOpen: open ? false : state.settingsOpen,
        computerOpen: open ? false : state.computerOpen,
        inspectorOpen: open ? false : state.inspectorOpen,
        activityOpen: open ? false : state.activityOpen,
        appSettingsOpen: open ? false : state.appSettingsOpen,
      };
    }
    case "toggleNotificationsPinned":
      return { ...state, notificationsPinned: action.pinned ?? !state.notificationsPinned };
    case "notificationsHydrated":
    case "notificationReceived":
    case "notificationRead":
    case "notificationsMarkAllRead":
    case "notificationsResolved":
      return { ...state, notifications: reduceNotificationFeed(state.notifications, action) };
    case "toggleAppSettings": {
      const open = action.open ?? !state.appSettingsOpen;
      return {
        ...state,
        appSettingsOpen: open,
        activityOpen: open ? false : state.activityOpen,
        appSettingsSection: action.section ?? state.appSettingsSection,
        appSettingsCloudLink: action.cloudLink && open ? state.appSettingsCloudLink + 1 : 0,
        appSettingsPhonePairing: action.phonePairing && open ? state.appSettingsPhonePairing + 1 : 0,
        settingsOpen: open ? false : state.settingsOpen,
        computerOpen: open ? false : state.computerOpen,
        inspectorOpen: open ? false : state.inspectorOpen,
        pluginsOpen: open ? false : state.pluginsOpen,
        notificationsOpen: open && !state.notificationsPinned ? false : state.notificationsOpen,
      };
    }
    case "toggleShortcuts": {
      const open = action.open ?? !state.shortcutsOpen;
      return {
        ...state,
        shortcutsOpen: open,
      };
    }
    case "openCloudAdd":
      return { ...state, cloudAdd: state.cloudAdd ?? { source: action.source, ...(action.signIn ? { signIn: true as const } : {}) }, cloudHowTo: false };
    case "closeCloudAdd":
      return state.cloudAdd ? { ...state, cloudAdd: null } : state;
    case "cloudHowTo":
      return state.cloudHowTo === action.open ? state : { ...state, cloudHowTo: action.open };
    case "toggleTour": {
      const open = action.open ?? !state.tourOpen;
      return { ...state, tourOpen: open, appSettingsOpen: open ? false : state.appSettingsOpen };
    }
    case "toggleWelcome": {
      const open = action.open ?? !state.welcomeOpen;
      return {
        ...state,
        welcomeOpen: open,
        appSettingsOpen: open ? false : state.appSettingsOpen,
        shortcutsOpen: open ? false : state.shortcutsOpen,
      };
    }
    case "updateBot": {
      const mascotChanged =
        Object.prototype.hasOwnProperty.call(action.patch, "color") ||
        Object.prototype.hasOwnProperty.call(action.patch, "mascotExpression");
      const animated = mascotChanged
        ? withMascotMotion(state, action.botId, "customize")
        : state;
      const target = animated.bots.find((bot) => bot.id === action.botId);
      const chiefSection = (action.patch.section ?? target?.section)?.trim() || "";
      const next = action.patch.chiefOfStaff
        ? {
            ...animated,
            bots: animated.bots.map((b) =>
              b.id === action.botId || (b.section?.trim() || "") !== chiefSection
                ? b
                : { ...b, chiefOfStaff: false },
            ),
          }
        : animated;
      const {
        acknowledgeLocalAuto: _localAck,
        applyToAllThreads: _allThreads,
        keepThreadModels: _keepThreadModels, threadId: _threadId,
        computer,
        connectorTools,
        connectorScopes,
        ...rest
      } = action.patch;
      const botPatch: Partial<Bot> = { ...rest };
      if (computer === null) botPatch.computer = undefined;
      else if (computer !== undefined) botPatch.computer = computer;
      if (connectorTools === null) botPatch.connectorTools = undefined;
      else if (connectorTools !== undefined) botPatch.connectorTools = connectorTools;
      if (connectorScopes === null) botPatch.connectorScopes = undefined;
      else if (connectorScopes !== undefined) botPatch.connectorScopes = connectorScopes;
      return updateBot(next, action.botId, (b) => ({ ...b, ...botPatch }));
    }
    case "threadActive": {
      const bot = state.bots.find((b) => b.threadId === action.threadId);
      if (!bot) return state;
      return updateBot({ ...state, ...movedBranchTranscript(state, action.threadId) }, bot.id, (b) => ({ ...b, activeLeafId: action.activeLeafId }));
    }
    case "switchBranch": {
      const bot = state.bots.find((b) => b.id === action.botId);
      if (!bot) return state;
      let cur = action.messageId;
      for (;;) {
        const children = bot.messages.filter((m) => m.parentId === cur);
        if (!children.length) break;
        cur = children.reduce((a, b) => (b.at >= a.at ? b : a)).id;
      }
      return updateBot({ ...state, ...movedBranchTranscript(state, bot.threadId) }, action.botId, (b) => ({ ...b, activeLeafId: cur }));
    }
    case "patchGroup":
      return {
        ...state,
        groups: state.groups.map((g) => (g.id === action.groupId ? { ...g, ...action.patch } : g)),
      };
    case "pendingQueued": {
      if (state.consumedQueueIds[action.queueId]) {
        const consumedQueueIds = { ...state.consumedQueueIds };
        delete consumedQueueIds[action.queueId];
        return { ...state, consumedQueueIds };
      }
      const prev = state.pendingQueued[action.threadId] ?? [];
      if (prev.some((entry) => entry.queueId === action.queueId)) return state;
      return {
        ...state,
        pendingQueued: {
          ...state.pendingQueued,
          [action.threadId]: [...prev, { queueId: action.queueId, text: action.text, ...(action.reason ? { reason: action.reason } : {}) }],
        },
      };
    }
    case "consumePendingQueued": {
      const prev = state.pendingQueued[action.threadId] ?? [];
      const at = prev.findIndex((entry) => entry.queueId === action.queueId);
      if (at < 0) {
        return {
          ...state,
          consumedQueueIds: rememberConsumedQueueId(state.consumedQueueIds, action.queueId),
        };
      }
      const rest = prev.filter((_, i) => i !== at);
      const pendingQueued = { ...state.pendingQueued };
      if (rest.length) pendingQueued[action.threadId] = rest;
      else delete pendingQueued[action.threadId];
      return { ...state, pendingQueued, consumedQueueIds: rememberConsumedQueueId(state.consumedQueueIds, action.queueId) };
    }
    case "cancelQueued": {
      const bot = state.bots.find((candidate) => candidate.id === action.botId);
      if (!bot) return state;
      const threadId = action.threadId ?? bot.threadId;
      const prev = state.pendingQueued[threadId] ?? [];
      const rest = prev.filter((entry) => entry.queueId !== action.queueId);
      const pendingQueued = { ...state.pendingQueued };
      if (rest.length) pendingQueued[threadId] = rest;
      else delete pendingQueued[threadId];
      return { ...state, pendingQueued, consumedQueueIds: rememberConsumedQueueId(state.consumedQueueIds, action.queueId) };
    }
    case "steerQueued":
      return state;
    case "cancelGroupQueued": {
      const prev = state.pendingQueued[action.threadId] ?? [];
      const rest = prev.filter((entry) => entry.queueId !== action.queueId);
      if (rest.length === prev.length) return state;
      const pendingQueued = { ...state.pendingQueued };
      if (rest.length) pendingQueued[action.threadId] = rest;
      else delete pendingQueued[action.threadId];
      return { ...state, pendingQueued };
    }
    case "send": {
      const animated = withMascotMotion(
        dismissOnboardingCard(state, action.botId),
        action.botId,
        "working",
      );
      if (!action.sendId) return animated;
      const bot = animated.bots.find((candidate) => candidate.id === action.botId);
      const threadId = action.threadId ?? bot?.threadId;
      if (!bot || threadId !== bot.threadId) return animated;
      if (bot.messages.some((message) => message.sendId === action.sendId)) return animated;
      const message = optimisticUserMessage(
        action.text,
        action.sendId,
        action.replyToId,
        bot.activeLeafId,
      );
      message.optimisticThreadOrderAt = bot.tasks?.find((task) => task.threadId === threadId)?.lastThreadOrderAt;
      return bumpThreadUpdatedAt(updateBot(animated, bot.id, (current) => ({
        ...current,
        messages: [...current.messages, message],
        activeLeafId: message.id,
      })), threadId, message.at, true);
    }
    case "editMessage": {
      const animated = withMascotMotion(state, action.botId, "working");
      if (!action.sendId) return animated;
      const bot = animated.bots.find((candidate) => candidate.id === action.botId);
      const threadId = action.threadId ?? bot?.threadId;
      if (!bot || threadId !== bot.threadId) return animated;
      if (bot.messages.some((message) => message.sendId === action.sendId)) return animated;
      const source = bot.messages.find((message) => message.id === action.messageId);
      if (!source || source.role !== "user" || source.kind !== "text") return animated;
      const message = optimisticUserMessage(
        action.text.trim(),
        action.sendId,
        source.replyToId,
        source.parentId ?? null,
      );
      message.optimisticThreadOrderAt = bot.tasks?.find((task) => task.threadId === threadId)?.lastThreadOrderAt;
      return bumpThreadUpdatedAt(updateBot(animated, bot.id, (current) => ({
        ...current,
        messages: [...current.messages, message],
        activeLeafId: message.id,
      })), threadId, message.at, true);
    }
    case "deleteTask":
    case "newGroupTask":
    case "switchGroupTask":
    case "deleteGroupTask":
    case "regenerateTaskTitle":
      return state;
    case "newTask":
      return action.cwd !== undefined ? state : { ...state, selectedId: action.botId, activeView: "chat" };
    case "switchTask": {
      const { [action.threadId]: _old, ...backgroundThreadEvents } = state.backgroundThreadEvents;
      return updateBot({ ...state, backgroundThreadEvents, selectedId: action.botId, activeView: "chat" }, action.botId,
        (bot) => ({ ...bot, switchingTo: action.threadId }));
    }
    case "switchTaskFailed":
      return updateBot(state, action.botId, (bot) => bot.switchingTo === action.threadId ? { ...bot, switchingTo: undefined } : bot);
    case "renameTask":
      return updateBot(state, action.botId, (bot) => ({
        ...bot,
        tasks: (bot.tasks ?? []).map((task) =>
          task.threadId === action.threadId ? { ...task, title: action.title } : task,
        ),
      }));
    case "renameGroupTask":
      return patchGroupTask(state, action.groupId, action.threadId, { title: action.title });
    case "pinGroupTask":
      return patchGroupTask(state, action.groupId, action.threadId, { pinned: action.pinned ? true : undefined });
    case "setConversationTurnLimit":
      if (!action.dm) return patchGroupTask(state, action.groupId, action.threadId, { turnTimeoutMinutes: action.minutes ?? undefined });
      return { ...state, groups: state.groups.map((group) => group.id === action.groupId ? { ...group, turnTimeoutMinutes: action.minutes ?? undefined } : group) };
    case "taskSwitched": {
      const previous = state.bots.find((candidate) => candidate.id === action.bot.id);
      const sameThread = Boolean(previous && previous.threadId === action.bot.threadId);
      const incoming = action.bot.messages ?? [];
      const merged = previous && sameThread && incoming.length ? mergeTranscriptRows(previous.messages, incoming) : null;
      const fenced = sameThread ? (merged?.rebased ? action.bot.threadId : undefined) : action.bot.threadId;
      let switched = updateBot(bumpTranscriptGeneration(state, fenced), action.bot.id, (bot) => ({
        ...bot,
        ...action.bot,
        computer: action.bot.computer,
        toolScope: action.bot.toolScope,
        teamLead: action.bot.teamLead,
        managedSections: action.bot.managedSections,
        vpsAlias: action.bot.vpsAlias,
        messages: merged ? merged.messages : sameThread ? bot.messages : incoming,
        activeLeafId: sameThread ? mergeTranscriptLeaf(bot.activeLeafId, action.bot.activeLeafId, bot.messages, incoming) : action.bot.activeLeafId,
        hasMore: sameThread
          ? (merged ? mergedHasMore(merged.rebased, action.bot.hasMore, bot.hasMore) : action.bot.hasMore ?? bot.hasMore)
          : action.bot.hasMore,
        awaitingThreadSnapshot: false,
        switchingTo: undefined,
      }));
      for (const frame of state.backgroundThreadEvents[action.bot.threadId] ?? []) switched = reducer(switched, frame);
      const { [action.bot.threadId]: _settled, ...backgroundThreadEvents } = switched.backgroundThreadEvents;
      switched = { ...switched, backgroundThreadEvents };
      const opened = switched.bots.find((bot) => bot.id === action.bot.id);
      if (opened && opened.id === switched.selectedId) {
        switched = { ...switched, unreadDivider: openedUnreadDivider(switched, opened.threadId, threadOpensUnread(opened), visibleMessages(opened), threadReadCursor(opened)) };
        // The snapshot predates the switch's own announcement and must not put the unread dot back, nor on the side
        // conversations the list no longer shows (opening the bot read them too).
        if (switched.activeView === "chat") switched = updateBot(switched, opened.id, (bot) => {
          const hidden = new Set(hiddenUnreadThreads(bot, bot.threadId));
          const tasks = bot.tasks?.map((task) => task.threadId === bot.threadId || hidden.has(task.threadId) ? { ...task, unread: false } : task);
          return { ...bot, unread: botShowsUnread({ unread: false, tasks }), tasks };
        });
      }
      return reconcileModelVariantSessions(reconcileSnapshotQueues(switched, [action.bot]));
    }
    case "newBot":
    case "duplicateBot":
    case "createProject":
    case "updateProject":
    case "deleteProject":
    case "reorderProjects":
    case "interrupt":
    case "createGroup":
    case "deleteGroup":
    case "interruptGroup":
    case "setGroupHold":
    case "steerGroupQueued":
    case "createRoutine":
    case "updateRoutine":
    case "deleteRoutine":
    case "runRoutine":
    case "cancelRoutineRun":
    case "markRoutineRunSeen":
    case "markAllRoutineRunsSeen":
    case "refreshTaskPermissions":
    case "followBotModel":
    case "loadDataSheet":
      return state;
    case "dataSheet":
      return {
        ...state,
        dataSheets: { ...state.dataSheets, [action.sheet.botId]: action.sheet },
        ...(action.tables ? { dataTables: { ...state.dataTables, [action.sheet.botId]: action.tables } } : {}),
      };
    case "dataView":
      return { ...state, dataView: action.view };
    case "sendGroup": {
      if (!action.sendId) return state;
      const group = state.groups.find((candidate) => candidate.id === action.groupId);
      if (!group) return state;
      const threadId: string = action.threadId ?? group.threadId;
      if (threadId === group.threadId && group.messages.some((message) => message.sendId === action.sendId)) return state;
      const message = optimisticUserMessage(
        action.text,
        action.sendId,
        action.replyToId,
        null,
        action.mode ?? "chat",
      );
      message.optimisticThreadOrderAt = group.tasks?.find((task) => task.threadId === threadId)?.lastThreadOrderAt;
      const stamped = bumpThreadUpdatedAt(state, threadId, message.at, threadId === group.threadId);
      if (threadId !== group.threadId) return stamped;
      return {
        ...stamped,
        groups: stamped.groups.map((candidate) => candidate.id === group.id
          ? { ...candidate, messages: [...candidate.messages, message] }
          : candidate),
      };
    }
  }
}

export function dataTablesFromResponse(body: unknown): DataTable[] {
  const tables = body && typeof body === "object" && "tables" in body ? (body as { tables: unknown }).tables : undefined;
  return Array.isArray(tables) ? (tables as DataTable[]).filter((table) => table && typeof table.name === "string") : [];
}

export function dataSheetFromResponse(body: unknown, botId: string): DataSheet {
  const candidate = body && typeof body === "object" && "sheet" in body ? (body as { sheet: unknown }).sheet : body;
  if (candidate && typeof candidate === "object" && Array.isArray((candidate as DataSheet).cards)) {
    const sheet = candidate as DataSheet;
    return { ...sheet, botId: sheet.botId || botId, sources: Array.isArray(sheet.sources) ? sheet.sources : [] };
  }
  return { version: 1, botId, cards: [], sources: [], updatedAt: new Date(0).toISOString() };
}

export const initialState: AppState = {
  modelVariantSessions: {},
  backgroundThreadEvents: {},
  loadingOlder: {},
  olderFailed: {},
  transcriptGeneration: {},
  bots: [],
  groups: [],
  sections: [],
  instances: [],
  config: null,
  liveCall: null,
  liveCallVersion: 0,
  liveCallLookupSeq: 0,
  selectedId: "",
  activeView: "chat",
  directId: null,
  routines: [],
  routineRuns: [],
  routinesLoadState: "loading",
  routinesFocus: { nonce: 0 },
  filesSuggest: null,
  webhooks: [],
  webhookAttempts: [],
  webhookIngress: null,
  settingsOpen: false,
  pluginsOpen: false,
  pluginsSurface: "apps",
  newBotOpen: false,
  botCreationPending: false,
  computerOpen: false,
  inspectorOpen: false,
  activityOpen: false,
  notificationsOpen: false,
  notificationsPinned: false,
  notifications: [],
  appSettingsOpen: false,
  appSettingsSection: "general",
  appSettingsCloudLink: 0,
  appSettingsPhonePairing: 0,
  shortcutsOpen: false,
  cloudAdd: null,
  cloudHowTo: false,
  welcomeOpen: false,
  tourOpen: false,
  botSettingsSection: "overview",
  botSettingsExpandAccordion: false,
  botSettingsSectionStored: false,
  botSettingsExpandRemembered: false,
  computerStarts: {},
  deletingBots: {},
  computerControl: {},
  dataSheets: {},
  dataTables: {},
  dataResultFocus: null,
  signInFocus: null,
  dataView: null,
  focusMessage: null,
  unreadDivider: null,
  connected: false,
  error: null,
  errorInformational: false,
  notice: null,
  revealThread: null,
  mascotMotion: null,
  pendingQueued: {},
  consumedQueueIds: {},
};

/** A missing `call` key is malformed, never "the line is free". */
export function liveCallFromFrame(frame: unknown): { call: LiveCallState | null } | null {
  if (!frame || typeof frame !== "object" || !Object.prototype.hasOwnProperty.call(frame, "call")) return null;
  const call: unknown = Reflect.get(frame, "call");
  if (call === null) return { call: null };
  if (!call || typeof call !== "object") return null;
  const record = call as Record<string, unknown>;
  if (typeof record.callId !== "string" || typeof record.botId !== "string" || typeof record.threadId !== "string" || typeof record.status !== "string") {
    return null;
  }
  return { call: call as LiveCallState };
}

let liveCallLookups = 0;
export function nextLiveCallLookup(): number {
  liveCallLookups += 1;
  return liveCallLookups;
}

export { api, ApiError };

/** `visibility` rides the create itself, so the bot is never announced to people who should not see it. */
export async function createBotWithRole(role?: BotRole, request: typeof api = api, visibility?: BotVisibility, section?: string): Promise<{ bot: Bot; profileError?: string }> {
  const restricted = visibility && visibility !== "everyone" ? { visibility } : {};
  const fields = { ...(role ? { name: role.name, title: role.title, description: role.description } : {}), ...restricted,
    ...(section !== undefined ? { section } : {}) };
  const { bot } = await request("/api/bots", {
    method: "POST",
    ...(Object.keys(fields).length ? { body: JSON.stringify(fields) } : {}),
  });
  if (!role) return { bot };
  try {
    const { bot: patched } = await request(`/api/bots/${bot.id}`, {
      method: "PATCH", body: JSON.stringify(roleProfilePatch(role)),
    });
    return { bot: { ...bot, ...patched, messages: bot.messages } };
  } catch (error) {
    return { bot, profileError: error instanceof Error ? error.message : String(error) };
  }
}

/** Messages per snapshot thread and per scrollback page: the server's own page maximum. */
export const MESSAGE_PAGE_SIZE = 200;
/** Nordus: messages per conversation in the start-up list. Most of a page is tool activity, so 200 a conversation
 *  made the list hundreds of KB; older ones still come in pages of MESSAGE_PAGE_SIZE when the chat scrolls up. */
export { STARTUP_MESSAGES, LIST_PREVIEW_MESSAGES } from "@/lib/early-requests";
/** Messages a start-up list holds for a conversation the person is not opening: enough for the row's preview and ordering.
 *  Opening one pages the rest in (see the shallow top-up in StoreProvider). */
/** About 5.5 KB of ids; past it the request line nears Node's 16 KB header limit, so the server sends every page instead. */
const HELD_THREADS_MAX = 150;

/** Everything, or with a cursor: what changed after it plus each conversation the device does not hold. */
export function snapshotPath(since: string | null, state: Pick<AppState, "bots" | "groups" | "selectedId">): string {
  const query = new URLSearchParams({ messages: String(STARTUP_MESSAGES), preview: String(LIST_PREVIEW_MESSAGES) });
  // The conversation about to open (the one on screen, or the last one open) comes with its full first page.
  const opening = state.selectedId || readLastConversation();
  if (opening) query.set("focus", opening);
  if (since) {
    query.set("since", since);
    // A bot waiting for its switched conversation's first page holds nothing of it yet.
    const held = [...state.bots.filter((bot) => !bot.awaitingThreadSnapshot), ...state.groups].map((owner) => owner.threadId);
    if (held.length <= HELD_THREADS_MAX) query.set("held", held.join(","));
  }
  return `/api/bots?${query}`;
}

interface Transcript {
  threadId: string;
  messages: Message[];
  hasMore?: boolean;
  activeLeafId?: string | null;
  awaitingThreadSnapshot?: boolean;
  switchingTo?: string;
}

export interface AskedThreads {
  bots: Record<string, string>;
  groups: Record<string, string>;
}

export function askedThreads(state: Pick<AppState, "bots" | "groups">): AskedThreads {
  return {
    bots: Object.fromEntries(state.bots.map((bot) => [bot.id, bot.threadId])),
    groups: Object.fromEntries(state.groups.map((group) => [group.id, group.threadId])),
  };
}

/** A snapshot's page folds into the conversation the device holds, or replaces another one, and a delta leaves out only a
 * conversation the device said it holds and that did not change. A device that moved to another conversation after asking
 * shows something newer than the snapshot. */
function snapshotTranscript(
  incoming: Omit<Transcript, "messages"> & { messages?: Message[] },
  previous: Transcript | undefined,
  delta: boolean,
  asked: string | undefined,
): Partial<Transcript> & { messages: Message[]; rebased?: boolean } {
  const moved = previous !== undefined && asked !== undefined && previous.threadId !== asked && previous.threadId !== incoming.threadId;
  if (!moved && previous?.threadId === incoming.threadId && (Array.isArray(incoming.messages) || !delta)) {
    return mergeSnapshotTranscript(previous, { ...incoming, messages: incoming.messages ?? [] });
  }
  if (!moved && Array.isArray(incoming.messages)) return { messages: incoming.messages, hasMore: incoming.hasMore };
  if (!previous || (!moved && !delta)) return { messages: incoming.messages ?? [] };
  const { threadId, messages, hasMore, activeLeafId, awaitingThreadSnapshot, switchingTo } = previous;
  return threadId === incoming.threadId
    ? { messages, hasMore, activeLeafId }
    : { threadId, messages, hasMore, activeLeafId, awaitingThreadSnapshot, switchingTo };
}


type TrustedApprovalBridge = {
  setMode(
    botId: string,
    mode: ApprovalMode,
    options?: { acknowledgeLocalAuto?: boolean; threadId?: string; threadOnly?: boolean; allThreads?: boolean; refreshPermissions?: boolean },
  ): Promise<BotAnnouncement>;
};

export function desktopApprovalBridge(): TrustedApprovalBridge | undefined {
  if (typeof window === "undefined" || !window.ogb?.approvals) return undefined;
  return desktopCapabilitiesNow().host.packaged ? window.ogb.approvals : undefined;
}

export async function persistTaskApproval(
  botId: string, threadId: string, patch: TaskUpdatePatch,
  bridge: TrustedApprovalBridge | undefined,
  request: (path: string, init?: RequestInit) => Promise<{ bot: BotAnnouncement }> = api,
): Promise<BotAnnouncement> {
  const { approvalMode, autoApprove, acknowledgeLocalAuto, ...ordinary } = patch;
  const mode = approvalMode ?? (autoApprove === undefined ? undefined : autoApprove ? "auto" : "ask");
  if (mode === "custom" && !bridge) throw new Error("This approval change requires the packaged desktop app");
  if (mode && bridge) {
    if (Object.keys(ordinary).length) await request(`/api/bots/${botId}/tasks/${threadId}`, { method: "PATCH", body: JSON.stringify(ordinary) });
    return bridge.setMode(botId, mode, { threadId, threadOnly: true, acknowledgeLocalAuto: acknowledgeLocalAuto === true });
  }
  const result = await request(`/api/bots/${botId}/tasks/${threadId}`, { method: "PATCH", body: JSON.stringify({ ...ordinary, approvalMode, autoApprove, acknowledgeLocalAuto }) });
  return result.bot;
}

/** Custom authority never goes over the bot-accessible HTTP API; entering grants it after ordinary fields, leaving revokes it first. */
export async function persistBotUpdate(
  botId: string,
  patch: BotUpdatePatch,
  signal: AbortSignal,
  request: (path: string, init?: RequestInit) => Promise<{ bot: BotAnnouncement }> = api,
  trustedApprovals: TrustedApprovalBridge | undefined = desktopApprovalBridge(),
  currentBot?: BotAnnouncement,
): Promise<BotAnnouncement> {
  const {
    approvalMode,
    applyToAllThreads,
    ...ordinaryPatch
  } = patch;
  const leavesCustom = approvalMode !== undefined && approvalMode !== "custom" &&
    (approvalModeFor(currentBot ?? {}) === "custom" ||
      (applyToAllThreads === true && threadApprovalModes(currentBot ?? {}).includes("custom")));
  const viaBridge = approvalMode === "custom" || leavesCustom ||
    (approvalMode === "full" && trustedApprovals !== undefined);

  if (!viaBridge) {
    const result = await request(`/api/bots/${botId}`, {
      method: "PATCH",
      body: JSON.stringify(
        approvalMode === undefined ? ordinaryPatch : {
          ...ordinaryPatch,
          approvalMode,
          ...(applyToAllThreads ? { applyToAllThreads: true } : {}),
        },
      ),
      signal,
    });
    return result.bot;
  }

  if (!trustedApprovals || approvalMode === undefined) {
    throw new Error("This approval-level change requires the packaged desktop app");
  }

  const trustedOptions = {
    acknowledgeLocalAuto: ordinaryPatch.acknowledgeLocalAuto === true,
    ...(applyToAllThreads ? { allThreads: true } : {}),
  };

  const rejectCancelledTrustedGrant = async () => {
    if (!signal.aborted) return;
    // IPC cannot cancel a grant already at the embedded server: revoke an aborted Full/Custom grant before reporting cancellation.
    if (approvalMode === "full" || approvalMode === "custom") {
      try {
        await trustedApprovals.setMode(botId, "ask", { acknowledgeLocalAuto: false, ...(applyToAllThreads ? { allThreads: true } : {}) });
      } catch (error) {
        throw new Error(
          `The cancelled ${approvalMode === "full" ? "Full access" : "Custom approval"} grant could not be revoked: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    throw new DOMException("The bot update was cancelled", "AbortError");
  };

  if (leavesCustom) {
    const modeBot = await trustedApprovals.setMode(botId, approvalMode, trustedOptions);
    await rejectCancelledTrustedGrant();
    if (Object.keys(ordinaryPatch).length === 0) return modeBot;
    const result = await request(`/api/bots/${botId}`, {
      method: "PATCH",
      body: JSON.stringify(ordinaryPatch),
      signal,
    });
    return result.bot;
  }

  if (Object.keys(ordinaryPatch).length > 0) {
    await request(`/api/bots/${botId}`, {
      method: "PATCH",
      body: JSON.stringify(ordinaryPatch),
      signal,
    });
  }
  if (signal.aborted) throw new DOMException("The bot update was cancelled", "AbortError");
  const modeBot = await trustedApprovals.setMode(botId, approvalMode, trustedOptions);
  await rejectCancelledTrustedGrant();
  return modeBot;
}

/** Non-optimistic: local state changes only after the server removed the bot and any computer only it owned. */
const pendingBotDeletions = new Map<string, Promise<void>>();

export async function requestConfirmedBotDeletion<Answer>(
  botId: string,
  requestDelete: (botId: string) => Promise<Answer>,
  onConfirmed: (botId: string, answer: Answer) => void,
): Promise<void> {
  const existing = pendingBotDeletions.get(botId);
  if (existing) return existing;
  const deletion = (async () => {
    onConfirmed(botId, await requestDelete(botId));
  })();
  pendingBotDeletions.set(botId, deletion);
  try {
    await deletion;
  } finally {
    if (pendingBotDeletions.get(botId) === deletion) pendingBotDeletions.delete(botId);
  }
}

export interface PeripheralSnapshotLoad<Key extends string = string> {
  key: Key;
  load: () => Promise<void>;
}

function normalizeSnapshotFailure(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}

export async function loadSnapshotBoundary<Key extends string>(
  loadChat: () => Promise<void>,
  peripherals: readonly PeripheralSnapshotLoad<Key>[],
  onPeripheralFailure: (part: PeripheralSnapshotLoad<Key>, error: Error) => void,
): Promise<boolean> {
  const [chat, ...settledPeripherals] = await Promise.allSettled([
    loadChat(),
    ...peripherals.map((part) => part.load()),
  ]);
  settledPeripherals.forEach((result, index) => {
    if (result.status === "rejected") {
      onPeripheralFailure(peripherals[index]!, normalizeSnapshotFailure(result.reason));
    }
  });
  return chat.status === "fulfilled";
}

export const StoreContext = createContext<{
  state: AppState;
  dispatch: React.Dispatch<Action>;
  flushBotPatches: (botId: string) => Promise<BotAnnouncement | null>;
  refreshInstances: (options?: { reportErrors?: boolean }) => Promise<void>;
  refreshModels: (instanceId: string) => Promise<void>;
} | null>(null);

function restoreBotSettingsSection(state: AppState): AppState {
  const section = readLastBotSection();
  return section ? { ...state, botSettingsSection: section, botSettingsSectionStored: true } : state;
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const taskWrites = useRef(new Map<string, { botId: string; updatesDefault: boolean; promise: Promise<BotAnnouncement>; execution: Promise<unknown>; patch: TaskUpdatePatch }>()).current;
  const withTaskWrites = (bot: BotAnnouncement): BotAnnouncement => ({
    ...bot,
    tasks: bot.tasks?.map((task) => ({ ...task, ...taskPatchFields(taskWrites.get(task.threadId)?.patch ?? {}) })),
  });
  const [state, rawDispatch] = useReducer(retainingReducer, initialState, restoreBotSettingsSection);
  const stateRef = useRef(state);
  stateRef.current = state;
  const olderPageRequests = useRef(new Map<string, { controller: AbortController; generation: number }>()).current;
  useEffect(() => {
    const shown = state.bots.find((bot) => bot.id === state.selectedId)?.threadId ??
      state.groups.find((group) => group.id === state.selectedId)?.threadId;
    for (const [threadId, request] of olderPageRequests) {
      if (threadId === shown && request.generation === (state.transcriptGeneration[threadId] ?? 0)) continue;
      request.controller.abort();
      olderPageRequests.delete(threadId);
      rawDispatch({ type: "olderMessages", threadId, generation: request.generation, messages: [], hasMore: true, canceled: true });
    }
  }, [olderPageRequests, state.bots, state.groups, state.selectedId, state.transcriptGeneration]);
  const showThreads = useShowThreads();
  const showThreadsRef = useRef(showThreads);
  showThreadsRef.current = showThreads;
  const clearChatError = useCallback(() => {
    rawDispatch({ type: "error", message: null });
  }, []);
  useChatErrorClear(state.error, clearChatError, !state.errorInformational);
  useEffect(() => {
    preloadAvatars(state.bots);
    preloadAvatars(state.groups);
  }, [state.bots, state.groups]);
  useEffect(() => {
    if (state.selectedId) rememberConversation(state.selectedId);
  }, [state.selectedId]);
  useEffect(() => {
    if (state.settingsOpen && state.botSettingsExpandAccordion) rememberBotSection(state.botSettingsSection);
  }, [state.settingsOpen, state.botSettingsExpandAccordion, state.botSettingsSection]);
  const profileEditsAwaitingSave = useMemo(() => new Set<string>(), []);
  const botPatchQueue = useMemo(
    () =>
      createBotPatchQueue({
        send: (botId, patch, signal, currentBot) =>
          persistBotUpdate(botId, patch, signal, api, desktopApprovalBridge(), currentBot),
        reconcile: async (botId, signal) => {
          const result: { bots: BotAnnouncement[] } = await api(`/api/bots?messages=${MESSAGE_PAGE_SIZE}`, { signal });
          return result.bots.find((candidate) => candidate.id === botId) ?? null;
        },
        onAuthoritative: (bot, optimisticOverlay) => {
          if (profileEditsAwaitingSave.delete(bot.id)) showToast(t("toast.saved"));
          rawDispatch({ type: "botPatched", bot: withTaskWrites({ ...bot, ...optimisticOverlay }) });
        },
        onError: (error) => {
          rawDispatch({ type: "error", message: error.message });
        },
      }),
    [],
  );

  useEffect(() => {
    // StrictMode runs this cleanup once against the same memoized queue; revive undoes it.
    botPatchQueue.revive();
    return () => botPatchQueue.dispose();
  }, [botPatchQueue]);

  const dispatch = useMemo(() => {
    const navigation = new Map<string, number>();
    let selectionRevision = 0;
    let creatingBot = false;
    const showError = (e: unknown) => {
      rawDispatch({ type: "error", message: e instanceof Error ? e.message : String(e) });
    };
    const showSavedState = (owner: SavedOwner) => (error: unknown) => {
      showError(error);
      void api<SavedSnapshot>("/api/bots?messages=0").then((snapshot) => {
        const saved = savedStateAction(owner, snapshot);
        if (saved?.type === "botPatched") rawDispatch({ ...saved, bot: withTaskWrites({ ...saved.bot, ...botPatchQueue.overlayFor(saved.bot.id) }) });
        else if (saved) rawDispatch(saved);
      }).catch(() => {});
    };
    const cardTarget = (action: { botId: string; messageId: string; groupId?: string }) => {
      const host = action.groupId
        ? stateRef.current.groups.find((g) => g.id === action.groupId)
        : stateRef.current.bots.find((b) => b.id === action.botId);
      return { host, card: host?.messages.find((m) => m.id === action.messageId)?.card, inRoom: !!action.groupId };
    };
    const persistCard = (botId: string, messageId: string, patch: Partial<OptionCardData>) => {
      fetch(`/api/bots/${botId}/cards/${messageId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      }).catch(() => {});
    };

    // A send that waited on a settings save that failed must not go out later under the old settings: status 409 makes
    // the send outbox treat it as refused instead of retrying it.
    const waitForExecutionSettings = (expectedBots: Bot[], threadId?: string) =>
      executionSettingsSaved(expectedBots, threadId).catch((error: unknown) => {
        throw Object.assign(new Error(error instanceof Error ? error.message : String(error)), { status: 409 });
      });
    const executionSettingsSaved = async (expectedBots: Bot[], threadId?: string) => {
      // Capture this send's task save before waiting on slower profile saves.
      const taskWrite = threadId ? taskWrites.get(threadId)?.execution : undefined;
      const defaultWrites = [...taskWrites.values()].filter((write) => write.updatesDefault && expectedBots.some((bot) => bot.id === write.botId));
      await Promise.all([taskWrite, ...defaultWrites.map((write) => write.execution), ...expectedBots.map(async (expected) => {
        const persisted = await botPatchQueue.flush(expected.id);
        if (!persisted) return;
        const expectedSelection = expected.modelSelection;
        if (
          approvalModeFor(persisted) !== approvalModeFor(expected) ||
          (persisted.memoryEnabled !== false) !== (expected.memoryEnabled !== false) ||
          persisted.modelSelection.instanceId !== expectedSelection.instanceId ||
          persisted.modelSelection.model !== expectedSelection.model ||
          persisted.modelSelection.effort !== expectedSelection.effort ||
          persisted.modelSelection.variant !== expectedSelection.variant
        ) {
          throw new Error("The approval level, memory setting, or model could not be saved, so this work was not started");
        }
      })]);
      if (threadId) await taskWrites.get(threadId)?.execution;
    };

    const persistTaskPatch = (botId: string, threadId: string, patch: TaskUpdatePatch) => {
      const previous = taskWrites.get(threadId);
      const defaults = patch.updateBotDefault || patch.approvalMode !== undefined
        ? [...taskWrites.values()].filter((write) => write.botId === botId) : [];
      const promise = Promise.all([previous?.promise, ...defaults.map((write) => write.promise)].map((save) => save?.catch(() => {})))
        .then(async () => {
          if (patch.resetApprovalToAsk && window.ogb?.approvals) {
            return window.ogb.approvals.setMode(botId, "ask", {
              threadId, modelSelection: patch.modelSelection, updateBotDefault: Boolean(patch.updateBotDefault),
            });
          }
          return persistTaskApproval(botId, threadId, patch, desktopApprovalBridge());
        });
      const execution = Promise.all([previous?.execution, promise]);
      void execution.catch(() => {});
      const pending = { botId, updatesDefault: Boolean(patch.updateBotDefault || previous?.updatesDefault), patch: { ...previous?.patch, ...patch }, promise, execution };
      taskWrites.set(threadId, pending);
      void pending.promise.then((bot) => {
        if (taskWrites.get(threadId) !== pending) return;
        taskWrites.delete(threadId);
        if (bot) rawDispatch({ type: "botPatched", bot: withTaskWrites(bot) });
      }).catch((error) => {
        showError(error);
        // Keep blocking sends while reconciliation fails or a newer write owns this lane.
        if (taskWrites.get(threadId) === pending) {
          pending.patch = {};
          void api(`/api/bots?messages=${MESSAGE_PAGE_SIZE}`).then(({ bots }) => {
            if (taskWrites.get(threadId) !== pending) return;
            const bot = bots.find((candidate: Bot) => candidate.id === botId);
            if (bot) {
              rawDispatch({ type: "botPatched", bot: withTaskWrites(bot) });
              taskWrites.delete(threadId);
            }
          }).catch(() => {});
        }
      });
    };

    /** Capture before the optimistic reducer runs, so approval/model writes cannot race a resuming response. */
    const executionBotsForThread = (threadId: string): Bot[] => {
      const snapshot = stateRef.current;
      const botIds = new Set<string>();
      for (const bot of snapshot.bots) {
        if (bot.threadId === threadId || bot.tasks?.some((task) => task.threadId === threadId)) {
          botIds.add(bot.id);
        }
      }
      for (const group of snapshot.groups) {
        if (group.threadId === threadId || group.tasks?.some((task) => task.threadId === threadId)) {
          for (const memberId of group.memberIds) botIds.add(memberId);
        }
      }
      return snapshot.bots.filter((bot) => botIds.has(bot.id));
    };

    const wrapped: React.Dispatch<Action> = (action) => {
      if (["select", "newTask", "switchTask", "newGroupTask", "switchGroupTask", "showChat", "showDirect", "showRoutines", "showTeamMap", "showFiles", "showToday", "showBoard", "showInbox", "showDrive", "showWiki"].includes(action.type)) selectionRevision++;
      // Pin before any await or optimistic state change.
      action = pinBotThreadAction(action, stateRef.current.bots);
      if (action.type === "taskSwitched") action = { ...action, bot: withTaskWrites(action.bot) as Bot };
      if (action.type === "botPatched") action = { ...action, bot: withTaskWrites(action.bot) };
      if ((action.type === "send" || action.type === "sendGroup" || action.type === "editMessage") && !action.sendId) {
        action = { ...action, sendId: crypto.randomUUID() };
      }
      const botBeforeUpdate =
        action.type === "updateBot" || action.type === "setModel"
          ? stateRef.current.bots.find((candidate) => candidate.id === action.botId)
          : undefined;
      const botBeforeSend =
        action.type === "send"
          ? stateRef.current.bots.find((candidate) => candidate.id === action.botId)
          : undefined;
      const leafBeforeEdit =
        action.type === "editMessage"
          ? stateRef.current.bots.find((candidate) => candidate.id === action.botId)?.activeLeafId ?? null
          : null;
      const executionBotsBeforeAction = (() => {
        if (action.type === "editMessage" || action.type === "answerCard") {
          const bot = stateRef.current.bots.find((candidate) => candidate.id === action.botId);
          return bot ? [bot] : [];
        }
        if (action.type === "decideRequest") {
          const bots = executionBotsForThread(action.threadId);
          if (!action.alwaysAllow || bots.some((bot) => bot.id === action.alwaysAllow?.botId)) {
            return bots;
          }
          const grantBot = stateRef.current.bots.find((bot) => bot.id === action.alwaysAllow?.botId);
          return grantBot ? [...bots, grantBot] : bots;
        }
        if (action.type === "sendGroup") {
          const memberIds = stateRef.current.groups.find((group) => group.id === action.groupId)?.memberIds ?? [];
          return stateRef.current.bots.filter((candidate) => memberIds.includes(candidate.id));
        }
        if (action.type === "runRoutine") {
          const routine = stateRef.current.routines.find((candidate) => candidate.id === action.routineId);
          if (!routine) return [];
          const ids = new Set([routine.botId]);
          if (routine.target === "room-goal" && routine.groupId) {
            const group = stateRef.current.groups.find((candidate) => candidate.id === routine.groupId);
            for (const memberId of group?.memberIds ?? []) ids.add(memberId);
          }
          return stateRef.current.bots.filter((candidate) => ids.has(candidate.id));
        }
        return [];
      })();
      const quizBeforeSend = (() => {
        if (action.type !== "send") return undefined;
        return botBeforeSend ? openOnboardingCard(botBeforeSend) : undefined;
      })();
      if (
        action.type !== "cancelQueued" &&
        action.type !== "cancelGroupQueued" &&
        action.type !== "deleteBot"
      ) rawDispatch(action);
      // Components dispatch this with the server's answer to their own save; the next reader of /api/config gets it too.
      if (action.type === "configStatus") applyConfig(action.config);
      switch (action.type) {
        case "loadOlderMessages": {
          // The guard, not the reducer flag: stateRef still holds the pre-dispatch state.
          if (olderPageRequests.has(action.threadId)) break;
          const current = stateRef.current;
          const owner = [...current.bots, ...current.groups].find((candidate) => candidate.threadId === action.threadId);
          const before = owner?.messages[0]?.id;
          const generation = current.transcriptGeneration[action.threadId] ?? 0;
          if (!before) {
            rawDispatch({ type: "olderMessages", threadId: action.threadId, generation, messages: [], hasMore: false });
            break;
          }
          const request = new AbortController();
          olderPageRequests.set(action.threadId, { controller: request, generation });
          api<{ messages: Message[]; hasMore?: boolean }>(
            `/api/threads/${action.threadId}/messages?limit=${action.limit ?? MESSAGE_PAGE_SIZE}&before=${encodeURIComponent(before)}`,
            { signal: request.signal },
          )
            .then((page) => {
              if (request.signal.aborted) return;
              rawDispatch({
                type: "olderMessages",
                threadId: action.threadId,
                generation,
                messages: page.messages ?? [],
                hasMore: Boolean(page.hasMore),
              });
            })
            .catch((error) => {
              if (request.signal.aborted) return;
              rawDispatch({ type: "olderMessages", threadId: action.threadId, generation, messages: [], hasMore: true, failed: true });
              showError(error);
            })
            .finally(() => {
              if (olderPageRequests.get(action.threadId)?.controller === request) olderPageRequests.delete(action.threadId);
            });
          break;
        }
        case "notice":
          if (action.notice) setTimeout(() => rawDispatch({ type: "notice", notice: null }), action.notice.kind === "note" ? 20_000 : 6000);
          break;
        case "createRoutine":
          api("/api/routines", { method: "POST", body: JSON.stringify(action.input) }).catch(showError);
          break;
        case "updateRoutine":
          api(`/api/routines/${action.routineId}`, { method: "PATCH", body: JSON.stringify(action.patch) })
            .then(({ routine }) => rawDispatch({ type: "routinePatched", routine }), showError);
          break;
        case "deleteRoutine":
          api(`/api/routines/${action.routineId}`, { method: "DELETE" }).catch(showError);
          break;
        case "revokeTaskRelease":
          api(`/api/bots/${action.botId}/tasks/${action.threadId}/release`, { method: "DELETE" }).catch(showError);
          break;
        case "runRoutine":
          void waitForExecutionSettings(executionBotsBeforeAction)
            .then(() => api(`/api/routines/${action.routineId}/run`, { method: "POST" }))
            .then(({ run }) => action.onStarted?.(run))
            .catch((error) => {
              if (action.onError) action.onError(error);
              else showError(error);
            })
            .finally(() => action.onSettled?.());
          break;
        case "cancelRoutineRun":
          api(`/api/routine-runs/${action.runId}/cancel`, { method: "POST" }).catch(showError);
          break;
        case "loadDataSheet":
          api(DATA_ROUTES.sheet(action.botId))
            .then((body) => rawDispatch({ type: "dataSheet", sheet: dataSheetFromResponse(body, action.botId), tables: dataTablesFromResponse(body) }))
            .catch((error) => (action.onError ?? showError)(error instanceof Error ? error.message : String(error)));
          break;
        case "markRoutineRunSeen":
          api(`/api/routine-runs/${action.runId}/seen`, { method: "POST" }).catch(showError);
          break;
        case "markAllRoutineRunsSeen":
          api("/api/routine-runs/seen-all", { method: "POST" }).catch(showError);
          break;
        case "cancelQueued":
          void api(`/api/bots/${action.botId}/queue/${action.queueId}`, { method: "DELETE", body: JSON.stringify({ threadId: action.threadId }) })
            .then(() => {
              rawDispatch(action);
              action.onCancelled?.();
            })
            .catch(showError);
          break;
        case "steerQueued":
          void api(`/api/bots/${action.botId}/queue/${action.queueId}/steer`, { method: "POST", body: JSON.stringify({ threadId: action.threadId }) })
            .then((body) => {
              if (body?.steered === true && Array.isArray(body.messages) && typeof body.threadId === "string") {
                for (const message of body.messages) {
                  rawDispatch({ type: "messageAdded", threadId: body.threadId, message });
                }
                for (const queueId of body.queueIds ?? []) {
                  rawDispatch({ type: "consumePendingQueued", threadId: body.threadId, queueId });
                }
              } else if (body?.queued === true && body.blockedBy === "images") {
                wrapped({ type: "notice", notice: { kind: "steer-images", botName: null } });
              }
              action.onSettled?.();
            })
            .catch((error) => {
              showError(error);
              action.onError?.();
            });
          break;
        case "cancelGroupQueued":
          void api(`/api/groups/${action.groupId}/queue/${action.queueId}`, { method: "DELETE" })
            .then(() => {
              rawDispatch(action);
              action.onCancelled?.();
            })
            .catch(showError);
          break;
        case "steerGroupQueued":
          void api(`/api/groups/${action.groupId}/queue/${action.queueId}/steer`, {
            method: "POST",
            body: JSON.stringify({ threadId: action.threadId }),
          })
            .then((body) => {
              if (body?.steered === true && Array.isArray(body.messages) && typeof body.threadId === "string") {
                for (const message of body.messages) {
                  rawDispatch({ type: "messageAdded", threadId: body.threadId, message });
                }
                for (const queueId of body.queueIds ?? []) {
                  rawDispatch({ type: "consumePendingQueued", threadId: body.threadId, queueId });
                }
              } else if (body?.queued === true && body.blockedBy === "images") {
                wrapped({ type: "notice", notice: { kind: "steer-images", botName: null } });
              }
              action.onSettled?.();
            })
            .catch((error) => {
              showError(error);
              action.onError?.();
            });
          break;
        case "send": {
          if (quizBeforeSend) persistCard(action.botId, quizBeforeSend.id, { dismissed: true });
          const threadId =
            action.threadId ?? stateRef.current.bots.find((bot) => bot.id === action.botId)?.threadId;
          const sendId = action.sendId ?? crypto.randomUUID();
          void waitForExecutionSettings(botBeforeSend ? [botBeforeSend] : [], threadId)
            .then(() => api(`/api/bots/${action.botId}/messages`, {
                method: "POST",
                body: JSON.stringify({ text: action.text, replyToId: action.replyToId, threadId, sendId, ...(action.dataContext ? { dataContext: action.dataContext } : {}) }),
              }))
            .then((body) => {
              if (body?.message && typeof body.threadId === "string") {
                rawDispatch({ type: "messageAdded", threadId: body.threadId, message: body.message });
              }
              if (
                body?.queued &&
                typeof body.threadId === "string" &&
                typeof body.queueId === "string"
              ) {
                rawDispatch({
                  type: "optimisticMessageRemoved",
                  threadId: body.threadId,
                  sendId,
                });
                rawDispatch({
                  type: "pendingQueued",
                  threadId: body.threadId,
                  queueId: body.queueId,
                  text: action.text,
                  reason: body.reason === "capacity" || body.reason === "group-turn" ? body.reason : undefined,
                });
              }
            })
            .then(() => action.onSent?.())
            .catch((error) => {
              if (threadId) {
                rawDispatch({ type: "optimisticMessageRemoved", threadId, sendId });
              }
              if (!action.quiet) showError(error);
              action.onError?.(error);
            });
          break;
        }
        case "editMessage": {
          const threadId =
            action.threadId ?? stateRef.current.bots.find((bot) => bot.id === action.botId)?.threadId;
          const sendId = action.sendId ?? crypto.randomUUID();
          void waitForExecutionSettings(executionBotsBeforeAction, threadId)
            .then(() => api(`/api/bots/${action.botId}/messages/${action.messageId}/edit`, {
              method: "POST",
              body: JSON.stringify({ text: action.text.trim(), threadId, sendId }),
            }))
            .then((body) => {
              if (body?.message && threadId) {
                rawDispatch({ type: "messageAdded", threadId, message: body.message });
              }
            })
            .catch((error) => {
              if (threadId) {
                rawDispatch({ type: "optimisticMessageRemoved", threadId, sendId, restoreLeafId: leafBeforeEdit });
              }
              showError(error);
            });
          break;
        }
        case "switchBranch":
          api(`/api/bots/${action.botId}/active-branch`, {
            method: "POST",
            body: JSON.stringify({ messageId: action.messageId, threadId: action.threadId }),
          }).catch(showError);
          break;
        case "decideRequest": {
          const respond = () =>
            api(`/api/threads/${action.threadId}/respond`, {
              method: "POST",
              body: JSON.stringify({
                requestId: action.requestId,
                behavior: action.behavior,
                message: action.message,
                reviewedSha256: action.reviewedSha256,
                always: action.always,
                rememberCommand: action.rememberCommand,
                releaseTask: action.releaseTask,
              }),
            });
          void waitForExecutionSettings(executionBotsBeforeAction, action.threadId)
            .then(async () => {
              if (action.alwaysAllow) {
                const bot = stateRef.current.bots.find((candidate) => candidate.id === action.alwaysAllow?.botId);
                const owner = bot?.tasks?.some((task) => task.threadId === action.threadId);
                const next = [...new Set([...(bot ? currentTaskBot(bot, action.threadId).alwaysAllow ?? [] : []), action.alwaysAllow.key])];
                // Save the grant BEFORE releasing the bot: it may ask again within milliseconds.
                try {
                  await api(owner ? `/api/bots/${action.alwaysAllow.botId}/always-allow` : `/api/bots/${action.alwaysAllow.botId}`, {
                    method: owner ? "POST" : "PATCH",
                    body: JSON.stringify(owner ? { threadId: action.threadId, allowKey: action.alwaysAllow.key } : { alwaysAllow: next }),
                  });
                } catch (error) {
                  showError(error);
                }
              }
              const response = await respond();
              if (response?.settlementPending && typeof response.message === "string") {
                showError(new Error(response.message));
              }
            })
            .catch((error) => {
              // A failed settings flush stops the response so work never resumes under a stale approval level.
              showError(error);
              action.onError?.(error instanceof Error ? error.message : String(error));
            });
          break;
        }
        case "answerCard": {
          const { host, card, inRoom } = cardTarget(action);
          void waitForExecutionSettings(executionBotsBeforeAction, action.threadId)
            .then(() => {
              if (card?.requestId && host) {
                const response = card.skillRequest
                  ? { behavior: skillRequestBehavior(action.answer) }
                  : answerResponse(card, action.answer);
                return api(`/api/threads/${action.threadId ?? host.threadId}/respond`, {
                  method: "POST",
                  body: JSON.stringify({
                    requestId: card.requestId,
                    ...response,
                    reviewedSha256: response.behavior === "allow" && card.skillRequest
                      ? reviewedSkillSha256(card.skillRequest)
                      : undefined,
                  }),
                });
              }
              if (inRoom) return;
              persistCard(action.botId, action.messageId, { answered: action.answer, dismissed: true });
              return api(`/api/bots/${action.botId}/messages`, {
                method: "POST",
                body: JSON.stringify({ text: action.answer, threadId: action.threadId }),
              });
            })
            .catch(showError);
          break;
        }
        case "dismissCard": {
          const { host, card, inRoom } = cardTarget(action);
          if (card?.requestId && host) {
            api(`/api/threads/${action.threadId ?? host.threadId}/respond`, {
              method: "POST",
              body: JSON.stringify({ requestId: card.requestId, ...dismissResponse(card) }),
            }).catch(() => {});
          } else if (!inRoom) {
            persistCard(action.botId, action.messageId, { dismissed: true });
          }
          break;
        }
        case "newBot": {
          // The picker can close/remount before React paints pending state.
          if (creatingBot) break;
          creatingBot = true;
          rawDispatch({ type: "botCreationPending", on: true });
          void createBotWithRole(action.role, api, action.visibility, action.section)
            .then(({ bot, profileError }) => {
              rawDispatch({ type: "botAdded", bot, preserveSelection: action.preserveSelection });
              action.onCreated?.(bot);
              if (profileError) {
                showError(t("newBot.profileFailed", { error: profileError }));
                rawDispatch({ type: "toggleSettings", open: true, section: "soul" });
              }
            })
            .catch((error) => {
              if (action.onError) action.onError(error instanceof Error ? error.message : String(error));
              else showError(error);
            })
            .finally(() => {
              creatingBot = false;
              rawDispatch({ type: "botCreationPending", on: false });
            });
          break;
        }
        case "duplicateBot": {
          const source = stateRef.current.bots.find((b) => b.id === action.botId);
          if (!source) break;
          const duplicateProfile = duplicateBotProfile(source);
          // A copy of a restricted bot is restricted from its first moment.
          api("/api/bots", {
            method: "POST",
            body: JSON.stringify(restrictedCopyRequest(source)),
          })
            .then(({ bot }) =>
              api(`/api/bots/${bot.id}`, {
                method: "PATCH",
                body: JSON.stringify(duplicateProfile),
              }).then(({ bot: patched }) =>
                rawDispatch({ type: "botAdded", bot: { ...bot, ...patched, messages: bot.messages } }),
              ),
            )
            .catch(showError);
          break;
        }
        case "deleteBot":
          rawDispatch({ type: "botDeletionPending", botId: action.botId, on: true });
          void requestConfirmedBotDeletion(
            action.botId,
            async (botId) => {
              // Flush first so an older debounced PATCH cannot land after a successful DELETE.
              await botPatchQueue.flush(botId);
              return api<{ notice?: string } | undefined>(`/api/bots/${botId}`, { method: "DELETE" });
            },
            (botId, answer) => {
              botPatchQueue.cancel(botId);
              rawDispatch({ type: "deleteBot", botId });
              if (answer?.notice) wrapped({ type: "notice", notice: { kind: "note", botName: null, text: answer.notice } });
            },
          )
            .catch(showError)
            .finally(() => rawDispatch({ type: "botDeletionPending", botId: action.botId, on: false }));
          break;
        case "markUnread":
          api(`/api/bots/${action.botId}`, { method: "PATCH", body: JSON.stringify({ unread: true }) }).catch(
            () => {},
          );
          break;
        case "openDataResult":
        case "select": {
          const id = action.type === "select" ? action.id : action.botId;
          const bot = stateRef.current.bots.find((b) => b.id === id);
          const group = stateRef.current.groups.find((g) => g.id === id);
          if (bot) {
            const threads = [...(bot.unread || bot.tasks?.find((task) => task.threadId === bot.threadId)?.unread ? [bot.threadId] : []), ...hiddenUnreadThreads(bot, bot.threadId)];
            for (const threadId of threads) {
              api(`/api/bots/${id}/read`, { method: "POST", body: JSON.stringify({ threadId }) }).catch(() => {});
            }
          } else if (group?.unread) {
            api(`/api/groups/${id}/read`, { method: "POST" }).catch(() => {});
          }
          break;
        }
        case "createGroup":
          api(`/api/groups`, {
            method: "POST",
            body: JSON.stringify({
              memberIds: action.memberIds,
              name: action.name,
              section: action.section,
              ...(action.people?.length ? { people: action.people } : {}),
              ...(window.ogb?.remoteClient?.active
                ? { setup: { bulletin: "", defaultResponder: { kind: "mentions" } } }
                : {}),
            }),
          })
            .then(({ group }) => {
              rawDispatch({ type: "groupPatched", group });
              rawDispatch({ type: "select", id: group.id });
            })
            .catch(showError);
          break;
        case "sendGroup": {
          const threadId =
            action.threadId ?? stateRef.current.groups.find((group) => group.id === action.groupId)?.threadId;
          const sendId = action.sendId ?? crypto.randomUUID();
          void waitForExecutionSettings(executionBotsBeforeAction)
            .then(() => api(`/api/groups/${action.groupId}/messages`, {
              method: "POST",
              body: JSON.stringify({
                text: action.text,
                replyToId: action.replyToId,
                threadId,
                sendId,
                mode: action.mode ?? "chat",
              }),
            }))
            .then((body) => {
              if (body?.message && typeof body.threadId === "string") {
                rawDispatch({ type: "messageAdded", threadId: body.threadId, message: body.message });
              }
              if (
                body?.queued &&
                typeof body.threadId === "string" &&
                typeof body.queueId === "string"
              ) {
                rawDispatch({
                  type: "optimisticMessageRemoved",
                  threadId: body.threadId,
                  sendId,
                });
                rawDispatch({
                  type: "pendingQueued",
                  threadId: body.threadId,
                  queueId: body.queueId,
                  text: action.text,
                });
              }
            })
            .then(() => action.onSent?.())
            .catch((error) => {
              if (threadId) {
                rawDispatch({ type: "optimisticMessageRemoved", threadId, sendId });
              }
              if (!action.quiet) showError(error);
              action.onError?.(error);
            });
          break;
        }
        case "patchGroup":
          api(`/api/groups/${action.groupId}`, {
            method: "PATCH",
            body: JSON.stringify(action.patch),
          }).catch(showSavedState({ groupId: action.groupId }));
          break;
        case "deleteGroup":
          api(`/api/groups/${action.groupId}`, { method: "DELETE" }).catch(showError);
          break;
        case "setModel":
          if (action.threadId) {
            persistTaskPatch(action.botId, action.threadId, {
              modelSelection: action.selection,
              ...(action.updateBotDefault ? { updateBotDefault: true } : {}),
              ...(action.resetApprovalToAsk ? { resetApprovalToAsk: true } : {}),
            });
            break;
          }
          if (botBeforeUpdate) {
            botPatchQueue.enqueue(
              action.botId,
              { modelSelection: action.selection, threadId: botBeforeUpdate.switchingTo ?? botBeforeUpdate.threadId },
              botBeforeUpdate,
            );
          }
          break;
        case "updateTask":
          persistTaskPatch(action.botId, action.threadId, action.patch);
          break;
        case "refreshTaskPermissions": {
          const bot = stateRef.current.bots.find((candidate) => candidate.id === action.botId);
          const task = bot?.tasks?.find((candidate) => candidate.threadId === action.threadId);
          if (!bot || !task) {
            showError(new Error("That thread is no longer available"));
            break;
          }
          const mode = approvalModeFor(bot);
          const current = approvalModeFor(currentTaskBot(bot, action.threadId));
          const acknowledgeLocalAuto = action.acknowledgeLocalAuto === true;
          const bridge = desktopApprovalBridge();
          const viaBridge = mode === "custom" || current === "custom" || (mode === "full" && bridge !== undefined);
          const refreshed = viaBridge
            ? bridge
              ? bridge.setMode(action.botId, mode, {
                threadId: action.threadId, threadOnly: true, refreshPermissions: true, acknowledgeLocalAuto,
              })
              : Promise.reject(new Error("This approval change requires the packaged desktop app"))
            : api<{ bot: BotAnnouncement }>(`/api/bots/${action.botId}/tasks/${action.threadId}`, {
              method: "PATCH",
              body: JSON.stringify({ refreshPermissions: true, ...(acknowledgeLocalAuto ? { acknowledgeLocalAuto: true } : {}) }),
            }).then((result) => result.bot);
          void refreshed.then((updated) => {
            if (updated) rawDispatch({ type: "botPatched", bot: withTaskWrites(updated) });
          }).catch(showError);
          break;
        }
        case "followBotModel":
          void api<{ bot: BotAnnouncement; busy?: number }>(`/api/bots/${action.botId}/threads/follow-model`, { method: "POST", body: "{}" })
            .then(({ bot, busy }) => { rawDispatch({ type: "botPatched", bot: withTaskWrites(bot) }); action.onSettled?.({ busy: busy ?? 0 }); })
            .catch(showError);
          break;
        case "createProject":
          api(`/api/bots/${action.botId}/projects`, { method: "POST", body: JSON.stringify({ name: action.name, emoji: action.emoji }) })
            .then(({ bot, project }) => {
              dispatch({ type: "botPatched", bot });
              action.onCreated?.(project);
            }).catch((error) => { showError(error); action.onError?.(error instanceof Error ? error.message : String(error)); });
          break;
        case "updateProject":
          api(`/api/bots/${action.botId}/projects/${action.projectId}`, { method: "PATCH", body: JSON.stringify(action.patch) })
            .then(({ bot }) => { dispatch({ type: "botPatched", bot }); action.onSaved?.(); })
            .catch((error) => { showError(error); action.onError?.(error instanceof Error ? error.message : String(error)); });
          break;
        case "deleteProject":
          api(`/api/bots/${action.botId}/projects/${action.projectId}`, { method: "DELETE" })
            .then(({ bot }) => { dispatch({ type: "botPatched", bot }); action.onDeleted?.(); })
            .catch((error) => { showError(error); action.onError?.(error instanceof Error ? error.message : String(error)); });
          break;
        case "reorderProjects":
          api(`/api/bots/${action.botId}/projects/order`, { method: "PATCH", body: JSON.stringify({ projectIds: action.projectIds }) })
            .then(({ bot }) => { dispatch({ type: "botPatched", bot }); action.onSaved?.(); })
            .catch((error) => { showError(error); action.onError?.(error instanceof Error ? error.message : String(error)); });
          break;
        case "interrupt":
          api(`/api/bots/${action.botId}/interrupt`, {
            method: "POST",
            body: action.threadId ? JSON.stringify({ threadId: action.threadId }) : undefined,
          }).catch((error) => {
            showError(error);
            action.onError?.();
          });
          break;
        case "newTask":
        case "switchTask": {
          const revision = (navigation.get(action.botId) ?? 0) + 1;
          navigation.set(action.botId, revision);
          const selectedAtStart = selectionRevision;
          const ready = action.type === "newTask"
            ? botPatchQueue.flush(action.botId)
            : Promise.resolve();
          void ready.then(() => api<{ bot: Bot }>(action.type === "newTask"
            ? `/api/bots/${action.botId}/tasks`
            : `/api/bots/${action.botId}/tasks/${action.threadId}${action.whole ? "" : `?messages=${MESSAGE_PAGE_SIZE}`}`, { method: "POST", body: JSON.stringify(action.type === "newTask" ? { projectId: action.projectId, cwd: action.cwd } : {}) }))
            .then((r) => {
              if (action.type === "newTask") action.onCreated?.();
              if (!r?.bot || navigation.get(action.botId) !== revision) return;
              const selectsAfterCreation = action.type === "newTask" && action.cwd !== undefined;
              if (selectsAfterCreation && selectionRevision !== selectedAtStart) return;
              dispatch({ type: "taskSwitched", bot: r.bot });
              if (selectsAfterCreation) rawDispatch({ type: "select", id: action.botId });
            })
            .catch((error) => {
              if (action.type === "switchTask" && navigation.get(action.botId) === revision) {
                rawDispatch({ type: "switchTaskFailed", botId: action.botId, threadId: action.threadId });
              }
              if (action.type === "newTask" && action.onError) action.onError(error instanceof Error ? error.message : String(error));
              else showError(error);
            });
          break;
        }
        case "renameTask":
          api(`/api/bots/${action.botId}/tasks/${action.threadId}`, {
            method: "PATCH",
            body: JSON.stringify({ title: action.title }),
          }).catch(showSavedState({ botId: action.botId }));
          break;
        case "regenerateTaskTitle":
          api(`/api/bots/${action.botId}/tasks/${action.threadId}/title`, { method: "POST" })
            .then(() => action.onSettled?.(true))
            .catch((error) => { showError(error); action.onSettled?.(false); });
          break;
        case "deleteTask":
          api<{ bot?: BotAnnouncement }>(`/api/bots/${action.botId}/tasks/${action.threadId}`, { method: "DELETE" })
            .then((r) => r?.bot && dispatch({ type: "botPatched", bot: r.bot }))
            .catch(showError);
          break;
        case "newGroupTask":
          api<{ group?: Partial<Group> & { id: string } }>(`/api/groups/${action.groupId}/tasks`, { method: "POST", body: "{}" })
            .then((r) => r?.group && dispatch({ type: "groupPatched", group: r.group }))
            .catch(showError);
          break;
        case "switchGroupTask":
          api<{ group?: Partial<Group> & { id: string } }>(`/api/groups/${action.groupId}/tasks/${action.threadId}?messages=${MESSAGE_PAGE_SIZE}`, { method: "POST" })
            .then((r) => r?.group && dispatch({ type: "groupPatched", group: r.group }))
            .catch(showError);
          break;
        case "renameGroupTask":
          api(`/api/groups/${action.groupId}/tasks/${action.threadId}`, {
            method: "PATCH",
            body: JSON.stringify({ title: action.title }),
          }).catch(showSavedState({ groupId: action.groupId }));
          break;
        case "pinGroupTask":
          api(`/api/groups/${action.groupId}/tasks/${action.threadId}`, {
            method: "PATCH",
            body: JSON.stringify({ pinned: action.pinned, title: action.title }),
          }).catch(showSavedState({ groupId: action.groupId }));
          break;
        case "setConversationTurnLimit":
          api(action.dm ? `/api/groups/${action.groupId}` : `/api/groups/${action.groupId}/tasks/${action.threadId}`, {
            method: "PATCH",
            body: JSON.stringify({ turnTimeoutMinutes: action.minutes }),
          }).catch(showSavedState({ groupId: action.groupId }));
          break;
        case "deleteGroupTask":
          api<{ group?: Partial<Group> & { id: string } }>(`/api/groups/${action.groupId}/tasks/${action.threadId}`, { method: "DELETE" })
            .then((r) => r?.group && dispatch({ type: "groupPatched", group: r.group }))
            .catch(showError);
          break;
        case "setGroupHold":
          api<{ group?: Partial<Group> & { id: string } }>(`/api/groups/${action.groupId}/holds`, {
            method: "POST",
            body: JSON.stringify({ botId: action.botId, held: action.held }),
          })
            .then((r) => r?.group && dispatch({ type: "groupPatched", group: r.group }))
            .catch(showError);
          break;
        case "interruptGroup":
          api(`/api/groups/${action.groupId}/interrupt`, {
            method: "POST",
            body: action.threadId ? JSON.stringify({ threadId: action.threadId }) : undefined,
          }).catch((error) => {
            showError(error);
            action.onError?.();
          });
          break;
        case "updateBot": {
          if (botBeforeUpdate) {
            if (PROFILE_TEXT_FIELDS.some((field) => field in action.patch)) profileEditsAwaitingSave.add(action.botId);
            botPatchQueue.enqueue(action.botId, action.patch, botBeforeUpdate);
          }
          break;
        }
        default:
          break;
      }
    };
    return wrapped;
  }, [botPatchQueue, profileEditsAwaitingSave]);

  const launched = useRef(false);
  useEffect(() => {
    if (!state.hydrated || launched.current) return;
    launched.current = true;
    const bot = state.bots.find((candidate) => candidate.id === state.selectedId);
    if (bot && state.activeView === "chat" && botOpensTo(bot, showThreads) !== bot.threadId) openBot(dispatch, bot, showThreads);
  }, [state.hydrated, state.bots, state.selectedId, state.activeView, showThreads, dispatch]);

  // Nordus: a banner click opens its conversation, whether the worker found this page open or had to open the app.
  const pendingNotificationTarget = useRef<NotificationTarget | null | undefined>(undefined);
  if (pendingNotificationTarget.current === undefined) {
    const taken = typeof window === "undefined" || !window.location?.href ? null : takeNotificationTarget(window.location.href);
    if (taken) window.history.replaceState(null, "", taken.rest);
    pendingNotificationTarget.current = taken?.target ?? null;
  }
  useEffect(() => {
    if (!state.hydrated || !pendingNotificationTarget.current) return;
    const target = pendingNotificationTarget.current;
    pendingNotificationTarget.current = null;
    openNotificationTarget(dispatch, target, stateRef.current, showThreadsRef.current);
  }, [state.hydrated, dispatch]);
  // The start-up list holds only a few messages of a conversation that was not about to open. Opening one tops it up
  // to a first page at once, rather than leaving a few lines until the transcript pages the rest.
  const opened = state.bots.find((bot) => bot.id === state.selectedId) ?? state.groups.find((group) => group.id === state.selectedId);
  const openedShallow = Boolean(opened?.hasMore) && (opened?.messages.length ?? Infinity) <= LIST_PREVIEW_MESSAGES;
  const openedThread = opened?.threadId;
  const openedCount = opened?.messages.length ?? 0;
  useEffect(() => {
    if (!state.hydrated || !openedShallow || !openedThread) return;
    dispatch({ type: "loadOlderMessages", threadId: openedThread, limit: Math.max(STARTUP_MESSAGES - openedCount, 1) });
  }, [state.hydrated, openedShallow, openedThread, openedCount, dispatch]);
  useEffect(() => onNotificationOpen((target) => {
    window.focus();
    openNotificationTarget(dispatch, target, stateRef.current, showThreadsRef.current);
  }), [dispatch]);
  useEffect(() => {
    void registerServiceWorker();
    // A device that already allowed banners signs up (or refreshes) without a trip to Settings.
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      void enablePush({ finished: finishedNotificationsEnabled(), sounds: notificationSoundsEnabled() });
    }
    return startPushPresence();
  }, []);

  useEffect(() => {
    let alive = true;
    let configHydrated = false;
    type PeripheralKey = "instances" | "config" | "routines" | "webhooks" | "notifications";
    type PeripheralPart = {
      key: PeripheralKey;
      request: () => Promise<() => void>;
    };
    type PeripheralRefresh = {
      attempt: number;
      generation: number;
      timer: ReturnType<typeof setTimeout> | null;
      version: number;
    };
    const peripheralRefresh = new Map<PeripheralKey, PeripheralRefresh>();
    // A second snapshot right behind the first (the stream's hello) does not ask for what just arrived.
    const loadedAt = new Map<PeripheralKey, number>();
    const FRESH_MS = 10_000;
    const refreshState = (key: PeripheralKey) => {
      let current = peripheralRefresh.get(key);
      if (!current) {
        current = { attempt: 0, generation: 0, timer: null, version: 0 };
        peripheralRefresh.set(key, current);
      }
      return current;
    };
    const peripheralParts: PeripheralPart[] = [
      {
        key: "instances",
        request: async () => {
          const early = takeEarly("/api/instances");
          const { instances } = await (early ? early.catch(() => api("/api/instances")) : api("/api/instances"));
          return () => rawDispatch({ type: "instances", instances });
        },
      },
      {
        key: "config",
        request: async () => {
          // A re-hydration after a reconnect must see the server's current config, not the first answer.
          const config = await configOnce(configHydrated);
          configHydrated = true;
          return () => rawDispatch({ type: "configStatus", config });
        },
      },
      {
        key: "routines",
        request: async () => {
          if (await sessionIsGuest()) return () => rawDispatch({ type: "routinesHydrated", routines: [], runs: [] });
          const { routines, runs } = await api("/api/routines");
          return () => rawDispatch({ type: "routinesHydrated", routines, runs });
        },
      },
      {
        key: "notifications",
        request: async () => {
          const { notifications } = await api("/api/notifications");
          return () => rawDispatch({ type: "notificationsHydrated", notifications: Array.isArray(notifications) ? notifications : [] });
        },
      },
      ...(window.ogb?.remoteClient?.active ? [] : [{
        key: "webhooks",
        request: async () => {
          if (await sessionIsGuest()) return () => {};
          const { webhooks, attempts, ingress } = await api("/api/webhooks");
          return () =>
            rawDispatch({ type: "webhooksHydrated", webhooks, attempts: attempts ?? [], ingress });
        },
      } satisfies PeripheralPart]),
    ];
    const partByKey = new Map(peripheralParts.map((part) => [part.key, part]));
    const LAZY_LISTS: readonly PeripheralKey[] = ["routines", "notifications", "webhooks"];
    const isLazyList = (key: PeripheralKey): key is LazyListKey => LAZY_LISTS.includes(key);
    const requestedLists = new Set<LazyListKey>();
    const ensureLazyList = (key: LazyListKey) => {
      const part = partByKey.get(key);
      if (!alive || !part || requestedLists.has(key)) return;
      requestedLists.add(key);
      void loadPeripheral(part, false).catch((error) => schedulePeripheralRetry(part, error));
    };
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    const loadListsWhenIdle = () => {
      if (idleTimer) return;
      idleTimer = setTimeout(() => {
        const run = () => { for (const key of LAZY_LISTS) if (isLazyList(key)) ensureLazyList(key); };
        if (typeof requestIdleCallback === "function") requestIdleCallback(run, { timeout: 3_000 });
        else run();
      }, 2_500);
    };
    const schedulePeripheralRetry = (part: PeripheralPart, error?: Error) => {
      if (!alive) return;
      const refresh = refreshState(part.key);
      if (refresh.timer) return;
      if (error !== undefined) {
        if (part.key === "routines") rawDispatch({ type: "routinesLoadFailed" });
        console.warn(`snapshot: ${part.key} refresh failed; retrying`, error);
      }
      const delay = Math.min(30_000, 1_000 * 2 ** Math.min(refresh.attempt, 5));
      refresh.attempt += 1;
      refresh.timer = setTimeout(() => {
        refresh.timer = null;
        const retry = () => void loadPeripheral(part, true).catch((nextError) => schedulePeripheralRetry(part, nextError));
        // A Cloud home asleep: retry once it is awake again, never wake it for this.
        if (!cloudAsleep()) return retry();
        const stop = onCloudPower((asleep) => { if (!asleep) { stop(); if (alive) retry(); } });
      }, delay);
    };
    const loadPeripheral = async (part: PeripheralPart, protectLiveFrames: boolean): Promise<void> => {
      const refresh = refreshState(part.key);
      if (refresh.timer) {
        clearTimeout(refresh.timer);
        refresh.timer = null;
      }
      const generation = ++refresh.generation;
      const version = refresh.version;
      try {
        const apply = await part.request();
        if (!alive || refresh.generation !== generation) return;
        // A retry must never replace a live patch that arrived after its request began.
        if (protectLiveFrames && refresh.version !== version) {
          schedulePeripheralRetry(part);
          return;
        }
        apply();
        refresh.attempt = 0;
        loadedAt.set(part.key, Date.now());
      } catch (error) {
        // A newer refresh owns this lane now.
        if (!alive || refresh.generation !== generation) return;
        throw normalizeSnapshotFailure(error);
      }
    };
    const bumpPeripheralVersion = (...keys: PeripheralKey[]) => {
      for (const key of keys) refreshState(key).version += 1;
    };
    const unregisterLists = registerListLoader(ensureLazyList);
    // The live cursor the last snapshot reflected: a later gap asks only for what changed after it.
    let snapshotCursor: string | null = null;
    const loadAll = async (since: string | null): Promise<boolean> => {
      const liveCallSince = stateRef.current.liveCallVersion;
      const seq = nextLiveCallLookup();
      void api<unknown>("/api/live/call")
        .then((body) => {
          const answer = liveCallFromFrame(body);
          if (alive && answer) flushSync(() => rawDispatch({ type: "liveCallLookup", call: answer.call, since: liveCallSince, seq }));
        })
        .catch(() => {});
      const chat = () => {
        const asked = askedThreads(stateRef.current);
        const path = snapshotPath(since, stateRef.current);
        const early = since === null ? takeEarly(path) : null;
        return (early ? early.catch(() => api(path)) : api(path)).then(({ cursor, delta, bots, groups, sections, computerControl, botQueuedMessages }) => {
          if (!alive) return;
          if (typeof cursor === "string") snapshotCursor = cursor;
          rawDispatch({
            type: "hydrate",
            delta: delta === true,
            askedThreads: asked,
            bots,
            groups: groups ?? [],
            sections: sections ?? [],
            computerControl: computerControl ?? {},
            botQueuedMessages,
            resumeId: readLastConversation() ?? undefined,
          });
        });
      };
      // The lists in LAZY_LISTS wait for the conversation to be ready, unless a screen already asked: then they refresh with it.
      const peripherals = peripheralParts.filter((part) => (!isLazyList(part.key) || requestedLists.has(part.key)) && Date.now() - (loadedAt.get(part.key) ?? 0) > FRESH_MS).map((part) => ({
        key: part.key,
        load: () => loadPeripheral(part, false),
      }));
      const chatReady = await loadSnapshotBoundary(chat, peripherals, (failed, error) => {
        const part = partByKey.get(failed.key);
        if (part) schedulePeripheralRetry(part, error);
      });
      return alive && chatReady;
    };

    // Hydrate only after the stream's hello; queue frames during the REST snapshot and apply them on top.
    let hydrated = false;
    let hydrationPromise: Promise<boolean> | null = null;
    // A request made while a snapshot loads runs after it: from that snapshot's cursor, or everything if any asked for that.
    let rehydrate: "changes" | "everything" | null = null;
    const pendingFrames: ServerFrame[] = [];
    let handleFrame: (frame: ServerFrame) => void;
    /** `since` null loads everything; a cursor loads only what changed after it. */
    const hydrate = (since: string | null): Promise<boolean> => {
      if (hydrationPromise) {
        rehydrate = since === null || rehydrate === "everything" ? "everything" : "changes";
        return hydrationPromise;
      }
      const shown = hydrated;
      hydrated = false;
      hydrationPromise = (async () => {
        let loaded = false;
        let from = since;
        for (;;) {
          rehydrate = null;
          loaded = await loadAll(from);
          if (!alive || rehydrate === null) break;
          from = rehydrate === "everything" ? null : snapshotCursor;
        }
        // A failed snapshot leaves the last good state on screen: live frames keep landing on it while the stream replays
        // the gap from the cursor it never committed, or the next snapshot replaces it.
        if (!alive || (!loaded && !shown)) return false;
        hydrated = true;
        loadListsWhenIdle();
        clearDrafts();
        for (const frame of pendingFrames.splice(0)) handleFrame(frame);
        return loaded;
      })().finally(() => {
        hydrationPromise = null;
      });
      return hydrationPromise;
    };
    // With the answer already on its way (asked before React mounted) the list does not wait for the stream's hello.
    const hydrationFallback = setTimeout(() => void hydrate(null), hasEarly(snapshotPath(null, stateRef.current)) ? 0 : 1_000);
    // Pull to refresh is the escape hatch: it reloads everything.
    resyncHandle = () => hydrate(null).then(() => undefined);

    handleFrame = (frame) => {
      applyDraftFrame(frame, visibleNotificationThread(stateRef.current));
      if (frame.kind === "config") bumpPeripheralVersion("config", "instances");
      else if (frame.kind === "routine" || frame.kind === "routine.deleted" || frame.kind === "routine.run") {
        bumpPeripheralVersion("routines");
      } else if (
        frame.kind === "webhook" ||
        frame.kind === "webhook.attempt" ||
        frame.kind === "webhook.deleted"
      ) {
        bumpPeripheralVersion("webhooks");
      }
      switch (frame.kind) {
        case "sections":
          rawDispatch({ type: "sections", sections: frame.sections });
          break;
        case "bot.queued":
          rawDispatch({ type: "botQueues", queues: frame.queues });
          break;
        case "message": {
          rawDispatch({ type: "messageAdded", threadId: frame.threadId, message: frame.message as Message });
          if (frame.message?.role === "user" && typeof frame.message.queueId === "string") {
            rawDispatch({
              type: "consumePendingQueued",
              threadId: frame.threadId,
              queueId: frame.message.queueId,
            });
          }
          if (frame.message?.role === "bot" && frame.message?.kind === "text") {
            const owner = stateRef.current.bots.find((b) => b.threadId === frame.threadId || b.tasks?.some((task) => task.threadId === frame.threadId));
            const live = stateRef.current.liveCall;
            const onLiveCall = Boolean(live && live.status !== "ended" && live.botId === owner?.id);
            if (owner?.speakReplies && currentCall() === null && !onLiveCall && frame.message.text?.trim()) {
              void speaker.speak(frame.message.text, {
                botId: owner.id,
                messageId: frame.message.id,
                voiceId: owner.voice,
              });
            }
          }
          break;
        }
        case "message.patch":
          rawDispatch({ type: "messagePatched", threadId: frame.threadId, message: frame.message as Message });
          break;
        case "thread":
          rawDispatch({ type: "threadActive", threadId: frame.threadId, activeLeafId: frame.activeLeafId });
          break;
        case "bot": {
          const bot = frame.bot as BotAnnouncement;
          const selected = stateRef.current.bots.find((candidate) => candidate.id === bot.id);
          const shown = selected?.switchingTo ?? selected?.threadId;
          const selectedTask = bot.tasks?.find((task) => task.threadId === shown);
          const hiddenUnread = hiddenUnreadThreads(bot, shown);
          if (bot.id === stateRef.current.selectedId && stateRef.current.activeView === "chat" &&
              (selectedTask?.unread || (!bot.tasks && bot.unread) || hiddenUnread.length > 0)) {
            // The person is looking at this bot: what arrives in its conversation, or in a side conversation the list
            // does not show, is read already.
            const read = new Set([...(selectedTask?.unread || (!bot.tasks && bot.unread) ? [shown] : []), ...hiddenUnread]);
            for (const task of bot.tasks ?? []) if (read.has(task.threadId)) task.unread = false;
            bot.unread = botShowsUnread(bot);
            for (const threadId of read) {
              if (!threadId) continue;
              fetch(`/api/bots/${bot.id}/read`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ threadId }) }).catch(() => {});
            }
          }
          rawDispatch({
            type: "botPatched",
            bot: withTaskWrites({ ...bot, ...botPatchQueue.overlayFor(bot.id) }),
          });
          break;
        }
        case "mcpHealth":
          window.dispatchEvent(new Event(MCP_HEALTH_EVENT));
          break;
        case "group": {
          const group = frame.group as Partial<Group> & { id: string };
          if (group.unread && group.id === stateRef.current.selectedId) {
            group.unread = false;
            fetch(`/api/groups/${group.id}/read`, { method: "POST" }).catch(() => {});
          }
          rawDispatch({ type: "groupPatched", group });
          break;
        }
        case "notify":
          // The wrapped dispatch: only it PATCHes unread:false back to the server.
          showNotification(
            frame.notification,
            (target) => openNotificationTarget(dispatch, target, stateRef.current, showThreadsRef.current),
            stateRef.current.bots.find((bot) => bot.id === frame.notification.botId)?.avatarUrl,
            visibleNotificationThread(stateRef.current),
          );
          rawDispatch({ type: "notificationReceived", entry: frame.notification });
          break;
        case "notify.resolved":
          rawDispatch({ type: "notificationsResolved", ids: frame.ids, at: frame.at });
          break;
        case "group.deleted":
          rawDispatch({ type: "groupDeleted", groupId: frame.groupId });
          break;
        case "routine":
          rawDispatch({ type: "routinePatched", routine: frame.routine });
          break;
        case "routine.deleted":
          rawDispatch({ type: "routineDeleted", routineId: frame.routineId });
          break;
        case "routine.run":
          rawDispatch({ type: "routineRunPatched", run: frame.run });
          break;
        case "webhook":
          rawDispatch({ type: "webhookPatched", webhook: frame.webhook });
          break;
        case "webhook.attempt":
          rawDispatch({ type: "webhookAttempted", attempt: frame.attempt });
          break;
        case "webhook.deleted":
          rawDispatch({ type: "webhookDeleted", webhookId: frame.webhookId });
          break;
        case "runtime": {
          const action = runtimeFrameAction(frame.event);
          if (action) rawDispatch(action);
          break;
        }
        case "screen":
          if (stateRef.current.computerStarts[frame.botId]) {
            rawDispatch({ type: "computerStart", botId: frame.botId, start: null });
          }
          break;
        case "computer":
          rawDispatch({ type: "computerStart", botId: frame.botId,
            start: { state: frame.state, ...(frame.place ? { place: frame.place } : {}) } });
          break;
        case "computer-control":
          rawDispatch({
            type: "computerControl",
            botId: frame.botId,
            held: frame.held === true,
            helpReason: typeof frame.helpReason === "string" ? frame.helpReason : null,
            help: parseComputerHelp(frame.help),
          });
          break;
        case "data":
          rawDispatch({ type: "dataSheet", sheet: frame.sheet });
          break;
        case "bot.deleted":
          botPatchQueue.cancel(frame.botId);
          rawDispatch({ type: "deleteBot", botId: frame.botId });
          break;
        case "live.call": {
          const framed = liveCallFromFrame(frame);
          // Rendered at once: the next bot frame decides auto-speak from stateRef.
          if (framed) flushSync(() => rawDispatch({ type: "liveCall", call: framed.call }));
          break;
        }
        case "config":
          // The frame carries only part of the config; whoever reads /api/config next asks the server.
          resetConfigCache();
          rawDispatch({
            type: "configStatus",
            config: configStatusFromFrame(frame as unknown as ConfigStatusFrame),
          });
          {
            const instances = partByKey.get("instances");
            if (instances) {
              void loadPeripheral(instances, true).catch((error) =>
                schedulePeripheralRetry(instances, error),
              );
            }
          }
          break;
      }
    };
    const stopLive = openLiveEvents({
      onOpen: () => rawDispatch({ type: "connected", value: true }),
      onError: () => {
        rawDispatch({ type: "connected", value: false });
        // EventSource hides the status; a stream that keeps failing may be a browser that lost its session.
        void signedOutWatch.suspect();
      },
      onBuild: noteServedBuild,
      onSnapshotRequired: (since) => {
        clearTimeout(hydrationFallback);
        publishMissedFrames();
        // Frames buffered before a non-resumable stream belong to an abandoned generation.
        pendingFrames.splice(0);
        return hydrate(since ?? snapshotCursor);
      },
      onFrame: (frame) => {
        publishLiveFrame(frame as ServerFrame);
        if (hydrated) handleFrame(frame as ServerFrame);
        else pendingFrames.push(frame as ServerFrame);
      },
    });
    return () => {
      alive = false;
      resyncHandle = null;
      unregisterLists();
      if (idleTimer) clearTimeout(idleTimer);
      clearTimeout(hydrationFallback);
      for (const refresh of peripheralRefresh.values()) {
        if (refresh.timer) clearTimeout(refresh.timer);
      }
      stopLive();
    };
  }, []);

  const instanceProbe = useRef<Promise<void> | null>(null);
  const refreshInstances = useCallback(async (options?: { reportErrors?: boolean }) => {
    const probe = instanceProbe.current ??= api("/api/instances", { timeoutMs: 120_000 }).then(({ instances }) => {
      if (!Array.isArray(instances)) throw new Error(t("engineSetup.invalidStatus"));
      rawDispatch({ type: "instances", instances });
    });
    try {
      await probe;
    } catch (error) {
      if (options?.reportErrors) throw error;
    } finally {
      if (instanceProbe.current === probe) instanceProbe.current = null;
    }
  }, []);

  const refreshModels = useCallback(async (instanceId: string) => {
    const { instances } = await api(`/api/instances/${encodeURIComponent(instanceId)}/refresh-models`, {
      method: "POST",
    });
    rawDispatch({ type: "instances", instances });
  }, []);

  const lastFocusProbe = useRef(0);
  useEffect(() => {
    const onFocus = () => {
      const now = Date.now();
      if (now - lastFocusProbe.current < 30_000) return; // every engine's CLI runs; a Keychain prompt refocuses the window
      lastFocusProbe.current = now;
      void refreshInstances();
    };
    window.addEventListener("focus", onFocus);
    const onVisible = () => { if (document.visibilityState === "visible") onFocus(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refreshInstances]);

  const flushBotPatches = useCallback(
    (botId: string) => botPatchQueue.flush(botId),
    [botPatchQueue],
  );
  const value = useMemo(
    () => ({ state, dispatch, flushBotPatches, refreshInstances, refreshModels }),
    [state, dispatch, flushBotPatches, refreshInstances, refreshModels],
  );
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore outside provider");
  return ctx;
}

export function BotEditorStore({ value, children }: { value: ReturnType<typeof useStore>; children: ReactNode }) {
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

/** 24-hour clock, as the Nordus chat shows it: 9:49, 14:05. */
export function formatTime(at: number) {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return "Invalid Date";
  return `${date.getHours()}:${String(date.getMinutes()).padStart(2, "0")}`;
}
