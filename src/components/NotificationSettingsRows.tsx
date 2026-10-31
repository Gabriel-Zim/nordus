import { useEffect, useRef, useState } from "react";
import { t } from "@/lib/i18n";
import {
  setFinishedNotifications,
  setNotificationFeed,
  setNotificationSounds,
  useFinishedNotifications,
  useNotificationFeed,
  useNotificationSounds,
} from "@/lib/notification-preferences";
import { finishedNotificationsEnabled, notificationSoundsEnabled } from "@/lib/notification-preferences";
import { requestNotificationPermission } from "@/lib/notify";
import { enablePush, syncPushPreferences } from "@/lib/web-push";
import { api } from "@/state/store";
import type { QuietHours } from "../../shared/notification-quiet";
import { NotchSettingsRow } from "./NotchSettingsRow";
import { SettingRow, Switch } from "./SettingsPrimitives";

export function NotificationRows() {
  return (
    <>
      <DeviceNotificationsRow />
      <NotificationSoundsRow />
      <QuietHoursRow />
      <NotificationFeedRow />
      <NotchSettingsRow />
    </>
  );
}

/** Read after the switch flips: a closed page cannot read local storage, so the server keeps a copy for the push. */
const pushPreferences = () => ({ finished: finishedNotificationsEnabled(), sounds: notificationSoundsEnabled() });

const currentPermission = (): NotificationPermission => (typeof Notification !== "undefined" ? Notification.permission : "default");

/** A browser shows nothing until it is asked from a click; the person may also change the site permission elsewhere. */
export function DeviceNotificationsRow() {
  const [permission, setPermission] = useState(currentPermission);
  const enabled = useFinishedNotifications();
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") setPermission(currentPermission());
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  if (typeof Notification === "undefined") return null;

  const blocked = permission === "denied";
  const toggle = async () => {
    if (permission === "granted") {
      setFinishedNotifications(!enabled);
      return syncPushPreferences(pushPreferences());
    }
    const next = await requestNotificationPermission();
    if (!next) return;
    setPermission(next);
    if (next !== "granted") return;
    setFinishedNotifications(true);
    // Nordus: the same banners with the app closed, on browsers with Web Push (the iPhone home screen app included).
    await enablePush(pushPreferences());
  };

  return (
    <SettingRow
      title={t("settings.deviceNotifications.title")}
      subtitle={t(blocked ? "settings.deviceNotifications.blocked" : "settings.deviceNotifications.subtitle")}
    >
      <Switch
        checked={permission === "granted" && enabled}
        disabled={blocked}
        aria-label={t("settings.deviceNotifications.show")}
        onClick={() => void toggle()}
      />
    </SettingRow>
  );
}

export function NotificationSoundsRow() {
  const enabled = useNotificationSounds();
  return (
    <SettingRow title={t("settings.notificationSounds.title")} subtitle={t("settings.notificationSounds.subtitle")}>
      <Switch
        checked={enabled}
        aria-label={t("settings.notificationSounds.play")}
        onClick={() => {
          setNotificationSounds(!enabled);
          void syncPushPreferences(pushPreferences());
        }}
      />
    </SettingRow>
  );
}

export function NotificationFeedRow() {
  const enabled = useNotificationFeed();
  return (
    <SettingRow title={t("settings.notificationFeed.title")} subtitle={t("settings.notificationFeed.subtitle")}>
      <Switch
        checked={enabled}
        aria-label={t("settings.notificationFeed.show")}
        onClick={() => setNotificationFeed(!enabled)}
      />
    </SettingRow>
  );
}

const QUIET_HOURS_PATH = "/api/notifications/quiet-hours";
const TIME_INPUT = "rounded-lg border border-hairline/50 bg-inset px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent";

/** The server decides whether a push rings, so the hours live there, on its clock. */
export function QuietHoursRow() {
  const [quiet, setQuiet] = useState<QuietHours | null>(null);
  const saved = useRef<QuietHours | null>(null);
  const latest = useRef(0);
  useEffect(() => {
    let live = true;
    api<{ quietHours: QuietHours; canEdit?: boolean }>(QUIET_HOURS_PATH)
      .then((body) => {
        if (!live || !body.canEdit) return;
        saved.current = body.quietHours;
        setQuiet(body.quietHours);
      })
      .catch(() => {});
    return () => { live = false; };
  }, []);
  if (!quiet) return null;

  // The hours are the person's: they are read on this device's clock, whatever zone the server runs in.
  const save = (next: QuietHours) => {
    const sent = { ...next, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone };
    const attempt = ++latest.current;
    setQuiet(sent);
    api<{ quietHours: QuietHours }>(QUIET_HOURS_PATH, { method: "PUT", body: JSON.stringify(sent) })
      .then((body) => {
        saved.current = body.quietHours;
        if (attempt === latest.current) setQuiet(body.quietHours);
      })
      .catch(() => { if (attempt === latest.current) setQuiet(saved.current); });
  };

  return (
    <SettingRow
      title={t("settings.quietHours.title")}
      subtitle={t("settings.quietHours.subtitle")}
      message={quiet.enabled ? (
        <span className="flex flex-wrap items-center gap-2 text-[13px] text-ink-secondary">
          {t("settings.quietHours.from")}
          <input type="time" aria-label={t("settings.quietHours.start")} value={quiet.start} className={TIME_INPUT}
            onChange={(event) => { if (event.target.value) save({ ...quiet, start: event.target.value }); }} />
          {t("settings.quietHours.to")}
          <input type="time" aria-label={t("settings.quietHours.end")} value={quiet.end} className={TIME_INPUT}
            onChange={(event) => { if (event.target.value) save({ ...quiet, end: event.target.value }); }} />
        </span>
      ) : undefined}
    >
      <Switch
        checked={quiet.enabled}
        aria-label={t("settings.quietHours.enable")}
        onClick={() => save({ ...quiet, enabled: !quiet.enabled })}
      />
    </SettingRow>
  );
}
