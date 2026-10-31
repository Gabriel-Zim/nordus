import { useEffect, useState } from "react";
import { t } from "@/lib/i18n";
import { api, useStore } from "@/state/store";
import { BotAvatar } from "./Avatar";
import { Card, SettingRow, Switch } from "./SettingsPrimitives";

interface BrainStatus { available: boolean; record: boolean; consult: boolean; clientFacing: string[]; roomDocs: Record<string, string[]> }

/** The second brain, as the Grok bot uses it: real work is logged by itself and internal bots read the room's slice;
 *  bots that serve clients are only logged. */
export function SecondBrainSettings() {
  const { state } = useStore();
  const [status, setStatus] = useState<BrainStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void api("/api/second-brain").then((result) => { if (live) setStatus(result as BrainStatus); }).catch(() => { if (live) setError(t("brain.loadFailed")); });
    return () => { live = false; };
  }, []);
  const save = async (patch: Partial<BrainStatus>) => {
    setError(null);
    try { setStatus(await api("/api/second-brain", { method: "PUT", body: JSON.stringify(patch) }) as BrainStatus); }
    catch (cause) { setError(cause instanceof Error && cause.message.startsWith("Cada sala") ? cause.message : t("brain.saveFailed")); }
  };
  if (!status) return error ? <Card title={t("brain.title")} subtitle={error} /> : null;
  const bots = state.bots.filter((bot) => !bot.hidden);
  const saveRoom = (roomId: string, text: string) => {
    const paths = text.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 5);
    const current = status.roomDocs[roomId] ?? [];
    if (paths.join("\n") === current.join("\n")) return;
    const next = { ...status.roomDocs };
    if (paths.length) next[roomId] = paths; else delete next[roomId];
    void save({ roomDocs: next });
  };
  const off = !status.available;
  return (
    <Card title={t("brain.title")} subtitle={off ? t("brain.unavailable") : t("brain.subtitle")}>
      <div className="-mx-4 flex flex-col gap-4">
        <SettingRow title={t("brain.record")} subtitle={t("brain.recordHint")}>
          <Switch aria-label={t("brain.record")} checked={status.record} disabled={off} title={off ? t("brain.unavailable") : undefined} onClick={() => void save({ record: !status.record })} className="cursor-pointer" />
        </SettingRow>
        <SettingRow title={t("brain.consult")} subtitle={t("brain.consultHint")}>
          <Switch aria-label={t("brain.consult")} checked={status.consult} disabled={off} title={off ? t("brain.unavailable") : undefined} onClick={() => void save({ consult: !status.consult })} className="cursor-pointer" />
        </SettingRow>
        <div className="px-4">
          <div className="text-[14px] font-medium text-ink">{t("brain.clientFacing")}</div>
          <div className="mt-1 text-[12px] leading-relaxed text-ink-secondary">{t("brain.clientFacingHint")}</div>
          <div className="mt-2 flex flex-col gap-0.5">
            {bots.map((bot) => {
              const on = status.clientFacing.includes(bot.id);
              return (
                <button key={bot.id} type="button" role="switch" aria-checked={on}
                  onClick={() => void save({ clientFacing: on ? status.clientFacing.filter((id) => id !== bot.id) : [...status.clientFacing, bot.id] })}
                  className="flex items-center gap-2 rounded-[8px] px-1.5 py-1 text-left hover:bg-white/[0.04]">
                  <BotAvatar bot={bot} size={22} />
                  <span className="nb-name min-w-0 flex-1 truncate text-[13px] text-ink">{bot.name}</span>
                  <span className={`relative h-[18px] w-8 shrink-0 rounded-full transition-colors ${on ? "bg-accent" : "bg-white/15"}`}>
                    <span className={`absolute top-[2px] size-[14px] rounded-full bg-white transition-all ${on ? "left-[16px]" : "left-[2px]"}`} />
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        {state.groups.length > 0 && (
          <div className="px-4">
            <div className="text-[14px] font-medium text-ink">{t("brain.roomDocs")}</div>
            <div className="mt-1 text-[12px] leading-relaxed text-ink-secondary">{t("brain.roomDocsHint")}</div>
            <div className="mt-2 flex flex-col gap-2">
              {state.groups.map((room) => (
                <label key={room.id} className="flex flex-col gap-1">
                  <span className="nb-name text-[12.5px] text-ink">{room.name}</span>
                  <textarea
                    key={(status.roomDocs[room.id] ?? []).join("\n")}
                    defaultValue={(status.roomDocs[room.id] ?? []).join("\n")}
                    onBlur={(event) => saveRoom(room.id, event.target.value)}
                    rows={2}
                    placeholder={t("brain.roomDocsPlaceholder")}
                    className="resize-y rounded-[10px] border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[12.5px] text-ink focus:border-focus focus:outline-none"
                  />
                </label>
              ))}
            </div>
          </div>
        )}
        {error && <p role="alert" className="px-4 text-[12px] text-danger/80">{error}</p>}
      </div>
    </Card>
  );
}
