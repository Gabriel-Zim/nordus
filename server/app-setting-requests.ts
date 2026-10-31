// propose_app_setting cards: a closed pair of setting and value, re-validated at confirm time.
import { approvalModeFor, type ApprovalMode } from "../shared/approval-mode.ts";
import {
  checkedAppSettingValue,
  isAppSettingKey,
  isApprovalElevation,
  isClientAppSetting,
  type AppSettingKey,
  type AppSettingRequestCardData,
} from "../shared/app-setting-request.ts";
import { checkApprovalChange } from "./approval-change-guard.ts";
import { newId, type ModelSelection } from "./contracts.ts";
import { UNDO_STALE } from "./direct-apply.ts";
import { redactSecretsInText } from "./redact.ts";
import type { McpServerRequestCardData } from "../shared/mcp-server-request.ts";
import type { BotRecord } from "./store.ts";

const MAX_REASON = 500;
const STALE = "This bot's permissions changed after this card was prepared. Ask the bot to review it and propose again.";
const NOT_AN_ELEVATION = "Raising a bot's permissions always needs the person's confirmation. Ask the bot to propose the change again.";
const NO_SUCH_BOT = "That bot no longer exists";
const CUSTOM_NEEDS_DESKTOP = "Essa permissão só muda no app do computador";
const GRANT_PENDING = "Já existe uma mudança de permissão em andamento. Espere ela terminar e confirme de novo.";
const busyRefusal = (name: string) => `Espere ${name} terminar o que está fazendo e confirme de novo`;
const SETTING_LABEL: Record<AppSettingKey, string> = {
  language: "language",
  theme: "theme",
  interface_mode: "interface",
  approval_mode: "permissions",
};

export interface OptionCardLike {
  title: string;
  subtitle: string;
  options: string[];
  answered?: string;
  dismissed?: boolean;
  requestId?: string;
  tool?: string;
  held?: string;
  autoApplied?: boolean;
  undone?: boolean;
  appSettingRequest?: AppSettingRequestCardData;
  mcpServerRequest?: McpServerRequestCardData;
}

export interface AppSettingRequestStore {
  bot(id: string): BotRecord | undefined | null;
  messagesFor(threadId: string): Array<{ id: string; card?: OptionCardLike }>;
  appendMessage(
    threadId: string,
    message: {
      role: "bot";
      kind: "options";
      card: OptionCardLike;
      from?: { botId: string; name: string; color: string };
    },
  ): { id: string };
  patchMessage(threadId: string, messageId: string, patch: { card: OptionCardLike }): { id: string } | null;
  applyApprovalMode(id: string, mode: Exclude<ApprovalMode, "custom">): BotRecord | null;
  /** The conversations a whole-bot approval change also lands on. */
  tasks?(botId: string): Array<{ modelSelection?: ModelSelection; approvalMode?: ApprovalMode }>;
}

export interface AppSettingRequestServiceOptions {
  store: AppSettingRequestStore;
  now?: () => number;
  canPersist?: (botId: string, threadId: string, opensCard: boolean) => { ok: true } | { ok: false; status: number; error: string };
  /** Chief targeting another bot: returns a refusal sentence or null. Checked at propose AND confirm. */
  validateTarget?: (proposerBotId: string, targetBotId: string) => string | null;
  /** A turn is still running: a card proposed mid-turn may only apply once the bot is idle. */
  busy?: (botId: string) => boolean;
  /** Whether the target's engine offers that approval level. */
  supports?: (selection: ModelSelection | undefined, mode: ApprovalMode) => boolean;
  hosted?: boolean;
  hostedFullAccessRefusal?: string;
  /** Only the packaged desktop may move a level into or out of Custom. */
  desktop?: boolean;
}

export class AppSettingRequestError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "AppSettingRequestError";
    this.status = status;
  }
}

export type ResolveAppSettingRequestResult =
  | { claimed: false; state: "not_found" }
  | { claimed: true; state: "invalid"; error: string; status: number }
  | { claimed: true; state: "already_settled"; behavior: string }
  | { claimed: true; state: "denied" }
  | { claimed: true; state: "applied"; targetBotId: string; settlementPending?: true; message?: string };

export type UndoAppSettingRequestResult =
  | { claimed: false }
  | { claimed: true; state: "already_undone" }
  | { claimed: true; state: "invalid"; error: string; status: number; stale?: true }
  | { claimed: true; state: "undone"; targetBotId: string };

