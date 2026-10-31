import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { BOARD_LIMITS } from "../../shared/board.ts";
import { BoardError } from "./errors.ts";
import { MissionStore } from "./missions-store.ts";
import type { StoredMission } from "./schema.ts";

const person = { kind: "person", id: "rafael@zorg.com" } as const;
const mission = (id: string, extra: Partial<StoredMission> = {}): StoredMission => ({
  id, title: "Virar", goal: "g", createdBy: person, createdAt: 1, status: "running", leadBotId: "dev", teamBotIds: ["dev"],
  groupId: "sala", threadId: "th-sala", stepIds: [], feed: [], runner: {}, ...extra,
});
const dirOf = () => mkdtempSync(join(tmpdir(), "nordus-missions-store-"));

describe("mission store", () => {
  it("keeps a whole mission when one field is longer than today's limit, cutting only that field", () => {
    const dir = dirOf();
    const long = mission("m1", { runner: { answer: { botId: "dev", text: "r".repeat(BOARD_LIMITS.runnerText + 900) } } });
    writeFileSync(join(dir, "missions.json"), JSON.stringify({ version: 1, missions: [long, mission("m2")] }));
    const store = new MissionStore(dir);
    expect(store.all().map((item) => item.id)).toEqual(["m1", "m2"]);
    expect(store.get("m1")?.runner.answer?.text).toHaveLength(BOARD_LIMITS.runnerText);
  });

  it("still skips a mission that cannot be repaired, and keeps the others", () => {
    const dir = dirOf();
    writeFileSync(join(dir, "missions.json"), JSON.stringify({ version: 1, missions: [mission("m1"), { id: "m2" }, mission("m3")] }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(new MissionStore(dir).all().map((item) => item.id)).toEqual(["m1", "m3"]);
    warn.mockRestore();
  });

  it("refuses to save a mission the loader would not read back whole, and keeps the one it had", () => {
    const dir = dirOf();
    const store = new MissionStore(dir);
    const saved = store.insert(mission("m1"));
    expect(() => store.save({ ...saved, status: "weird" as never })).toThrow(BoardError);
    expect(store.get("m1")?.status).toBe("running");
    expect(JSON.parse(readFileSync(join(dir, "missions.json"), "utf8")).missions[0].status).toBe("running");
  });

  it("cuts on save what the loader would cut, so a restart finds the same mission", () => {
    const dir = dirOf();
    const store = new MissionStore(dir);
    const saved = store.insert(mission("m1", { runner: { answer: { botId: "dev", text: "r".repeat(BOARD_LIMITS.runnerText + 10) } } }));
    expect(saved.runner.answer?.text).toHaveLength(BOARD_LIMITS.runnerText);
    expect(new MissionStore(dir).get("m1")?.runner.answer?.text).toHaveLength(BOARD_LIMITS.runnerText);
  });

  it("refuses to grow the file past its size limit", () => {
    const dir = dirOf();
    const store = new MissionStore(dir, { maxBytes: 3_000 });
    store.insert(mission("m1", { goal: "g".repeat(1_500) }));
    expect(() => store.insert(mission("m2", { goal: "g".repeat(2_500) }))).toThrow(/cheio/);
    expect(store.all()).toHaveLength(1);
  });
});
