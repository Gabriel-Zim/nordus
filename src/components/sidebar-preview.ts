import { cardTitle } from "@/lib/card-title";
import { approvalCardOutcome } from "./ApprovalCard";
import { localizedGreeting } from "@/lib/seed-greeting";
import { parseVoiceNote } from "@/lib/voice-note";
import type { Bot, Group, InstanceInfo, Message } from "@/state/store";
import type { RoutineRunCardData } from "../../shared/routine-run";
import { peerLine } from "@/lib/peer-message";
import { isReceipt } from "@/lib/receipts";
import { activityPreview, botEngine } from "@/lib/failed-turn";
import { t, waitingOnLabel } from "@/lib/i18n";
import { sidebarConnectorPreview, sidebarGoalRunPreview } from "@/lib/sidebar-layout";
import { citationPreviewText } from "@/lib/citations";
import { visibleBotText } from "@/lib/visible-bot-text";
import { plainPreviewText } from "@/lib/plain-preview";
import { isClientCancellation } from "../../shared/client-cancel";
import { roomWorkingPreview } from "@/lib/room-threads";
import { triggerLabel, triggerLine } from "@/lib/trigger-message";
import { plainChatText } from "../../shared/plain-chat-text";
import { isModelUnavailableError } from "@/lib/plain-error";

/** A bot's words read in the list exactly as the chat shows them: no shell, paths or internal names. */
const botWords = (text: string): string => plainChatText(visibleBotText(text));

/** A failed routine reaches the person as a bot's own message, so its raw card never stands in for the conversation. */
const withoutFailedRoutines = (messages: Message[]): Message[] =>
  messages.filter((message) => !(message.kind === "routine.run" && (message.routineRun?.status === "failed" || message.routineRun?.status === "missed")));

/** A routine's result reads as what the bot found, not as the engine's English status line. */
const routineRunPreview = (message: Message): string | null =>
  message.kind === "routine.run" && message.routineRun
    ? plainPreviewText(botWords(message.routineRun.summary ?? message.routineRun.routineName))
    : null;

/** The newest message a preview can show. A receipt or a screen frame says nothing about the conversation on its own. */
export function lastPreviewable<T extends { kind: string }>(messages: readonly T[] | undefined): T | undefined {
  return messages?.findLast((message) => !isReceipt(message) && message.kind !== "screen");
}

export function botPreview(bot: Bot, visible: Message[], instances: InstanceInfo[], advanced: boolean): string {
  if (bot.activity === "waiting-on-you") return t("sidebar.preview.waiting");
  if (bot.waitingForTeammates) return waitingOnLabel(bot.waitingOn, t("sidebar.preview.waitingOnTeammate"), true);
  if (bot.busy) return t("sidebar.preview.working");
  const last = lastPreviewable(withoutFailedRoutines(visible));
  if (!last) return "";
  // The chat already shows this refusal as one plain sentence with a fix; the list says the same thing, short.
  if (last.role !== "user" && isModelUnavailableError(last.text ?? "")) return t("error.plain.modelUnavailableShort");
  const routine = routineRunPreview(last);
  if (routine) return routine;
  if (last.kind === "options" && last.card) {
    return (last.card.requestId && last.card.tool && !last.card.questionRequest && approvalCardOutcome(last.card)) || cardTitle(last.card.title, bot.name);
  }
  if (last.kind === "activity" && last.tool) return activityPreview(last.tool, botEngine(bot, instances), last.dataResult, advanced);
  if (last.routineRun) return t("chat.trigger.routine", { name: last.routineRun.routineName });
  if (last.kind === "connector" && last.connector) return sidebarConnectorPreview(last.connector, t);
  const peer = peerLine(last);
  if (peer) return `${peer.name}: ${plainPreviewText(botWords(peer.body))}`;
  if (last.role !== "user" && isClientCancellation(last.text ?? "")) return t("chat.turnStopped");
  if (last.role === "user" && parseVoiceNote(last.text)) return t("chat.voiceNote.preview");
  const trigger = last.role === "user" ? triggerLine(last.text) : null;
  if (trigger) return triggerLabel(trigger);
  return plainPreviewText(citationPreviewText(last.role === "user" ? last.text ?? "" : botWords(localizedGreeting(last.text ?? "", bot))));
}

