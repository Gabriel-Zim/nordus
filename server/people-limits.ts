import type { Notification } from "../shared/notification.ts";

export interface RateWindow {
  limit: number;
  windowMs: number;
}

/** What one person may send in direct messages: a minute and an hour, both held at once. */
export const DM_SEND_WINDOWS: readonly RateWindow[] = [{ limit: 30, windowMs: 60_000 }, { limit: 300, windowMs: 3_600_000 }];

/** How many messages one person may send that tag someone, a minute at a time. */
export const MENTION_SEND_WINDOWS: readonly RateWindow[] = [{ limit: 20, windowMs: 60_000 }];

/** How long after a notice about a mention or a direct message the next one about the same conversation waits. */
export const NOTICE_EVERY_MS = 20_000;

/** At most `limit` takes for one key inside every window; a refusal is not counted against any of them. */
export function rateLimit(windows: readonly RateWindow[], now: () => number = Date.now): (key: string) => boolean {
  const longest = Math.max(...windows.map((window) => window.windowMs));
  const taken = new Map<string, number[]>();
  return (key) => {
    const at = now();
    const recent = (taken.get(key) ?? []).filter((time) => at - time < longest);
    const open = windows.every((window) => recent.filter((time) => at - time < window.windowMs).length < window.limit);
    if (open) recent.push(at);
    if (recent.length) taken.set(key, recent);
    else taken.delete(key);
    return open;
  };
}

/** One notice about a mention or a direct message for each person and conversation every few seconds: the lines themselves
 * always arrive, but a burst of them is one banner and one push, and never a flood in the feed. */
export function createNoticeGate(options: { everyMs?: number; now?: () => number } = {}) {
  const once = rateLimit([{ limit: 1, windowMs: options.everyMs ?? NOTICE_EVERY_MS }], options.now);
  return {
    allow(notification: Pick<Notification, "kind" | "toPersons" | "threadId">): boolean {
      if (notification.kind !== "mention" || !notification.toPersons?.length) return true;
      return once(`${notification.toPersons.join(",")}|${notification.threadId}`);
    },
  };
}
