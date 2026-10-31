import { Bell } from "lucide-react";
import { useStore } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { useNotificationFeed } from "@/lib/notification-preferences";
import { countsAsUnread } from "@/state/notification-feed";

/** The bell sits in the conversation's header, beside the computer and the menu, and only while the feed is on.
 *  Its count is the unread blue (the accent stays for what is active), and past 99 it reads 99+. */
export function NotificationsHeaderButton({ unreadOnly = false }: { unreadOnly?: boolean } = {}) {
  const { state, dispatch } = useStore();
  // No ensureList here: the store loads the feed at idle after the conversation is ready, and the panel asks when it opens.
  const feed = useNotificationFeed() && window.ogb?.remoteClient?.active !== true;
  if (!feed) return null;
  const unread = state.notifications.reduce((count, n) => count + (countsAsUnread(n) ? 1 : 0), 0);
  if (unreadOnly && unread === 0) return null;
  const open = state.notificationsOpen;
  return (
    <button
      type="button"
      data-header-notifications=""
      onClick={() => dispatch({ type: "toggleNotifications" })}
      aria-label={unread > 0 ? t("notifications.railUnread", { count: unread }) : t("notifications.title")}
      title={t("notifications.title")}
      aria-pressed={open}
      className={cn("relative rounded-md p-1.5 hover:bg-raised", open ? "text-accent" : "text-ink-secondary hover:text-ink")}
    >
      <Bell size={18} aria-hidden="true" />
      {unread > 0 && (
        <span
          data-notifications-count=""
          className="absolute -right-1 -top-0.5 flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-[var(--color-unread,#3b82f6)] px-1 text-[9.5px] font-semibold leading-none text-white ring-2 ring-[var(--color-app)]"
        >
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </button>
  );
}
