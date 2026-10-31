import { markAllNotificationLogRead, markNotificationLogRead, recentNotificationLog } from "../message-db.ts";
import { parseQuietHours } from "../../shared/notification-quiet.ts";
import type { NotificationLogEntry } from "../../shared/notification.ts";
import { DIRECT_THREAD_PREFIX } from "../../shared/people.ts";
import type { VisibleSet } from "../bot-visibility.ts";
import type { QuietHoursStore } from "../notify-quiet.ts";
import { reaches } from "../people-notify.ts";
import { authIsAdmin } from "../people-roles.ts";
import type { RequestAuth } from "../request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

const QUIET_HOURS_PATH = "/api/notifications/quiet-hours";

export interface NotificationAudience {
  visibleFor(auth: RequestAuth): VisibleSet;
  emailOf(auth: RequestAuth): string | undefined;
}

export function createNotificationRoutes(deps = {
  recent: recentNotificationLog,
  markRead: markNotificationLogRead,
  markAllRead: markAllNotificationLogRead,
}, quiet?: { hours: QuietHoursStore; timeZone(): string }, audience?: NotificationAudience): RouteHandler {
  /** What the feed shows this caller: what was addressed to them or to everyone, about conversations and agents they can see. */
  const shownTo = (auth: RequestAuth): ((entry: NotificationLogEntry) => boolean) => {
    if (!audience) return () => true;
    const visible = audience.visibleFor(auth);
    const recipient = { email: audience.emailOf(auth), admin: authIsAdmin(auth) };
    return (entry) => reaches(entry, recipient)
      && (entry.threadId.startsWith(DIRECT_THREAD_PREFIX) || (visible.thread(entry.threadId) && (!entry.botId || visible.bot(entry.botId))));
  };
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (method === "GET" && path === "/api/notifications") {
      return json(res, 200, { notifications: deps.recent().filter(shownTo(auth)) });
    }
    if (quiet && path === QUIET_HOURS_PATH && method === "GET") {
      return json(res, 200, { quietHours: quiet.hours.current(), timeZone: quiet.timeZone(), canEdit: auth.scopes.includes("admin") });
    }
    if (quiet && path === QUIET_HOURS_PATH && method === "PUT") {
      if (!auth.scopes.includes("admin")) return json(res, 403, { error: "only an admin changes quiet hours" });
      const next = parseQuietHours(await readBody(req, 1024));
      if (!next) return json(res, 400, { error: "quiet hours need enabled, start and end as HH:MM" });
      quiet.hours.save(next);
      return json(res, 200, { quietHours: next, timeZone: quiet.timeZone(), canEdit: true });
    }
    if (method !== "POST") return PASS;
    if (path === "/api/notifications/read-all") {
      if (!audience) deps.markAllRead();
      else for (const entry of deps.recent().filter(shownTo(auth))) if (!entry.read) deps.markRead(entry.id);
      return json(res, 200, { ok: true });
    }
    const m = path.match(/^\/api\/notifications\/([\w-]+)\/read$/);
    if (!m) return PASS;
    if (audience && !deps.recent().filter(shownTo(auth)).some((entry) => entry.id === m[1])) return json(res, 404, { error: "no such notification" });
    deps.markRead(m[1]!);
    return json(res, 200, { ok: true });
  };
}
