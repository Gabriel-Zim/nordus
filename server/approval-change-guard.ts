// One rule for every approval-level change: the bot PATCH route and the
// propose_app_setting card both answer to it, so a card can never bypass a
// check the person's own settings screen is held to.
import type { ApprovalMode } from "../shared/approval-mode.ts";
import type { ModelSelection } from "./contracts.ts";

export interface ApprovalChangeBot {
  approvalGrant?: unknown;
  modelSelection?: ModelSelection;
}

export interface ApprovalChangeConversation {
  modelSelection?: ModelSelection;
  approvalMode?: ApprovalMode;
}

export interface ApprovalChangeInput {
  bot: ApprovalChangeBot;
  current: ApprovalMode;
  next: ApprovalMode;
  /** The conversations a whole-bot change also lands on. */
  tasks?: ApprovalChangeConversation[];
  /** An approval field (or a model move) was sent, even when the level stays the same. */
  requested?: boolean;
  /** The change covers every conversation, not just the bot default. */
  allThreads?: boolean;
  /** A turn is still running (any turn, when `allThreads`). */
  busy?: boolean;
  hosted?: boolean;
  hostedFullAccessRefusal?: string;
  /** Only the packaged desktop may move a level into or out of Custom. */
  desktop?: boolean;
  /** Whether the engine behind a selection offers `next`. */
  supports?: (selection: ModelSelection | undefined) => boolean;
}

export type ApprovalChangeCode =
  | "grant_pending"
  | "busy"
  | "custom_needs_desktop"
  | "hosted_full_access"
  | "unsupported";

export type ApprovalChangeRefusal = {
  ok: false;
  code: ApprovalChangeCode;
  status: number;
  error: string;
};

export type ApprovalChangeResult = { ok: true } | ApprovalChangeRefusal;

export const APPROVAL_CHANGE_REFUSALS = {
  grantPending: "wait for the approval-level change to finish before changing this setting",
  busy: "stop this bot's turn before changing its approval level",
  customNeedsDesktop: "This approval-level change can only be made from the packaged desktop app",
  unsupported: "This provider does not support the selected approval level",
  hostedFullAccess: "On a shared company workspace Full access comes only from the operator's dedicated policy",
} as const;

// `code` guides the caller's copy; the refusal the callers compare and send is
// exactly { ok, status, error }.
const refusal = (code: ApprovalChangeCode, status: number, error: string): ApprovalChangeRefusal => {
  const result = { ok: false as const, status, error };
  Object.defineProperty(result, "code", { value: code, enumerable: false });
  return result as ApprovalChangeRefusal;
};

export function checkApprovalChange(input: ApprovalChangeInput): ApprovalChangeResult {
  const changing = input.current !== input.next;
  const requested = input.requested ?? changing;
  const allThreads = input.allThreads === true;
  const tasks = input.tasks ?? [];

  if (input.bot.approvalGrant && requested) {
    return refusal("grant_pending", 409, APPROVAL_CHANGE_REFUSALS.grantPending);
  }
  if (input.busy === true && (changing || allThreads)) {
    return refusal("busy", 409, APPROVAL_CHANGE_REFUSALS.busy);
  }
  if ((changing || allThreads) && input.supports) {
    const selections = [input.bot.modelSelection, ...tasks.map((task) => task.modelSelection)];
    if (selections.some((selection) => !input.supports!(selection))) {
      return refusal("unsupported", 400, APPROVAL_CHANGE_REFUSALS.unsupported);
    }
  }
  const customThread = tasks.some((task) => task.approvalMode === "custom");
  const leavingCustom = input.current === "custom" && input.next !== "custom";
  const enteringCustom = input.next === "custom" && input.current !== "custom";
  if (!input.desktop && (leavingCustom || enteringCustom || (allThreads && customThread && input.next !== "custom"))) {
    return refusal("custom_needs_desktop", 403, APPROVAL_CHANGE_REFUSALS.customNeedsDesktop);
  }
  if (input.hosted === true && input.next === "full" && (input.current !== "full" || allThreads)) {
    return refusal(
      "hosted_full_access",
      403,
      input.hostedFullAccessRefusal ?? APPROVAL_CHANGE_REFUSALS.hostedFullAccess,
    );
  }
  return { ok: true };
}
