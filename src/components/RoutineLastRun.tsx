import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { niceDate, niceTime } from "@/lib/schedule-label";
import type { Routine, RoutineRun } from "@/lib/routines";

export type RoutineLastRunTone = "ok" | "bad" | "busy" | "wait" | "idle";

function runAt(run: RoutineRun): number {
  return run.finishedAt ?? run.startedAt ?? run.scheduledFor;
}

function when(at: number): string {
  return new Date(at).toDateString() === new Date().toDateString() ? niceTime(at) : `${niceDate(at)}, ${niceTime(at)}`;
}

export function routineLastRun(routine: Routine, runs: readonly RoutineRun[]): { label: string; tone: RoutineLastRunTone } {
  if (!routine.enabled) return { label: t("routines.last.paused"), tone: "idle" };
  const last = runs
    .filter((run) => run.routineId === routine.id && run.status !== "cancelled")
    .reduce<RoutineRun | undefined>((best, run) => (!best || runAt(run) > runAt(best) ? run : best), undefined);
  if (!last) return { label: t("routines.last.never"), tone: "idle" };
  if (last.status === "running" || last.status === "queued") return { label: t("routines.last.running"), tone: "busy" };
  if (last.status === "waiting") return { label: t("routines.last.waiting"), tone: "wait" };
  if (last.status === "failed" || last.status === "missed") return { label: t("routines.last.failed", { when: when(runAt(last)) }), tone: "bad" };
  return { label: t("routines.last.ran", { when: when(runAt(last)) }), tone: "ok" };
}

const TONE: Record<RoutineLastRunTone, string> = {
  ok: "border-success/30 bg-success/10 text-success",
  bad: "border-danger/30 bg-danger/10 text-danger",
  busy: "border-accent/30 bg-accent/10 text-accent-text",
  wait: "border-warning/30 bg-warning/10 text-warning",
  idle: "border-white/10 bg-white/[0.04] text-ink-secondary",
};

export function RoutineLastRunBadge({ routine, runs }: { routine: Routine; runs: readonly RoutineRun[] }) {
  const { label, tone } = routineLastRun(routine, runs);
  return (
    <span
      data-routine-last-run={tone}
      className={cn("inline-flex max-w-full shrink-0 items-center gap-1.5 rounded-[7px] border px-1.5 py-px text-[11px] font-medium leading-4", TONE[tone])}
    >
      <span className={cn("size-1.5 shrink-0 rounded-full bg-current", tone === "busy" && "animate-pulse")} aria-hidden="true" />
      <span className="truncate">{label}</span>
    </span>
  );
}
