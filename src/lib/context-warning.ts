import type { Bot, Group, Message, TaskUsage } from "@/state/store";
import { contextShare } from "./usage";

export const CONTEXT_WARNING_PERCENT = 80;
export const CONTEXT_METER_PERCENT = 50;
export const CONTEXT_FRESH_PERCENT = 75;

export function compactedSinceReading(messages: readonly Pick<Message, "role" | "kind">[]): boolean {
  const compaction = messages.findLastIndex((message) => message.kind === "compaction");
  if (compaction < 0) return false;
  const reply = messages.findLastIndex((message) => message.role === "bot" && message.kind === "text");
  return compaction > reply;
}

export function threadContextMeter(usage: TaskUsage | undefined, messages: readonly Pick<Message, "role" | "kind">[]): { percent: number; suggestFresh: boolean } | null {
  const share = usage ? contextShare(usage) : null;
  if (share?.percent === undefined || share.percent < CONTEXT_METER_PERCENT) return null;
  if (compactedSinceReading(messages)) return null;
  return { percent: share.percent, suggestFresh: share.percent >= CONTEXT_FRESH_PERCENT };
}

export function roomContextWarnings(group: Pick<Group, "memberContext">, members: readonly Bot[]):
  Array<{ bot: Bot; percent: number; requested: boolean }> {
  return members.flatMap((bot) => {
    const reading = group.memberContext?.[bot.id];
    if (!reading || !(reading.window > 0)) return [];
    const percent = Math.min(999, Math.round((reading.tokens / reading.window) * 100));
    return percent >= CONTEXT_WARNING_PERCENT ? [{ bot, percent, requested: reading.compactRequested === true }] : [];
  });
}
