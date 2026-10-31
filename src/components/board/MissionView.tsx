import { useEffect, useState } from "react";
import { ArrowLeft, Check, MessageSquare, Pause, Play, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { activeLocale, t } from "@/lib/i18n";
import { COLUMN_LABEL, missionSteps, type Directory, type MissionStep } from "@/lib/board";
import type { BoardActions } from "@/state/board";
import { listNames } from "../../../shared/place-view";
import type { BoardMission, BoardTask, MissionReceipt } from "../../../shared/board";
import { AssigneeAvatar } from "./Assignee";
import { MissionFeed } from "./MissionFeed";
import { MissionStatusChip, progressLabel } from "./MissionList";
import { SegmentBar } from "./SegmentBar";

const PAUSABLE = new Set(["planning", "running", "waiting"]);

function StepMark({ step }: { step: MissionStep }) {
  const label = t(COLUMN_LABEL[step.task?.status ?? "todo"]);
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      data-step-mark={step.state}
      className={cn(
        "flex size-[18px] shrink-0 items-center justify-center rounded-[5px] border",
        step.state === "done" && "border-success bg-success text-white",
        step.state === "active" && "border-accent bg-accent/20",
        step.state === "todo" && "border-hairline",
      )}
    >
      {step.state === "done" && <Check size={12} strokeWidth={3} aria-hidden="true" />}
      {step.state === "active" && <span className="size-1.5 rounded-full bg-accent" />}
    </span>
  );
}

function AgentChip({ assignee, directory }: { assignee: string; directory: Directory }) {
  return (
    <span data-agent-chip={assignee} className="ui-chip shrink-0 bg-raised pl-1 text-ink">
      <span aria-hidden="true"><AssigneeAvatar assignee={assignee} directory={directory} size={16} /></span>
      <span className="max-w-[120px] truncate">{directory.assigneeName(assignee)}</span>
    </span>
  );
}