const currentValue = (target: BotRecord): ApprovalMode => approvalModeFor(target);

const copy = (setting: AppSettingKey, value: string, targetName: string, crossBot: boolean) => {
  const summary = `Change the ${SETTING_LABEL[setting]} to ${value}${crossBot ? ` for @${targetName}` : ""}`;
  return { summary, detail: `${summary}.` };
};

function reasonText(value: unknown): string {
  if (typeof value !== "string") throw new AppSettingRequestError("reason is required");
  const trimmed = value.trim();
  if (!trimmed) throw new AppSettingRequestError("reason is required");
  if (trimmed.length > MAX_REASON) throw new AppSettingRequestError("reason must be 500 characters or fewer");
  return redactSecretsInText(trimmed);
}

export class AppSettingRequestService {
  private readonly store: AppSettingRequestStore;
  private readonly now: () => number;

  private readonly options: AppSettingRequestServiceOptions;

  constructor(options: AppSettingRequestServiceOptions) {
    this.options = options;
    this.store = options.store;
    this.now = options.now ?? Date.now;
  }

  submit(args: {
    botId: string;
    threadId: string;
    targetBotId?: string;
    setting: unknown;
    value: unknown;
    reason: unknown;
    from?: { botId: string; name: string; color: string };
  }) {
    const proposal = this.propose(args);
    return { ...proposal, state: proposal.result ? "applied" as const : "pending" as const };
  }

  propose(args: {
    botId: string;
    threadId: string;
    targetBotId?: string;
    setting: unknown;
    value: unknown;
    reason: unknown;
    from?: { botId: string; name: string; color: string };
  }): {
    requestId: string; messageId: string; title: string; summary: string; detail: string;
    result?: Extract<ResolveAppSettingRequestResult, { state: "applied" }>;
  } {
    if (!isAppSettingKey(args.setting)) {
      throw new AppSettingRequestError(`setting must be one of language, theme, interface_mode, approval_mode`);
    }
    const setting = args.setting;
    const value = checkedAppSettingValue(setting, args.value);
    if (value === null) throw new AppSettingRequestError(`${args.value === undefined ? "value" : redactSecretsInText(String(args.value)).slice(0, 80)} is not a supported ${SETTING_LABEL[setting]} for this app`);
    const reason = reasonText(args.reason);

    const proposer = this.store.bot(args.botId);
    if (!proposer) throw new AppSettingRequestError(NO_SUCH_BOT, 404);
    const requestedTarget = args.targetBotId?.trim();
    if (requestedTarget && requestedTarget !== args.botId && isClientAppSetting(setting)) {
      throw new AppSettingRequestError(`${SETTING_LABEL[setting]} applies to the whole app, so for_bot_id is not accepted here`);
    }
    const targetBotId = setting === "approval_mode" ? requestedTarget || args.botId : args.botId;
    const target = this.store.bot(targetBotId);
    if (!target) throw new AppSettingRequestError(NO_SUCH_BOT, 404);
    const crossBot = targetBotId !== args.botId;
    if (crossBot && this.options.validateTarget) {
      const refusal = this.options.validateTarget(args.botId, targetBotId);
      if (refusal) throw new AppSettingRequestError(refusal, 403);
    }
    const before = isClientAppSetting(setting) ? undefined : currentValue(target);
    if (setting === "approval_mode") {
      if (before === value) throw new AppSettingRequestError("Nothing would change");
      this.refuseApprovalChange(target, value as ApprovalMode, "propose");
    }
    // A permission change always waits for its card: the proposing turn is the bot's own work,
    // and the person decides once it ends.
    const requiresConfirmation = setting === "approval_mode";
    const localAutoWarning = requiresConfirmation && target.computer === "local" && value === "auto";
    const requestId = newId();
    const targetName = redactSecretsInText(target.name);
    const raising = before !== undefined && isApprovalElevation(before, value);
    const payload: AppSettingRequestCardData = {
      version: 1,
      requestId,
      botId: args.botId,
      threadId: args.threadId,
      targetBotId,
      targetName,
      createdAt: this.now(),
      reason,
      setting,
      value,
      ...(before === undefined ? {} : { before }),
      requiresConfirmation,
      ...(localAutoWarning ? { localAutoWarning: true } : {}),
    };
    const text = copy(setting, value, targetName, crossBot);
    const persistence = this.options.canPersist?.(args.botId, args.threadId, true);
    if (persistence && !persistence.ok) throw new AppSettingRequestError(persistence.error, persistence.status);
    const messageInput: Parameters<AppSettingRequestStore["appendMessage"]>[1] = {
      role: "bot",
      kind: "options",
      card: {
        title: !requiresConfirmation
          ? text.summary
          : value === "full"
            ? "Turn on Full access?"
            : raising
              ? `Let ${targetName} act more on its own?`
              : `Change ${targetName}'s permissions?`,
        subtitle: !requiresConfirmation
          ? text.detail
          : `${text.detail} ${
            value === "full"
              ? "Full access lets the bot act without asking."
              : raising
                ? "The bot would act without asking for some things."
                : "This lowers what the bot may do without asking."
          }`,
        options: requiresConfirmation ? ["Confirm", "Cancel"] : [],
        ...(requiresConfirmation ? {} : { dismissed: true }),
        requestId,
        tool: "update_app_setting",
        appSettingRequest: payload,
      },
    };
    if (args.from) messageInput.from = args.from;
    const message = this.store.appendMessage(args.threadId, messageInput);
    const proposal = { requestId, messageId: message.id, title: messageInput.card.title, summary: text.summary, detail: text.detail };
    if (requiresConfirmation) return proposal;
    const result = this.resolve({ botId: args.botId, threadId: args.threadId, requestId, behavior: "allow" });
    if (result.state === "applied") {
      if (!result.settlementPending) this.recordAutoApplied(args.threadId, message.id);
      return { ...proposal, result };
    }
    throw new AppSettingRequestError(result.state === "invalid" ? result.error : "The setting could not be applied", result.state === "invalid" ? result.status : 409);
  }

