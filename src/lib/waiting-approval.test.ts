import { describe, expect, it } from "vitest";
import { waitingTaskFor } from "./waiting-approval";

const task = (threadId: string, extra: Record<string, unknown> = {}) => ({ threadId, title: threadId, createdAt: 1, ...extra });

describe("waitingTaskFor", () => {
  it("is undefined when no task waits on the person", () => {
    expect(waitingTaskFor({ tasks: [task("a", { activity: "working" }), task("b", { activity: "idle" }), task("c")] })).toBeUndefined();
    expect(waitingTaskFor({})).toBeUndefined();
  });

  it("returns the task that waits", () => {
    const tasks = [task("a"), task("b", { activity: "waiting-on-you" })];
    expect(waitingTaskFor({ tasks }, "a")?.threadId).toBe("b");
  });

  it("prefers a waiting task in another thread over the current one", () => {
    const tasks = [task("main", { activity: "waiting-on-you", updatedAt: 99 }), task("other", { activity: "waiting-on-you", updatedAt: 5 })];
    expect(waitingTaskFor({ tasks }, "main")?.threadId).toBe("other");
  });

  it("returns the current task when it is the only one waiting", () => {
    expect(waitingTaskFor({ tasks: [task("main", { activity: "waiting-on-you" }), task("b")] }, "main")?.threadId).toBe("main");
  });

  it("takes the most recently updated of several, falling back to creation time", () => {
    const tasks = [
      task("old", { activity: "waiting-on-you", updatedAt: 10 }),
      task("new", { activity: "waiting-on-you", updatedAt: 30 }),
      task("created", { activity: "waiting-on-you", createdAt: 20 }),
    ];
    expect(waitingTaskFor({ tasks }, "x")?.threadId).toBe("new");
    expect(waitingTaskFor({ tasks: [...tasks].reverse() }, "x")?.threadId).toBe("new");
  });

  it("keeps the listed order for equal times", () => {
    const tasks = [task("first", { activity: "waiting-on-you" }), task("second", { activity: "waiting-on-you" })];
    expect(waitingTaskFor({ tasks })?.threadId).toBe("first");
  });

  it("ignores a routine run's own conversation", () => {
    expect(waitingTaskFor({ tasks: [task("run", { activity: "waiting-on-you", routineRunId: "r1" })] })).toBeUndefined();
  });
});
