import type { NotificationLogEntry } from "../../shared/notification";

export const NOTIFICATION_FEED_LIMIT = 500;

export type NotificationFeedAction =
  | { type: "notificationsHydrated"; notifications: NotificationLogEntry[] }
  | { type: "notificationReceived"; entry: NotificationLogEntry }
  | { type: "notificationRead"; id: string }
  | { type: "notificationsMarkAllRead" }
  | { type: "notificationsResolved"; ids: string[]; at: number };

export { countsAsUnread } from "../../shared/notification";

/** Newest first. Hydration takes the server's copy of each entry it returns and keeps live entries it has not seen yet. */
export function reduceNotificationFeed(feed: NotificationLogEntry[], action: NotificationFeedAction): NotificationLogEntry[] {
  switch (action.type) {
    case "notificationsHydrated": {
      const served = new Set(action.notifications.map((entry) => entry.id));
      const resolvedHere = new Map(feed.flatMap((entry) => (entry.resolvedAt === undefined ? [] : [[entry.id, entry.resolvedAt] as const])));
      const fresh = action.notifications.map((entry) => {
        const at = entry.resolvedAt ?? resolvedHere.get(entry.id);
        return at === undefined || entry.resolvedAt !== undefined ? entry : { ...entry, resolvedAt: at };
      });
      return [...feed.filter((entry) => !served.has(entry.id)), ...fresh]
        .sort((a, b) => b.at - a.at)
        .slice(0, NOTIFICATION_FEED_LIMIT);
    }
    case "notificationReceived":
      return feed.some((entry) => entry.id === action.entry.id) ? feed : [action.entry, ...feed].slice(0, NOTIFICATION_FEED_LIMIT);
    case "notificationRead":
      return feed.map((entry) => (entry.id === action.id && !entry.read ? { ...entry, read: true } : entry));
    case "notificationsMarkAllRead":
      return feed.map((entry) => (entry.read ? entry : { ...entry, read: true }));
    case "notificationsResolved": {
      const ids = new Set(action.ids);
      return feed.map((entry) => (ids.has(entry.id) && entry.resolvedAt === undefined ? { ...entry, resolvedAt: action.at } : entry));
    }
  }
}
