import { describe, expect, it } from "vitest";
import { planNearLimit, type PlanProvider } from "./PlanUsage";
import { paysPerUse } from "@/lib/usage";

const provider = (five: number | null, week: number | null): PlanProvider => ({
  id: "claude", name: "Claude", driver: "claude", plan: null, ok: true, error: null,
  fiveHour: { available: five !== null, usedPercent: five, remainingPercent: five === null ? null : 100 - five, resetsAt: "2026-10-16T20:00:00.000Z" },
  weekly: { available: week !== null, usedPercent: week, remainingPercent: week === null ? null : 100 - week, resetsAt: null },
  extra: [],
});

describe("planNearLimit", () => {
  it("stays quiet below the warning line", () => {
    expect(planNearLimit(provider(40, 79))).toBeNull();
  });
  it("names the busiest window at or past 80%", () => {
    expect(planNearLimit(provider(82, 91))).toMatchObject({ used: 91, resetsAt: null });
    expect(planNearLimit(provider(85, 20))).toMatchObject({ used: 85, resetsAt: "2026-10-16T20:00:00.000Z" });
  });
});

describe("paysPerUse", () => {
  it("shows dollars only for API keys", () => {
    expect(paysPerUse({ access: "api" })).toBe(true);
    expect(paysPerUse({ access: "subscription", snapshot: { billing: "metered" } })).toBe(true);
    expect(paysPerUse({ access: "subscription", snapshot: { billing: "subscription" } })).toBe(false);
    expect(paysPerUse(undefined)).toBe(false);
  });
});
