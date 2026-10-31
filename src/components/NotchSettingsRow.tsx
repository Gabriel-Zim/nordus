import { useEffect, useState } from "react";
import { t } from "@/lib/i18n";
import { SettingRow, Switch } from "./SettingsPrimitives";

type NotchState = Awaited<ReturnType<NonNullable<NonNullable<Window["ogb"]>["notch"]>["state"]>>;

/** Only the Mac desktop app offers it; every other place renders nothing. */
export function NotchSettingsRow() {
  const bridge = typeof window !== "undefined" ? window.ogb?.notch : undefined;
  const [state, setState] = useState<NotchState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!bridge) return;
    let live = true;
    bridge.state().then((next) => { if (live) setState(next); }).catch(() => {});
    return () => { live = false; };
  }, [bridge]);

  if (!bridge || !state) return null;
  const toggle = () => {
    setBusy(true);
    bridge.setEnabled(!state.enabled).then(setState).catch(() => {}).finally(() => setBusy(false));
  };

  return (
    <SettingRow title={t("notch.settings.title")} subtitle={t(state.display === "pill" ? "notch.settings.subtitlePill" : "notch.settings.subtitle")}>
      <Switch checked={state.enabled} disabled={busy} aria-label={t("notch.settings.title")} onClick={toggle} />
    </SettingRow>
  );
}
