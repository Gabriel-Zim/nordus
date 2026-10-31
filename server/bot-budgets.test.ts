import { chmodSync, mkdtempSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { assertBotWithinBudget, botBudgetState, monthTotal, resetBotBudgetCacheForTests, setBotBudget, takeBotBudgetAlert } from "./bot-budgets.ts";

const now = new Date("2026-10-16T12:00:00Z");
let dir: string;

function ledger(rows: Array<{ botId: string; costUsd: number }>) {
  mkdirSync(join(dir, "usage"), { recursive: true });
  writeFileSync(join(dir, "usage", "2026-10.jsonl"), rows.map((row, i) => JSON.stringify({
    at: `2026-10-0${i + 1}T10:00:00Z`, botId: row.botId, botName: row.botId, threadId: "t", instanceId: "i", driverKind: "d", model: "m",
    input: 100, output: 10, costUsd: row.costUsd, trigger: { kind: "owner" },
  })).join("\n") + "\n");
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bot-budget-"));
  resetBotBudgetCacheForTests();
});

describe("per-bot monthly budget", () => {
  it("adds up the month per bot and for the workspace", () => {
    ledger([{ botId: "a", costUsd: 0.3 }, { botId: "a", costUsd: 0.2 }, { botId: "b", costUsd: 1 }]);
    expect(botBudgetState(dir, "a", now)).toMatchObject({ spentUsd: 0.5, runs: 2, monthlyUsd: null, percent: null, exceeded: false });
    expect(monthTotal(dir, now).spentUsd).toBeCloseTo(1.5);
  });

  it("warns once at 80% and stops the bot at its limit", () => {
    ledger([{ botId: "a", costUsd: 0.85 }]);
    setBotBudget(dir, "a", 1);
    const state = botBudgetState(dir, "a", now);
    expect(state).toMatchObject({ percent: 85, warn: true, exceeded: false });
    expect(takeBotBudgetAlert(dir, state)).toBe("warn");
    expect(takeBotBudgetAlert(dir, state)).toBeNull();
    expect(() => assertBotWithinBudget(dir, "a", now)).not.toThrow();
    setBotBudget(dir, "a", 0.5);
    expect(() => assertBotWithinBudget(dir, "a", now)).toThrow(/monthly limit/);
    setBotBudget(dir, "a", null);
    expect(() => assertBotWithinBudget(dir, "a", now)).not.toThrow();
  });

  it("saves bot-budgets.json whole, owner-only even over a looser file", () => {
    const path = join(dir, "usage", "bot-budgets.json");
    setBotBudget(dir, "a", 1);
    chmodSync(path, 0o644);
    const before = statSync(path).ino;
    setBotBudget(dir, "b", 2);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(path).ino).not.toBe(before);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ a: 1, b: 2 });
  });

  it("never saves over an unreadable bot-budgets.json, and says so in the log", () => {
    const path = join(dir, "usage", "bot-budgets.json");
    setBotBudget(dir, "a", 1);
    const torn = '{\n  "a": 1,\n  "b": 2';
    writeFileSync(path, torn);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(() => setBotBudget(dir, "c", 3)).toThrow(/não puderam ser lidos, então nada foi alterado/);
      expect(readFileSync(path, "utf8")).toBe(torn);
      expect(botBudgetState(dir, "a", now).monthlyUsd).toBeNull();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]![0])).toContain(path);
    } finally {
      warn.mockRestore();
    }
  });

  it("refuses every bot's turn while bot-budgets.json is unreadable, in Portuguese, and lets it run once fixed", () => {
    const path = join(dir, "usage", "bot-budgets.json");
    setBotBudget(dir, "a", 100);
    writeFileSync(path, '{\n  "a": 10');
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      for (const botId of ["a", "no-limit"]) {
        expect(() => assertBotWithinBudget(dir, botId, now)).toThrow(expect.objectContaining({
          status: 409, code: "bot_spend_cap", message: expect.stringMatching(/nenhum turno roda até o arquivo usage\/bot-budgets\.json ser consertado/),
        }));
      }
      writeFileSync(path, JSON.stringify({ a: 100 }));
      expect(() => assertBotWithinBudget(dir, "a", now)).not.toThrow();
    } finally {
      warn.mockRestore();
    }
  });
});