export function MissionView({ mission, tasks, directory, actions, canDelete, onBack, onOpenTask, onOpenRoom, onNotice }: {
  mission: BoardMission;
  tasks: readonly BoardTask[];
  directory: Directory;
  actions: Pick<BoardActions, "loadMission" | "pauseMission" | "resumeMission" | "answerMission" | "deleteMission">;
  canDelete: boolean;
  onBack: () => void;
  onOpenTask: (id: number, opener: HTMLElement) => void;
  onOpenRoom: () => void;
  onNotice: (text: string) => void;
}) {
  const [receipt, setReceipt] = useState<MissionReceipt | undefined>();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const steps = missionSteps(mission, tasks);
  const stopReason = mission.pausedDetail ?? mission.pausedReason;
  const label = progressLabel(steps);
  const finished = mission.status === "done" || mission.status === "failed";
  const team = [mission.leadBotId, ...mission.teamBotIds.filter((id) => id !== mission.leadBotId)];
  const opener = directory.isMe(mission.createdBy) ? t("board.actor.youLower") : directory.actorName(mission.createdBy);

  useEffect(() => {
    if (!finished) return;
    let live = true;
    void actions.loadMission(mission.id).then((result) => { if (live && result.ok) setReceipt(result.value.receipt); });
    return () => { live = false; };
  }, [actions, finished, mission.id, mission.status]);

  const run = async (action: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(true);
    const result = await action();
    setBusy(false);
    if (!result.ok) onNotice(t("missions.action.failed", { error: result.error ?? "" }));
    return result.ok;
  };

  return (
    <div data-testid="mission-view" className="grid min-h-0 flex-1 gap-5 px-6 py-5 max-md:px-3 max-lg:overflow-y-auto lg:grid-cols-[minmax(0,1fr)_minmax(320px,400px)] lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden">
      <div className="flex min-w-0 flex-col gap-5 lg:min-h-0 lg:overflow-y-auto lg:pr-1">
        <button type="button" onClick={onBack} className="ui-button ui-button-sm w-fit"><ArrowLeft size={14} aria-hidden="true" />{t("missions.back")}</button>
        <header className="space-y-1">
          <div className="flex items-start gap-3">
            <h2 className="min-w-0 flex-1 text-[20px] font-semibold leading-tight text-ink">{mission.title}</h2>
            <MissionStatusChip status={mission.status} />
          </div>
          <p data-mission-subtitle="" className="text-[13px] text-ink-secondary">
            {t("missions.subtitle", { opener, agents: listNames(team.map((id) => directory.assigneeName(id)), activeLocale()) })}
          </p>
        </header>
        <div className="flex flex-wrap gap-2">
          {PAUSABLE.has(mission.status) && (
            <button type="button" disabled={busy} className="ui-button" onClick={() => void run(() => actions.pauseMission(mission.id))}><Pause size={14} aria-hidden="true" />{t("missions.pause")}</button>
          )}
          {mission.status === "paused" && (
            <button type="button" disabled={busy} className="ui-button ui-button-primary" onClick={() => void run(() => actions.resumeMission(mission.id))}><Play size={14} aria-hidden="true" />{t("missions.resume")}</button>
          )}
          <button type="button" className="ui-button" onClick={onOpenRoom}><MessageSquare size={14} aria-hidden="true" />{t("missions.openRoom")}</button>
        </div>
        {(mission.status === "paused" || mission.status === "failed") && (
          <p role="status" data-mission-stopped="" className="rounded-lg bg-card px-3 py-2 text-[13px] leading-snug text-ink">
            {stopReason
              ? t(mission.status === "paused" ? "missions.paused.reason" : "missions.failed.reason", { reason: stopReason })
              : t(mission.status === "paused" ? "missions.paused.plain" : "missions.failed.end")}
            {mission.status === "paused" && mission.pausedBy && (
              <span className="mt-0.5 block text-ink-secondary">{t(mission.pausedBy === "system" ? "missions.paused.auto" : "missions.paused.manual")}</span>
            )}
          </p>
        )}
        <section aria-labelledby="mission-steps" className="space-y-2.5">
          <h3 id="mission-steps" className="text-[13px] font-semibold text-ink">{t("missions.steps")}</h3>
          {steps.length === 0 ? (
            <p className="text-[12.5px] text-ink-tertiary">{t("missions.stepsEmpty")}</p>
          ) : (
            <ol data-mission-steps="" className="space-y-1.5">
              {steps.map((step) => (
                <li key={step.id}>
                  <button
                    type="button"
                    disabled={!step.task}
                    data-step-id={step.id}
                    onClick={(event) => step.task && onOpenTask(step.id, event.currentTarget)}
                    className="flex w-full items-center gap-3 rounded-lg bg-card px-3 py-2 text-left transition-colors enabled:hover:bg-raised/60 focus-visible:ring-2 focus-visible:ring-focus"
                  >
                    <StepMark step={step} />
                    <span className={cn("min-w-0 flex-1 truncate text-[13.5px]", step.state === "done" ? "text-ink-secondary" : "text-ink")}>
                      {step.task?.title ?? t("missions.step.missing", { id: step.id })}
                    </span>
                    {step.task?.assignee && <AgentChip assignee={step.task.assignee} directory={directory} />}
                  </button>
                </li>
              ))}
            </ol>
          )}
          <SegmentBar states={steps.map((step) => step.state)} label={label} />
          <p className="text-[12px] text-ink-secondary">{label}</p>
        </section>
        {canDelete && (confirming ? (
          <div role="alert" className="space-y-2 rounded-lg border border-danger/30 bg-card p-3">
            <p className="text-[13px] font-medium text-ink">{t("missions.delete.title")}</p>
            <p className="text-[12.5px] text-ink-secondary">{t("missions.delete.body")}</p>
            <div className="flex justify-end gap-2">
              <button type="button" className="ui-button ui-button-sm" onClick={() => setConfirming(false)}>{t("common.cancel")}</button>
              <button type="button" disabled={busy} className="ui-button ui-button-sm border-danger/40 text-danger" onClick={() => void run(() => actions.deleteMission(mission.id)).then((ok) => ok && onBack())}>{t("common.delete")}</button>
            </div>
          </div>
        ) : (
          <button type="button" className="ui-button ui-button-sm w-fit text-danger" onClick={() => setConfirming(true)}><Trash2 size={14} aria-hidden="true" />{t("missions.delete.action")}</button>
        ))}
      </div>
      <MissionFeed mission={mission} directory={directory} receipt={receipt} onAnswer={(answer) => run(() => actions.answerMission(mission.id, answer))} />
    </div>
  );
}