  /** The same guard the bot PATCH route answers to; a card may not loosen a level the settings screen refuses. */
  private refuseApprovalChange(target: BotRecord, next: ApprovalMode, phase: "propose" | "confirm"): void {
    const checked = checkApprovalChange({
      bot: target,
      tasks: (this.store.tasks?.(target.id) ?? []).map((task) => ({
        ...task,
        modelSelection: task.modelSelection ?? target.modelSelection,
      })),
      current: currentValue(target),
      next,
      requested: true,
      allThreads: true,
      busy: phase === "confirm" && this.options.busy?.(target.id) === true,
      hosted: this.options.hosted === true,
      hostedFullAccessRefusal: this.options.hostedFullAccessRefusal,
      desktop: this.options.desktop === true,
      supports: this.options.supports ? (selection) => this.options.supports!(selection, next) : undefined,
    });
    if (checked.ok) return;
    if (checked.code === "busy") throw new AppSettingRequestError(busyRefusal(redactSecretsInText(target.name)), 409);
    if (checked.code === "grant_pending") throw new AppSettingRequestError(GRANT_PENDING, 409);
    if (checked.code === "custom_needs_desktop") throw new AppSettingRequestError(CUSTOM_NEEDS_DESKTOP, 403);
    if (checked.code === "hosted_full_access") throw new AppSettingRequestError(checked.error, 403);
    throw new AppSettingRequestError(`That bot's engine does not offer the ${next} level`, 400);
  }

  private recordAutoApplied(threadId: string, messageId: string): void {
    try {
      const card = this.store.messagesFor(threadId).find((candidate) => candidate.id === messageId)?.card;
      if (card?.appSettingRequest) this.store.patchMessage(threadId, messageId, { card: { ...card, autoApplied: true } });
    } catch {
    }
  }

  undo(args: { botId: string; threadId: string; requestId: string }): UndoAppSettingRequestResult {
    const message = this.store.messagesFor(args.threadId)
      .find((candidate) => candidate.card?.requestId === args.requestId && candidate.card.appSettingRequest);
    const card = message?.card;
    const payload = card?.appSettingRequest;
    if (!message || !card || !payload) return { claimed: false };
    if (card.undone) return { claimed: true, state: "already_undone" };
    const cannot = (error: string, status = 409): UndoAppSettingRequestResult => ({ claimed: true, state: "invalid", error, status });
    if (!card.autoApplied || card.answered !== "allow") return cannot("Only a change that applied on its own can be undone here.");
    if (payload.botId !== args.botId || payload.threadId !== args.threadId) {
      return cannot("This setting belongs to another conversation", 403);
    }
    const target = this.store.bot(payload.targetBotId);
    if (!target) return cannot(NO_SUCH_BOT, 404);
    if (payload.setting === "approval_mode") {
      if (!payload.before || currentValue(target) !== payload.value) {
        return { claimed: true, state: "invalid", error: UNDO_STALE, status: 409, stale: true };
      }
      if (!this.store.applyApprovalMode(target.id, payload.before as Exclude<ApprovalMode, "custom">)) return cannot(NO_SUCH_BOT, 404);
    }
    this.store.patchMessage(args.threadId, message.id, { card: { ...card, undone: true } });
    return { claimed: true, state: "undone", targetBotId: target.id };
  }

