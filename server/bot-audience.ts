import type { BotAudience } from "../shared/wire.ts";
import { isClientFacing, type SecondBrainConfig } from "./second-brain.ts";

/** Whether a bot works for ZORG itself. Only a bot marked internal does, and never one listed as serving clients
 * directly: an unmarked bot counts as a client's, so this machine's Claude Code setup and the accounts connected
 * for every bot never reach it by default. */
export function isInternalBot(bot: { id: string; audience?: BotAudience }, brain: SecondBrainConfig | null): boolean {
  return bot.audience === "internal" && !isClientFacing(brain, bot.id);
}

/** Which bot asks for accounts, and whether it is internal. */
export interface BotAccess { id: string; internal: boolean }
