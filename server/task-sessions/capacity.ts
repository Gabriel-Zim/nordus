import { statfsSync } from "node:fs";

export const MAX_SERVER_SESSIONS = 100;
export const DISK_FLOOR_BYTES = 20 * 1024 ** 3;

export function atServerSessionCapacity(busySessions: number, cap = MAX_SERVER_SESSIONS): boolean {
  return busySessions >= cap;
}

export function countBusySessions(
  store: { bots: ReadonlyArray<{ id: string }>; tasks(botId: string): ReadonlyArray<{ threadId: string }> },
  threadBusy: (botId: string, threadId: string) => boolean,
): number {
  let busy = 0;
  for (const bot of store.bots) for (const task of store.tasks(bot.id)) if (threadBusy(bot.id, task.threadId)) busy++;
  return busy;
}

/** Sem leitura do disco não dá para bloquear às cegas: erro devolve true. */
export function diskHasRoom(path: string, floor = DISK_FLOOR_BYTES, statfs = statfsSync): boolean {
  try {
    const stats = statfs(path);
    return Number(stats.bavail) * Number(stats.bsize) >= floor;
  } catch {
    return true;
  }
}
