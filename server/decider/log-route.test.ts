import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { recentDeciderLog } from "./log.ts";

const dir = mkdtempSync(join(tmpdir(), "declog-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("decision log for Registros", () => {
  it("reads the newest first across months and skips broken lines", async () => {
    mkdirSync(join(dir, "decider-log"));
    const row = (at: string, choice: string) => JSON.stringify({ at, seam: "roomRouting", provider: "jev", ok: true, choice, pTop: 0.9, margin: 0.5, latencyMs: 200, stateHash: "x" });
    writeFileSync(join(dir, "decider-log", "2026-09.ndjson"), row("2026-09-30T10:00:00Z", "a") + "\n");
    writeFileSync(join(dir, "decider-log", "2026-10.ndjson"), row("2026-10-16T10:00:00Z", "b") + "\n{broken\n" + row("2026-10-16T11:00:00Z", "c") + "\n");
    const rows = await recentDeciderLog(dir);
    expect(rows.map((r) => r.choice)).toEqual(["c", "b", "a"]);
    expect((await recentDeciderLog(dir, 1)).map((r) => r.choice)).toEqual(["c"]);
  });

  it("an empty data folder is an empty log", async () => {
    expect(await recentDeciderLog(join(dir, "nothing"))).toEqual([]);
  });
});
