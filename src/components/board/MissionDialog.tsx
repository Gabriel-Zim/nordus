import { useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { Target } from "lucide-react";
import { useModalDialog } from "@/hooks/use-modal-dialog";
import { t } from "@/lib/i18n";
import type { NewMissionBody } from "@/lib/board";
import type { Outcome } from "@/state/board";
import type { Bot } from "@/state/store";
import { BOARD_LIMITS } from "../../../shared/board";
import type { MissionResponse } from "../../../shared/board";
import { BotPickerList } from "../BotPickerList";
import { Select } from "../Select";

const FIELD = "mt-1 w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[13px] font-normal text-ink placeholder:text-ink-tertiary";

export function MissionDialog({ bots, onClose, onCreate, onCreated }: {
  bots: readonly Bot[];
  onClose: () => void;
  onCreate: (body: NewMissionBody) => Promise<Outcome<MissionResponse>>;
  onCreated: (mission: MissionResponse["mission"]) => void;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [lead, setLead] = useState(() => (bots.find((bot) => bot.chiefOfStaff) ?? bots[0])?.id ?? "");
  const [team, setTeam] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  useModalDialog(dialog, () => { if (!busy) onClose(); });

  const members = [lead, ...[...team].filter((id) => id !== lead)];
  const ready = Boolean(title.trim() && goal.trim() && lead) && members.length <= BOARD_LIMITS.missionTeam;
  const toggle = (id: string) => setTeam((current) => {
    const next = new Set(current);
    if (!next.delete(id)) next.add(id);
    return next;
  });
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setProblem(null);
    const result = await onCreate({ title: title.trim(), goal: goal.trim(), leadBotId: lead, teamBotIds: members });
    setBusy(false);
    if (result.ok) onCreated(result.value.mission);
    else setProblem(t("missions.new.failed", { error: result.error }));
  };

  return createPortal(
    <div data-thread-overlay="" className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <div ref={dialog} role="dialog" aria-modal="true" tabIndex={-1} aria-label={t("missions.new.title")} aria-busy={busy || undefined}
        className="flex max-h-full w-full max-w-[520px] flex-col rounded-2xl border border-hairline/50 bg-panel p-5 text-ink shadow-2xl">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold"><Target size={16} aria-hidden="true" />{t("missions.new.title")}</h2>
        {bots.length === 0 ? (
          <>
            <p className="mt-3 text-[13px] text-ink-secondary">{t("missions.new.noAgents")}</p>
            <div className="mt-4 flex justify-end"><button type="button" className="ui-button" onClick={onClose}>{t("common.close")}</button></div>
          </>
        ) : (
          <form onSubmit={(event) => void submit(event)} className="mt-3 flex min-h-0 flex-col gap-3.5 overflow-y-auto">
            <label className="block text-[12px] font-semibold text-ink-secondary">{t("missions.new.titleLabel")}
              <input value={title} maxLength={BOARD_LIMITS.missionTitle} autoFocus autoComplete="off" disabled={busy} onChange={(event) => setTitle(event.target.value)} className={FIELD} />
            </label>
            <label className="block text-[12px] font-semibold text-ink-secondary">{t("missions.new.goalLabel")}
              <textarea value={goal} rows={4} maxLength={BOARD_LIMITS.missionGoal} disabled={busy} placeholder={t("missions.new.goalPlaceholder")} onChange={(event) => setGoal(event.target.value)} className={`${FIELD} resize-y`} />
            </label>
            <div className="text-[12px] font-semibold text-ink-secondary">
              <span>{t("missions.new.leadLabel")}</span>
              <Select aria-label={t("missions.new.leadLabel")} className="mt-1 w-full" value={lead} disabled={busy} onChange={(event) => setLead(event.target.value)}>
                {bots.map((bot) => <option key={bot.id} value={bot.id}>{bot.name}</option>)}
              </Select>
            </div>
            {bots.length > 1 && (
              <div className="text-[12px] font-semibold text-ink-secondary">
                <span>{t("missions.new.teamLabel")}</span>
                <p className="mt-0.5 font-normal text-ink-tertiary">{t("missions.new.teamHint")}</p>
                {/* BotPickerList's buttons have no type: inside a form, each press would submit it. */}
                <div className="mt-1 rounded-lg border border-hairline/40 bg-inset p-1" onClick={(event) => event.preventDefault()}>
                  <BotPickerList bots={bots.filter((bot) => bot.id !== lead)} picked={team} onToggle={toggle} emptyHint={t("missions.new.noAgents")} />
                </div>
              </div>
            )}
            {problem && <p role="alert" className="text-[12.5px] text-danger">{problem}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" className="ui-button" disabled={busy} onClick={onClose}>{t("common.cancel")}</button>
              <button type="submit" className="ui-button ui-button-primary" disabled={!ready || busy}>{t(busy ? "missions.new.creating" : "missions.new.create")}</button>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body,
  );
}
