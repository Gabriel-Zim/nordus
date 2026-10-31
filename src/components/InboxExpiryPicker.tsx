import { useEffect, useState } from "react";
import { t } from "@/lib/i18n";
import { api } from "@/state/api";
import { APPROVALS_PATH } from "../../shared/approvals";
import { Select } from "./Select";

interface ExpirySetting {
  ttlMs: number;
  minMs: number;
  maxMs: number;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const PRESETS = [1, 4, 12, 24, 72, 168].map((hours) => hours * HOUR);

export function lengthText(ms: number): string {
  if (ms >= 2 * DAY && ms % DAY === 0) return t("inbox.expiry.days", { count: ms / DAY });
  if (ms % HOUR === 0) return t("inbox.expiry.hours", { count: ms / HOUR });
  return t("inbox.expiry.minutes", { count: Math.round(ms / 60_000) });
}

export function InboxExpiryPicker() {
  const [setting, setSetting] = useState<ExpirySetting | null>(null);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    api<ExpirySetting>(`${APPROVALS_PATH}/settings`).then((value) => { if (alive) setSetting(value); }, () => {});
    return () => { alive = false; };
  }, []);

  if (!setting) return null;
  const options = [...new Set([...PRESETS.filter((ms) => ms >= setting.minMs && ms <= setting.maxMs), setting.ttlMs])].sort((a, b) => a - b);
  const choose = (ttlMs: number) => {
    setSaving(true);
    setFailed(false);
    api<ExpirySetting>(`${APPROVALS_PATH}/settings`, { method: "PUT", body: JSON.stringify({ ttlMs }) })
      .then(setSetting, () => setFailed(true))
      .finally(() => setSaving(false));
  };
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2 text-[12px] text-ink-secondary">
        <span id="inbox-expiry-label">{t("inbox.expiry.label")}</span>
        <Select
          size="sm"
          aria-labelledby="inbox-expiry-label"
          disabled={saving}
          value={String(setting.ttlMs)}
          onChange={(event) => choose(Number(event.target.value))}
        >
          {options.map((ms) => <option key={ms} value={String(ms)}>{lengthText(ms)}</option>)}
        </Select>
      </div>
      {failed && <p role="alert" className="text-[11.5px] text-danger">{t("inbox.expiry.failed")}</p>}
    </div>
  );
}