const RUN_PREVIEW = {
  completed: "automations.preview.finished", failed: "automations.preview.failed", waiting: "automations.preview.needsYou",
  cancelled: "automations.preview.stopped", missed: "automations.preview.missed", running: "automations.preview.running", queued: "automations.preview.running",
} as const satisfies Record<RoutineRunCardData["status"], string>;

/** "“Morning summary” finished": an automation's run, in the page's words. */
export function automationRunPreview(run: Pick<RoutineRunCardData, "routineName" | "status">): string {
  return t(RUN_PREVIEW[run.status], { name: run.routineName });
}

export function groupPreview(group: Group, bots: Bot[], instances: InstanceInfo[], advanced: boolean): string {
  const working = roomWorkingPreview(group, (botId) => bots.find((b) => b.id === botId)?.name);
  if (working) return working;
  if (group.working) return t("sidebar.preview.teamWorking");
  const last = lastPreviewable(withoutFailedRoutines(group.messages));
  if (!last) return t("sidebar.preview.noMessages");
  if (last.role !== "user" && isModelUnavailableError(last.text ?? "")) {
    const short = t("error.plain.modelUnavailableShort");
    return last.from ? `${last.from.name}: ${short}` : short;
  }
  const routine = routineRunPreview(last);
  if (routine) return last.from ? `${last.from.name}: ${routine}` : routine;
  if (last.kind === "text" && last.role !== "user" && isClientCancellation(last.text ?? "")) {
    const stopped = t("chat.turnStopped");
    return last.from ? `${last.from.name}: ${stopped}` : stopped;
  }
  const text = last.kind === "activity" && last.tool
    ? activityPreview(last.tool, botEngine(bots.find((bot) => bot.id === last.from?.botId), instances), last.dataResult, advanced)
    : last.kind === "goal.run" && last.goalRun
      ? sidebarGoalRunPreview(last.goalRun)
      : last.kind === "connector" && last.connector
        ? sidebarConnectorPreview(last.connector, t)
        : last.role === "user" ? (last.text ?? "") : botWords(last.text ?? "");
  const readable = plainPreviewText(citationPreviewText(text));
  if (last.role === "user") return t("sidebar.preview.you", { text: readable });
  return last.from ? `${last.from.name}: ${readable}` : readable;
}

export type RailCardState = "idle" | "working" | "waiting";

/** Everything the avatar rail's hover card shows, so the card itself needs no store logic. */
export type RailCardData = {
  kind: "bot" | "room";
  name: string;
  preview: string;
  state: RailCardState;
  unread: boolean;
  /** What the bot is doing now, in plain words; the working line shows it in place of the generic one. */
  step?: string;
};

export type RailCardSignals = { waiting: boolean; working: boolean; unread: boolean; step?: string | null };

const railCardState = ({ waiting, working }: RailCardSignals): RailCardState => (waiting ? "waiting" : working ? "working" : "idle");

/** A bot's card keeps its last words even while it works or waits; the state has its own line. */
export function botRailCard(bot: Bot, visible: Message[], instances: InstanceInfo[], advanced: boolean, signals: RailCardSignals): RailCardData {
  const settled: Bot = { ...bot, activity: "idle", busy: false, waitingForTeammates: false };
  return {
    kind: "bot",
    name: bot.name,
    preview: botPreview(settled, visible, instances, advanced),
    state: railCardState(signals),
    unread: signals.unread,
    ...(signals.step ? { step: signals.step } : {}),
  };
}

export function roomRailCard(group: Group, bots: Bot[], instances: InstanceInfo[], advanced: boolean, signals: RailCardSignals): RailCardData {
  const settled: Group = { ...group, working: false, busyBotId: undefined, queue: [] };
  return {
    kind: "room",
    name: group.name,
    preview: groupPreview(settled, bots, instances, advanced),
    state: railCardState(signals),
    unread: signals.unread,
  };
}