  resolve(args: {
    botId: string;
    threadId: string;
    requestId: string;
    behavior: string | undefined;
  }): ResolveAppSettingRequestResult {
    const message = this.store.messagesFor(args.threadId)
      .find((candidate) => candidate.card?.requestId === args.requestId && candidate.card.appSettingRequest);
    const card = message?.card;
    const payload = card?.appSettingRequest;
    if (!message || !card || !payload) return { claimed: false, state: "not_found" };
    if (payload.requestId !== card.requestId) {
      return { claimed: true, state: "invalid", error: "This setting request does not match its card", status: 409 };
    }
    if (args.behavior !== "allow" && args.behavior !== "deny") {
      return { claimed: true, state: "invalid", error: "Setting confirmations must be confirmed or cancelled", status: 400 };
    }
    if (payload.botId !== args.botId || payload.threadId !== args.threadId) {
      return { claimed: true, state: "invalid", error: "This setting belongs to another conversation", status: 403 };
    }
    if (card.answered) return { claimed: true, state: "already_settled", behavior: card.answered };
    if (args.behavior === "allow" && payload.targetBotId !== payload.botId && this.options.validateTarget) {
      const refusal = this.options.validateTarget(payload.botId, payload.targetBotId);
      if (refusal) return { claimed: true, state: "invalid", error: refusal, status: 404 };
    }

    let changed = false;
    try {
      const target = this.store.bot(payload.targetBotId);
      if (!target) throw new AppSettingRequestError(NO_SUCH_BOT, 404);
      if (args.behavior === "deny") {
        this.store.patchMessage(args.threadId, message.id, { card: { ...card, answered: "deny", held: undefined } });
        return { claimed: true, state: "denied" };
      }
      if (payload.setting === "approval_mode") {
        const current = currentValue(target);
        if (current === payload.value) {
          const settled = this.store.patchMessage(args.threadId, message.id, {
            card: { ...card, answered: "allow", held: undefined, appSettingRequest: { ...payload, appliedAt: payload.appliedAt ?? this.now() } },
          });
          if (!settled) throw new AppSettingRequestError("This settings card is no longer available", 409);
          return { claimed: true, state: "already_settled", behavior: "allow" };
        }
        if (payload.before !== undefined && current !== payload.before) {
          throw new AppSettingRequestError(STALE, 409);
        }
        if (!payload.requiresConfirmation) {
          throw new AppSettingRequestError(NOT_AN_ELEVATION, 409);
        }
        // The card's Confirm is the acknowledgement only when the card carried the warning.
        if (payload.value === "auto" && target.computer === "local" && payload.localAutoWarning !== true) {
          throw new AppSettingRequestError("This card does not carry the warning for Auto mode on this computer. Ask the bot to propose it again.", 409);
        }
        this.refuseApprovalChange(target, payload.value as ApprovalMode, "confirm");
        if (!this.store.applyApprovalMode(target.id, payload.value as Exclude<ApprovalMode, "custom">)) {
          throw new AppSettingRequestError(NO_SUCH_BOT, 404);
        }
        changed = true;
      }
      const appliedAt = this.now();
      const settled = this.store.patchMessage(args.threadId, message.id, {
        card: { ...card, answered: "allow", held: undefined, appSettingRequest: { ...payload, appliedAt } },
      });
      if (!settled) throw new AppSettingRequestError("This settings card is no longer available", 409);
      return { claimed: true, state: "applied", targetBotId: target.id };
    } catch (error) {
      const status = error instanceof AppSettingRequestError ? error.status : 400;
      const detail = error instanceof Error ? error.message : String(error);
      try {
        this.store.patchMessage(args.threadId, message.id, {
          card: { ...card, held: redactSecretsInText(detail).slice(0, 500) },
        });
      } catch {}
      if (changed) return { claimed: true, state: "applied", targetBotId: payload.targetBotId, settlementPending: true, message: detail };
      return { claimed: true, state: "invalid", error: detail, status };
    }
  }
}
