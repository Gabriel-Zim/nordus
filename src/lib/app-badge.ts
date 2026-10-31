import { nativeBadge } from "@/lib/native-app";

interface NordusShell {
  setBadge?: (count: number) => void;
}

type BadgeNavigator = Navigator & {
  setAppBadge?: (count?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

/** Unread count on the app icon: the Nordus Mac app's Dock, the iPhone app, and an installed web app (iOS 16.4+, Chrome) where the Badging API exists. */
export function publishAppBadge(count: number): void {
  const badge = nativeBadge();
  if (badge) {
    void (count > 0 ? badge.set({ count }) : badge.clear()).catch(() => {});
    return;
  }
  const shell = (window as Window & { nordusShell?: NordusShell }).nordusShell;
  shell?.setBadge?.(count);
  const nav = navigator as BadgeNavigator;
  if (shell || !nav.setAppBadge) return;
  const done = count > 0 ? nav.setAppBadge(count) : nav.clearAppBadge?.();
  done?.catch(() => {});
}
