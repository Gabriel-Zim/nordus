import { offersSignIn } from "@/components/EngineSetup";
import { t } from "@/lib/i18n";
import { errorRecovery } from "@/lib/error-recovery";
import type { Bot, InstanceInfo, Message } from "@/state/store";
import { failedTurnCause } from "../../shared/failed-turn";
import { toolStepLabel } from "@/lib/tool-step-label";
import { isClientCancellation, isStoppedTurnName } from "../../shared/client-cancel";
import { turnRefusal, type TurnRefusal } from "../../shared/turn-refusal";
import type { LocaleKey } from "@/locales";

const STATUS_MARKER = /^(?:recovery|notice):\s*/;

export { failedTurnCause };

type ActivityTool = NonNullable<Message["tool"]>;

export function engineSignedOut(engine: InstanceInfo | undefined): boolean {
  return Boolean(engine?.snapshot) && offersSignIn(engine);
}

export function signedOutEngine(tool: ActivityTool, engine: InstanceInfo | undefined): InstanceInfo | undefined {
  return tool.setup && !tool.claudeUpdate && engineSignedOut(engine) ? engine : undefined;
}

export function botEngine(bot: Bot | undefined, instances: InstanceInfo[]): InstanceInfo | undefined {
  return bot && instances.find((instance) => instance.instanceId === bot.modelSelection.instanceId);
}

const REFUSAL_LINES: Record<TurnRefusal["kind"], LocaleKey> = {
  "extra-connections": "chat.refused.extraConnections",
  unconfirmed: "chat.refused.unconfirmed",
  "engine-config": "chat.refused.engineConfig",
  "tool-not-connected": "chat.refused.toolNotConnected",
  "model-profile": "chat.refused.modelProfile",
  "unsupported-engine": "chat.refused.unsupportedEngine",
};

/** The reader's-language sentence for a turn the engine refused before sending the prompt, naming the engine that
 * refused rather than the bot's current one; undefined for any other failure. */
export function refusalLine(cause: string): string | undefined {
  const refusal = turnRefusal(cause);
  return refusal ? t(REFUSAL_LINES[refusal.kind], "engine" in refusal ? { engine: refusal.engine } : undefined) : undefined;
}

export function activityPreview(tool: ActivityTool, engine: InstanceInfo | undefined, dataResult?: Message["dataResult"], advanced = false): string {
  if (dataResult) return dataResult.title;
  if (isStoppedTurnName(tool.name)) return t("chat.turnStopped");
  const cause = failedTurnCause(tool.name);
  if (cause !== null && isClientCancellation(cause)) return t("chat.turnStopped");
  if (cause === null) return advanced ? tool.name : STATUS_MARKER.test(tool.name) ? tool.name.replace(STATUS_MARKER, "") : toolStepLabel(tool);
  const refused = refusalLine(cause);
  if (refused) return refused;
  const signedOut = signedOutEngine(tool, engine);
  if (signedOut || /not logged in|please run \/login|sign in again|authenticat/i.test(cause)) return t("chat.error.reconnect");
  const plain = errorRecovery(cause, tool.error).line;
  if (plain) return plain;
  // Words the engine wrote for people stay; codes, commands and stack text become one plain sentence.
  return /[`{}<>]|\b(error|ENOENT|ECONN\w*|HTTP|status code|exception|undefined|null|timeout|stack)\b|\b[a-z]+_[a-z_]+\b|\/[\w.-]+\/|^[A-Z][a-z]+Error\b/.test(cause)
    ? t("sidebar.preview.failed")
    : cause;
}
