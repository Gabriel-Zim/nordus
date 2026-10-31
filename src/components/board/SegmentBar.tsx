import { cn } from "@/lib/cn";
import type { StepState } from "@/lib/board";

const SEGMENT: Record<StepState, string> = { done: "bg-success", active: "bg-accent", todo: "bg-raised" };

export function SegmentBar({ states, label }: { states: readonly StepState[]; label: string }) {
  if (states.length === 0) return <div aria-hidden="true" className="h-1.5 rounded-full bg-raised" />;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={states.length}
      aria-valuenow={states.filter((state) => state === "done").length}
      aria-valuetext={label}
      data-progress=""
      className="flex gap-1"
    >
      {states.map((state, index) => <span key={index} data-step-state={state} className={cn("h-1.5 min-w-2 flex-1 rounded-full", SEGMENT[state])} />)}
    </div>
  );
}
