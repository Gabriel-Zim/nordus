import type { Notification } from "./notification.ts";

/** Whether a notification earns a banner on a device at all, before any "is the person already looking" check.
 *  One rule for the page's banner and the push sent with the app closed, so the two never disagree. */
export function bannerWanted(frame: Pick<Notification, "kind" | "priority">, preferences: { finished: boolean }): boolean {
  // Normal news waits for the daily summary: it lands in the feed without a banner.
  if (frame.priority === "normal") return false;
  if (frame.kind === "done" && !preferences.finished) return false;
  return true;
}

/** Banners for one bot replace each other instead of piling up; spend alerts stack on their own. */
export function bannerTag(frame: Pick<Notification, "kind" | "botId">): string {
  return frame.kind === "spend" ? "nordus:spend" : `nordus:${frame.botId}`;
}
