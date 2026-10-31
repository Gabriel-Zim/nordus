import { existsSync, realpathSync } from "node:fs";
import { join } from "node:path";

import type { CommandAllowlistResponse } from "../shared/command-allowlist.ts";
import type { CommandAllowlistStore } from "./command-allowlist.ts";
import type { ProviderRegistry } from "./harness/registry.ts";
import type { BotRecord, Store } from "./store.ts";

export const COMMAND_ALLOWLIST_DRIVERS = new Set([
  "claudeAgent", "codex", "antigravityAgent", "grokAgent", "opencodeGo", "kimiAgent",
  "droidAgent", "cursorAgent", "qwenAgent", "geminiAgent", "hermesAgent", "customAcp",
]);

export interface CommandAllowlistResponseDeps {
  registry: Pick<ProviderRegistry, "get">;
  store: Pick<Store, "taskByThread">;
  commandAllowlist: Pick<CommandAllowlistStore, "list">;
  dataDir: string;
}

export function commandAllowlistResponse({ registry, store, commandAllowlist, dataDir }: CommandAllowlistResponseDeps, bot: BotRecord): CommandAllowlistResponse {
  const instance = registry.get(bot.modelSelection.instanceId);
  const task = store.taskByThread(bot.id, bot.threadId);
  let cwd = task?.cwd !== undefined ? task.cwd : bot.cwd ?? join(realpathSync(dataDir), "task-workspaces", bot.id, bot.threadId);
  if (cwd && existsSync(cwd)) cwd = realpathSync(cwd);
  return {
    rules: commandAllowlist.list(bot.id),
    supported: COMMAND_ALLOWLIST_DRIVERS.has(instance?.driverKind ?? ""),
    context: {
      providerInstanceId: bot.modelSelection.instanceId,
      cwd,
    },
  };
}
