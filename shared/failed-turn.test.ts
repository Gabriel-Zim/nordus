import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FAILED_TURN_MAX_CHARS, failedTurnCause, failedTurnTool } from "./failed-turn";

describe("a failed turn's row", () => {
  it("reads back exactly what was written", () => {
    const limit = "Your Pro plan includes 2 cloud computers at once. Delete one to start another.";
    expect(failedTurnTool(limit)).toEqual({ name: `error: ${limit}`, ok: false });
    expect(failedTurnCause(failedTurnTool(limit).name)).toBe(limit);
    expect(failedTurnCause("Bash")).toBeNull();
    expect(failedTurnCause("notice: retrying")).toBeNull();
  });

  it("keeps a long cause's next action, whichever path wrote it", () => {
    const cause = `Automatic recovery unavailable: ${"the backup engine cannot run this thread here. ".repeat(5)}Original error: Your Pro plan includes 2 cloud computers at once. Delete one to start another.`;
    expect(cause.length).toBeGreaterThan(320);
    expect(failedTurnCause(failedTurnTool(cause).name)).toBe(cause);
  });

  it("bounds only a pathological message, and says it was cut", () => {
    const words = failedTurnCause(failedTurnTool("x".repeat(30_000)).name)!;
    expect(words).toHaveLength(FAILED_TURN_MAX_CHARS);
    expect(words.endsWith("…")).toBe(true);
  });

  it("carries the flags a client acts on, and only when set", () => {
    expect(failedTurnTool("Not logged in", { setup: true, terminal: true, claudeUpdate: true }))
      .toEqual({ name: "error: Not logged in", ok: false, setup: true, terminal: true, claudeUpdate: true, error: { class: "signed-out" } });
    expect(Object.keys(failedTurnTool("the engine said no", { setup: false }))).toEqual(["name", "ok"]);
  });

  it("names the kind of failure and how much of the turn already ran", () => {
    expect(failedTurnTool("turn interrupted — Nordus AI restarted", { done: 3 }).error).toEqual({ class: "interrupted", done: 3 });
    expect(failedTurnTool("turn interrupted — Nordus AI restarted", { done: 0 }).error).toEqual({ class: "interrupted" });
    expect(failedTurnTool("the engine said no", { done: 2 }).error).toEqual({ done: 2 });
    const resets = Date.now() + 3_600_000;
    expect(failedTurnTool("This Claude account has reached its 5-hour limit", { retryAt: resets }).error).toEqual({ class: "usage-limit", retryAt: resets });
  });

  it("is the only way the server writes one", () => {
    const dir = new URL("../server/", import.meta.url);
    const handWritten = readdirSync(dir, { recursive: true, encoding: "utf8" })
      .map((file) => file.replaceAll("\\", "/"))
      // server/headless is the nordus command line: it prints errors to a terminal and never writes a turn row
      .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts") && !file.includes("testing") && !file.replaceAll("\\", "/").startsWith("headless/"))
      .flatMap((file) => readFileSync(new URL(file, dir), "utf8").split("\n")
        .filter((line) => /["'`]error: /.test(line))
        .map((line) => `${file}: ${line.trim()}`));
    expect(handWritten).toEqual([]);
  });
});
