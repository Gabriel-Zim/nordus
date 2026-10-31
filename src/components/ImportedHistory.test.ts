import { describe, expect, it } from "vitest";
import { liveThreadAway } from "./ImportedHistory";

const imported = { threadId: "g1", title: "Grok", createdAt: 1, importedFrom: "grok" as const };
const live = { threadId: "t1", title: "Agora", createdAt: 2 };
const run = { threadId: "r1", title: "Rotina", createdAt: 3, routineRunId: "run" };

describe("liveThreadAway", () => {
  it("leaves a live conversation alone", () => {
    expect(liveThreadAway([imported, live], "t1")).toBeNull();
  });
  it("moves off an imported conversation to the main thread", () => {
    expect(liveThreadAway([imported, run, live], "g1", "t1")).toBe("t1");
  });
  it("skips routine runs and imported threads when there is no main", () => {
    expect(liveThreadAway([imported, run, live], "g1")).toBe("t1");
  });
  it("stays when nothing live exists", () => {
    expect(liveThreadAway([imported], "g1")).toBeNull();
  });
});
