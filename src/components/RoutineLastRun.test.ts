import { describe, expect, it } from "vitest";
import type { Routine, RoutineRun } from "@/lib/routines";
import { routineLastRun } from "./RoutineLastRun";
import { needsYouEntries } from "./NeedsYouPanel";
import type { AttentionThread } from "./SidebarBotActivity";

const routine = (patch: Partial<Routine> = {}) => ({ id: "r1", enabled: true, ...patch }) as Routine;
const run = (status: RoutineRun["status"], at: number) => ({ id: `run-${at}`, routineId: "r1", status, scheduledFor: at, finishedAt: at }) as RoutineRun;

describe("routine last run", () => {
  it("says paused before anything else", () => {
    expect(routineLastRun(routine({ enabled: false }), [run("failed", 1)]).tone).toBe("idle");
  });

  it("reads the newest run", () => {
    expect(routineLastRun(routine(), []).tone).toBe("idle");
    expect(routineLastRun(routine(), [run("failed", 1), run("completed", 2)]).tone).toBe("ok");
    expect(routineLastRun(routine(), [run("completed", 1), run("failed", 2)]).tone).toBe("bad");
    expect(routineLastRun(routine(), [run("running", 3)]).tone).toBe("busy");
    expect(routineLastRun(routine(), [run("waiting", 3)]).tone).toBe("wait");
  });
});

describe("needs you", () => {
  it("keeps only threads waiting on the person", () => {
    const entry = (activity?: string) => ({ kind: "bot", botId: "b", botName: "B", task: { threadId: activity ?? "none", title: "t", activity, queued: false } }) as unknown as AttentionThread;
    expect(needsYouEntries([entry("waiting-on-you"), entry("working"), entry()]).map((e) => e.task.threadId)).toEqual(["waiting-on-you"]);
  });
});
