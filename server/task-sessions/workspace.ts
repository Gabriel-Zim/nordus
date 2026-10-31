import { createHash } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

/** Six stable base36 characters derived from the thread id. */
export function taskShortId(threadId: string): string {
  const n = createHash("sha256").update(threadId).digest().readBigUInt64BE(0);
  return n.toString(36).padStart(6, "0").slice(0, 6);
}

/** Same id rule as ensureTaskWorkspace: no separators or dot segments can reach the path. */
function checkedIds(botId: string, threadId: string): void {
  if (![botId, threadId].every((id) => /^[A-Za-z0-9_-]{1,128}$/.test(id))) throw new Error("Invalid bot or thread id");
}

export function taskTmpDir(dataDir: string, botId: string, threadId: string): string {
  checkedIds(botId, threadId);
  return join(dataDir, "task-tmp", botId, threadId);
}

/** Per-task child environment; creates the temp folder. */
export function taskEnv(dataDir: string, botId: string, threadId: string): Record<string, string> {
  const TMPDIR = taskTmpDir(dataDir, botId, threadId);
  mkdirSync(TMPDIR, { recursive: true, mode: 0o700 });
  return { TMPDIR, NORDUS_TAREFA_ID: taskShortId(threadId) };
}

/** Never throws once the ids are valid: a folder that will not go (permissions, busy) is left for the next sweep, and must not take the server down. */
export function cleanupTaskTmp(dataDir: string, botId: string, threadId: string, remove: typeof rmSync = rmSync): void {
  const dir = taskTmpDir(dataDir, botId, threadId);
  try {
    remove(dir, { recursive: true, force: true });
  } catch (error) {
    console.warn(`task-sessions: could not remove ${dir}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
