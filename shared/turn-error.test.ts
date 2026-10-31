import { describe, expect, it } from "vitest";
import { classifyTurnError, retryAtFromWords } from "./turn-error";

const NOW = new Date(2026, 9, 19, 1, 0, 0).getTime();

describe("classifyTurnError", () => {
  it.each([
    ["engine-unreachable", "connect ECONNREFUSED 127.0.0.1:8317"],
    ["engine-unreachable", "fetch failed"],
    ["signed-out", "Not logged in · Please run /login"],
    ["signed-out", "Cursor is logged out. Sign in to Cursor again in Settings, then retry."],
    ["signed-out", "Codex's ChatGPT sign-in has expired. Sign in again in Settings → Model providers → Codex."],
    ["usage-limit", "This Claude account has reached its weekly limit (Claude says: \"You've hit your weekly limit\"). For now, switch this bot to another engine or Claude account."],
    ["engine-down", "claude: API error (503): service temporarily unavailable"],
    ["engine-down", "API Error: 529 {\"type\":\"error\",\"error\":{\"type\":\"overloaded_error\"}}"],
    ["engine-down", "claude exited with code 1"],
    ["engine-down", "claude exited null before result"],
    ["disk-full", "ENOSPC: no space left on device, write"],
    ["interrupted", "turn interrupted — Nordus AI restarted"],
    ["interrupted", "no activity for 20 minutes — the turn was stopped"],
  ] as const)("reads %s from %j", (kind, cause) => {
    expect(classifyTurnError(cause, {}, NOW)?.class).toBe(kind);
  });

  it("a sign-in failure the driver flagged as setup reads as signed out", () => {
    expect(classifyTurnError("401 Unauthorized", { setup: true }, NOW)?.class).toBe("signed-out");
    expect(classifyTurnError("401 Unauthorized", {}, NOW)).toBeUndefined();
  });

  it("the bot's own monthly budget is not the engine's usage limit", () => {
    expect(classifyTurnError("this bot reached its monthly limit of $20", {}, NOW)).toBeUndefined();
  });

  it("does not read a number or a tool's words as the engine's failure", () => {
    expect(classifyTurnError("429 Too Many Requests", {}, NOW)).toBeUndefined();
    expect(classifyTurnError("Processed 503 files and 507 folders", {}, NOW)).toBeUndefined();
    expect(classifyTurnError("The Google Drive tool said: token expired", {}, NOW)).toBeUndefined();
    expect(classifyTurnError("HTTP 507 Insufficient Storage", {}, NOW)?.class).toBe("disk-full");
  });

  it("leaves a cause it does not know unclassified", () => {
    expect(classifyTurnError("Your Pro plan includes 2 cloud computers at once. Delete one to start another.", {}, NOW)).toBeUndefined();
  });

  it("keeps the engine's structured reset time over the words, and drops one already past", () => {
    const resets = NOW + 2 * 3_600_000;
    expect(classifyTurnError("You've hit your session limit", { retryAt: resets }, NOW)).toEqual({ class: "usage-limit", retryAt: resets });
    expect(classifyTurnError("You've hit your session limit", { retryAt: NOW - 1 }, NOW)).toEqual({ class: "usage-limit" });
  });
});

describe("retryAtFromWords", () => {
  it("reads the reset time engines write", () => {
    expect(retryAtFromWords("Claude AI usage limit reached|1792386000", NOW)).toBe(1_792_386_000_000);
    expect(retryAtFromWords("rate limited, retry after 30", NOW)).toBe(NOW + 30_000);
    expect(retryAtFromWords("You've hit your usage limit. Try again in 2 hours 5 minutes.", NOW)).toBe(NOW + 2 * 3_600_000 + 5 * 60_000);
    expect(retryAtFromWords("quota exceeded until 2026-10-19T06:00:00Z", NOW)).toBe(Date.parse("2026-10-19T06:00:00Z"));
  });

  it("reads a clock time as its next occurrence on this machine", () => {
    expect(retryAtFromWords("Codex usage limit reached. Try again at 5:23 PM.", NOW)).toBe(new Date(2026, 9, 19, 17, 23).getTime());
    expect(retryAtFromWords("You've hit your 5-hour limit · resets 12am", NOW)).toBe(new Date(2026, 9, 20, 0, 0).getTime());
  });

  it("is undefined when the engine gave no time", () => {
    expect(retryAtFromWords("usage limit reached", NOW)).toBeUndefined();
  });
});
