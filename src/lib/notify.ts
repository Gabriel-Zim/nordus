import type { Notification } from "../../shared/notification";
import { bannerTag, bannerWanted } from "../../shared/notification-banner";
import { finishedNotificationsEnabled, notificationSoundsEnabled } from "./notification-preferences";

export type NotifyFrame = Notification;

export type NotificationTarget = Pick<NotifyFrame, "botId" | "threadId" | "requestId">;

/** Call from the click: browsers may reject a permission request made later from an SSE frame. Resolves to the permission now in force. */
export async function requestNotificationPermission(): Promise<NotificationPermission | null> {
  if (typeof Notification === "undefined") return null;
  try {
    return Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
  } catch {
    return Notification.permission;
  }
}

export interface NotificationBotIdentity {
  id: string;
  avatarUrl?: string | null;
}

export function buildNotificationOptions(bot: NotificationBotIdentity): NotificationOptions {
  return { tag: `nordus:${bot.id}`, icon: bot.avatarUrl ?? undefined };
}

export function showNotification(
  frame: NotifyFrame,
  onOpen: (target: NotificationTarget) => void,
  avatarUrl?: string | null,
  visibleThreadId?: string | null,
) {
  if (typeof Notification === "undefined") return;
  if (!bannerWanted(frame, { finished: finishedNotificationsEnabled() })) return;
  const spend = frame.kind === "spend";
  if (!spend && document.hasFocus() && visibleThreadId === frame.threadId) return;

  const open = () => {
    window.focus();
    onOpen({ botId: frame.botId, threadId: frame.threadId, ...(frame.requestId ? { requestId: frame.requestId } : {}) });
  };

  if (Notification.permission === "granted") {
    const options: NotificationOptions = {
      body: frame.body,
      ...buildNotificationOptions({ id: frame.botId, avatarUrl }),
      tag: bannerTag(frame),
      ...(spend ? { icon: undefined } : {}),
      ...(notificationSoundsEnabled() ? {} : { silent: true }),
    };
    const fromPage = () => {
      try {
        new Notification(frame.title, options).onclick = open;
      } catch {}
    };
    // Through the service worker when one controls the page: the iPhone home screen app has no page-made banners,
    // and the same tag as a push means a banner that arrives both ways shows once. Its click comes back through
    // onNotificationOpen (src/lib/web-push.ts).
    const worker = typeof navigator !== "undefined" && navigator.serviceWorker?.controller ? navigator.serviceWorker : null;
    if (!worker) return fromPage();
    void worker.ready
      .then((reg) => reg.showNotification(frame.title, { ...options, data: { botId: frame.botId, threadId: frame.threadId } }))
      .catch(fromPage);
  }
}
