import type { NotchAgentWire, NotchApprovalWire, NotchFeedWire, NotchLabels } from "../../electron/notch-ipc.mjs";
import { approvalRisk } from "../../shared/approvals";
import { approvalNaturalText, pendingApprovals, type Pending } from "@/components/PendingApproval";
import { t } from "@/lib/i18n";
import { CRITTER_COLORS } from "@/lib/mascot";
import { botStepNow } from "@/lib/work-steps";
import type { Bot, OptionCardData, Task } from "@/state/store";

/** The server's reason code for a permission the provider itself holds for the person: the only hold the notch may answer. */
const NATIVE_HOLD = "approval.held.native";

const NEUTRAL = "#6b7280";

export interface NotchAnswer {
  botId: string;
  threadId: string;
  requestId: string;
}

export interface BuiltNotchFeed {
  wire: NotchFeedWire;
  /** The approvals the notch may answer, by the id it was shown with. */
  answers: ReadonlyMap<string, NotchAnswer>;
}

export interface WaitingElsewhere {
  threadId: string;
  version: string;
}

const waitsOnYou = (task: Task) => task.activity === "waiting-on-you" && !task.routineRunId;

const colorOf = (bot: Pick<Bot, "color">) => (CRITTER_COLORS[bot.color] ?? NEUTRAL).toLowerCase();

export function notchLabels(): NotchLabels {
  return {
    done: t("notch.done"),
    approve: t("notch.approve"),
    decline: t("notch.decline"),
    open: t("notch.open"),
    several: t("notch.several", { count: "{count}" }),
  };
}

const isWorking = (task: Task) => task.activity === "working" || (task.busy === true && task.activity !== "waiting-on-you");

function workingTask(bot: Bot): { threadId: string; startedAt: number } | null {
  const tasks = bot.tasks ?? [];
  const found = tasks.find((task) => task.threadId === bot.threadId && isWorking(task)) ?? tasks.find(isWorking);
  if (found) return { threadId: found.threadId, startedAt: found.turnStartedAt ?? 0 };
  const known = tasks.some((task) => task.threadId === bot.threadId);
  return !known && bot.busy === true && bot.activity !== "waiting-on-you" ? { threadId: bot.threadId, startedAt: bot.turnStartedAt ?? 0 } : null;
}

function agentsOf(bots: readonly Bot[]): NotchAgentWire[] {
  return bots
    .filter((bot) => !bot.hidden)
    .flatMap((bot) => {
      const work = workingTask(bot);
      return work ? [{ bot, ...work }] : [];
    })
    .sort((a, b) => b.startedAt - a.startedAt)
    .map(({ bot, threadId }) => ({
      id: bot.id,
      name: bot.name,
      color: colorOf(bot),
      status: botStepNow(bot) ?? t("notch.working"),
      botId: bot.id,
      threadId,
    }));
}

/** Waiting for the person in a conversation that is not the one open, where only the server holds the request. */
export function waitingElsewhere(bots: readonly Bot[]): WaitingElsewhere[] {
  return bots.flatMap((bot) =>
    (bot.tasks ?? []).filter((task) => waitsOnYou(task) && task.threadId !== bot.threadId).map((task) => ({ threadId: task.threadId, version: `${task.updatedAt ?? ""}` })),
  );
}

/**
 * Security invariant: the notch shows one sentence and two buttons, so it answers only what that sentence fully says.
 * An allow-list on the card, not a list of exceptions: a permission with no payload to review (any key ending in
 * `Request`, known or not written yet), no hold of ours (only the provider's own), not critical (held to approve on its
 * card), not expired and not a question.
 */
export function decidableFromNotch(card: OptionCardData | undefined): boolean {
  if (!card || card.expired === true || card.requestType === "question" || approvalRisk(card) === "critical") return false;
  const providerOnly = card.heldCode === undefined ? !card.held : card.heldCode === NATIVE_HOLD;
  return providerOnly && !Object.entries(card).some(([key, value]) => key.endsWith("Request") && Boolean(value));
}

export const answerableFromNotch = (pending: Pending): boolean => decidableFromNotch(pending.message.card);

function approvalsOf(bots: readonly Bot[], elsewhere: ReadonlyMap<string, Pending | undefined>): Array<{ wire: NotchApprovalWire; answer: NotchAnswer | null; at: number }> {
  return bots
    .filter((bot) => !bot.hidden)
    .flatMap((bot) =>
      (bot.tasks ?? []).filter(waitsOnYou).map((task) => {
        const pending = task.threadId === bot.threadId ? pendingApprovals(bot.messages)[0] : elsewhere.get(task.threadId);
        const decidable = pending !== undefined && answerableFromNotch(pending);
        return {
          wire: {
            id: `${task.threadId}:${pending?.requestId ?? "waiting"}`,
            name: bot.name,
            color: colorOf(bot),
            header: t("notch.asks", { name: bot.name }),
            text: pending ? approvalNaturalText(pending) : t("notch.needsYou", { name: bot.name }),
            decidable,
            botId: bot.id,
            threadId: task.threadId,
          },
          answer: decidable ? { botId: bot.id, threadId: task.threadId, requestId: pending.requestId } : null,
          at: task.attentionAt ?? task.updatedAt ?? task.createdAt,
        };
      }),
    )
    .sort((a, b) => a.at - b.at);
}

export function buildNotchFeed(bots: readonly Bot[], elsewhere: ReadonlyMap<string, Pending | undefined> = new Map()): BuiltNotchFeed {
  const approvals = approvalsOf(bots, elsewhere);
  return {
    wire: { agents: agentsOf(bots), approvals: approvals.map((entry) => entry.wire), labels: notchLabels() },
    answers: new Map(approvals.flatMap((entry) => (entry.answer ? [[entry.wire.id, entry.answer] as const] : []))),
  };
}
