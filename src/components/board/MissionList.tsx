import { Plus, Target } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { MISSION_STATUS_LABEL, missionSteps, sortMissions, type Directory, type MissionStep } from "@/lib/board";
import type { BoardMission, BoardTask, MissionStatus } from "../../../shared/board";
import { SegmentBar } from "./SegmentBar";

const TONE: Record<MissionStatus, string> = {
  planning: "bg-accent/15 text-accent-text",
  running: "bg-accent/15 text-accent-text",
  waiting: "bg-warning/15 text-warning",
  paused: "bg-raised text-ink-secondary",
  done: "bg-success/15 text-success",
  failed: "bg-danger/15 text-danger",
};

export function MissionStatusChip({ status }: { status: MissionStatus }) {
  return <span data-mission-status={status} className={cn("ui-chip shrink-0", TONE[status])}>{t(MISSION_STATUS_LABEL[status])}</span>;
}

export function progressLabel(steps: readonly MissionStep[]): string {
  return steps.length
    ? t("missions.progress", { done: steps.filter((step) => step.state === "done").length, total: steps.length })
    : t("missions.noSteps");
}

export function MissionList({ missions, tasks, directory, onOpen, onNew }: {
  missions: readonly BoardMission[];
  tasks: readonly BoardTask[];
  directory: Directory;
  onOpen: (id: string) => void;
  onNew: () => void;
}) {
  return (
    <div data-testid="mission-list" className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-6 py-5 max-md:px-3">
      <div className="flex items-center gap-3">
        <h2 className="flex-1 text-[15px] font-medium">{t("missions.title")}</h2>
        <button type="button" className="ui-button ui-button-primary" onClick={onNew}><Plus size={14} aria-hidden="true" />{t("missions.new")}</button>
      </div>
      {missions.length === 0 ? (
        <div data-testid="mission-empty" className="flex flex-col items-start gap-1.5 rounded-xl bg-card px-5 py-5">
          <Target size={18} aria-hidden="true" className="text-ink-secondary" />
          <h3 className="text-[15px] font-medium">{t("missions.empty.title")}</h3>
          <p className="text-[13px] leading-relaxed text-ink-secondary">{t("missions.empty.body")}</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {sortMissions(missions).map((mission) => {
            const steps = missionSteps(mission, tasks);
            const label = progressLabel(steps);
            return (
              <li key={mission.id}>
                <button
                  type="button"
                  data-mission-id={mission.id}
                  onClick={() => onOpen(mission.id)}
                  className="flex w-full flex-col gap-2.5 rounded-xl border border-hairline/40 bg-card px-4 py-3 text-left transition-colors hover:border-hairline focus-visible:ring-2 focus-visible:ring-focus"
                >
                  <span className="flex items-start gap-3">
                    <span className="min-w-0 flex-1 text-[14px] font-medium leading-snug text-ink">{mission.title}</span>
                    <MissionStatusChip status={mission.status} />
                  </span>
                  <SegmentBar states={steps.map((step) => step.state)} label={label} />
                  <span className="flex items-center gap-1.5 text-[12px] text-ink-secondary">
                    <span>{t("missions.ledBy", { name: directory.assigneeName(mission.leadBotId) })}</span>
                    <span aria-hidden="true">·</span>
                    <span>{label}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
