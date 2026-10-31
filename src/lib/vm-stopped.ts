import { useEffect, useSyncExternalStore } from "react";
import { api } from "@/state/store";

// Each status read inspects the container (and execs a health check when it runs), so it is polled slowly.
const POLL_MS = 120_000;
const REFRESH_AFTER_MS = 20_000;

const watched = new Map<string, { threadId: string; count: number }>();
const listeners = new Set<() => void>();
let stopped = new Set<string>();
let timer: ReturnType<typeof setTimeout> | undefined;
let lastPoll = 0;
let polling = false;

function publish(next: Set<string>) {
  if (next.size === stopped.size && [...next].every((id) => stopped.has(id))) return;
  stopped = next;
  for (const listener of listeners) listener();
}

async function poll() {
  if (polling || watched.size === 0) return;
  polling = true;
  lastPoll = Date.now();
  try {
    const results = await Promise.all([...watched].map(async ([botId, { threadId }]) => {
      try {
        const status = await api(`/api/bots/${botId}/local-computer?threadId=${encodeURIComponent(threadId)}`);
        return status?.container === "stopped" ? botId : null;
      } catch {
        return null;
      }
    }));
    publish(new Set(results.filter((id): id is string => id !== null && watched.has(id))));
  } finally {
    polling = false;
    schedule();
  }
}

function schedule() {
  clearTimeout(timer);
  timer = watched.size > 0 ? setTimeout(() => { if (document.visibilityState === "visible") void poll(); else schedule(); }, POLL_MS) : undefined;
}

function pollSoon(delayMs: number) {
  clearTimeout(timer);
  timer = setTimeout(() => void poll(), Math.max(delayMs, lastPoll + REFRESH_AFTER_MS - Date.now()));
}

function onVisible() {
  if (document.visibilityState === "visible") pollSoon(0);
}

function watch(botId: string, threadId: string) {
  const entry = watched.get(botId);
  if (entry) {
    entry.count += 1;
    entry.threadId = threadId;
  } else {
    watched.set(botId, { threadId, count: 1 });
    if (watched.size === 1) document.addEventListener("visibilitychange", onVisible);
    pollSoon(0);
  }
  return () => {
    const current = watched.get(botId);
    if (!current) return;
    current.count -= 1;
    if (current.count > 0) return;
    watched.delete(botId);
    if (stopped.has(botId)) publish(new Set([...stopped].filter((id) => id !== botId)));
    if (watched.size === 0) {
      document.removeEventListener("visibilitychange", onVisible);
      clearTimeout(timer);
      timer = undefined;
    }
  };
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useVmStopped(bot: { id: string; threadId: string; computer?: string; busy?: boolean }): boolean {
  const usesVm = bot.computer === "vm";
  useEffect(() => (usesVm ? watch(bot.id, bot.threadId) : undefined), [usesVm, bot.id, bot.threadId]);
  useEffect(() => {
    if (usesVm && !bot.busy) pollSoon(1_500);
  }, [usesVm, bot.busy]);
  return useSyncExternalStore(subscribe, () => usesVm && stopped.has(bot.id), () => false);
}
