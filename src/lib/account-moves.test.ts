import { describe, expect, it } from "vitest";
import type { PlanProvider } from "@/components/PlanUsage";
import type { InstanceInfo } from "@/state/store";
import {
  alertFor, brasiliaStamp, buildAccountCards, distanceLabel, effortChoices, filterRobots, groupBySection, instanceLabel,
  planMoves, resetLabel, toggleAll, type RobotView,
} from "./account-moves";

const instance = (instanceId: string, driverKind: string, extra: Partial<InstanceInfo> = {}): InstanceInfo => ({
  instanceId, driverKind, displayName: instanceId, snapshot: { state: "available" },
  models: { default: "m-default", options: [{ id: "m-default", label: "m" }] }, ...extra,
});
const window = (used: number | null, resetsAt: string | null = "2026-10-22T00:59:00Z") => ({
  available: used != null, remainingPercent: used == null ? null : 100 - used, usedPercent: used, resetsAt,
});
const row = (id: string, weekly: number | null, five: number | null, plan: string | null = null, ok = true): PlanProvider => ({
  id, name: id, driver: "claude", plan, ok, error: ok ? null : "expired", fiveHour: window(five), weekly: window(weekly), extra: [],
});
const bot = (id: string, instanceId: string, extra: Partial<RobotView> = {}): RobotView => ({
  id, name: `Robô ${id}`, modelSelection: { instanceId, model: "m" }, ...extra,
});

describe("alerts", () => {
  it("warns at 85 and at 100 percent", () => {
    expect(alertFor(84.9)).toBeNull();
    expect(alertFor(85)).toBe("nearEnd");
    expect(alertFor(99)).toBe("nearEnd");
    expect(alertFor(100)).toBe("exhausted");
    expect(alertFor(null)).toBeNull();
  });
});

describe("Brasilia clock", () => {
  it("writes the reset on the Sao Paulo clock with the distance", () => {
    const now = Date.parse("2026-10-22T17:00:00Z");
    expect(brasiliaStamp(Date.parse("2026-10-23T00:59:00Z"))).toBe("22/10 21:59");
    expect(resetLabel("2026-10-23T00:59:00Z", now)).toBe("22/10 21:59 (em 7h)");
    expect(resetLabel("2026-10-29T00:59:00Z", now)).toBe("28/10 21:59 (em 6d 7h)");
    expect(resetLabel("2026-10-22T17:20:00Z", now)).toBe("22/10 14:20 (em 20 min)");
    expect(resetLabel(null, now)).toBeNull();
    expect(distanceLabel(30_000)).toBe("menos de 1 min");
  });

  it("never prints hour 24 at midnight", () => {
    expect(brasiliaStamp(Date.parse("2026-10-22T03:05:00Z"))).toBe("22/10 00:05");
  });
});

describe("account cards", () => {
  const instances = [
    instance("grok", "grokAgent"), instance("claude", "claudeAgent"), instance("claude-78baf5fa", "claudeAgent", { displayName: "Pessoal" }),
    instance("codex", "codex"), instance("chatgpt", "codex"), instance("claudeApi", "claudeAgent", { snapshot: { state: "available" } }),
    instance("opencodeGo", "opencodeGo"), instance("antigravity", "antigravityAgent", { snapshot: { state: "unavailable" } }),
    instance("cursor", "cursorAgent", { snapshot: { state: "unavailable" } }), instance("openai", "openai-compat"),
    instance("kimi", "kimiAgent"),
  ];
  const providers = [
    row("grok", 40, 10, "SuperGrok Heavy"), row("claude", 86, 30, "Max"), row("claude-78baf5fa", 100, 100),
    row("codex", 20, 5, "plus"), row("chatgpt", 20, 5, "plus"), row("claudeApi", 0, 0),
  ];

  it("lists configured accounts in the screen's order, with Codex and ChatGPT as one card and no API-key account", () => {
    const cards = buildAccountCards(instances, providers, [bot("a", "chatgpt"), bot("b", "codex"), bot("c", "claude"), bot("d", "cursor")]);
    expect(cards.map((card) => [card.key, card.label])).toEqual([
      ["grok", "grok"], ["claude", "claude"], ["claude-78baf5fa", "Pessoal"],
      ["codex", "Codex / ChatGPT"], ["opencodeGo", "OpenCode Go"], ["cursor", "cursor"], ["kimi", "kimi"],
    ]);
    const codex = cards.find((card) => card.key === "codex")!;
    expect(codex.instanceIds).toEqual(["codex", "chatgpt"]);
    expect(codex.botCount).toBe(2);
    expect(codex.plan).toBe("plus");
    expect(codex.weekly.used).toBe(20);
  });

  it("marks alerts from the fullest window and leaves accounts with no reading as such", () => {
    const cards = buildAccountCards(instances, providers, []);
    const by = (key: string) => cards.find((card) => card.key === key)!;
    expect(by("grok").alert).toBeNull();
    expect(by("claude").alert).toBe("nearEnd");
    expect(by("claude-78baf5fa").alert).toBe("exhausted");
    expect(by("opencodeGo").reading).toBe("none");
    expect(by("opencodeGo").weekly.used).toBeNull();
    expect(cards.map((card) => card.key)).not.toContain("antigravity");
    const failed = buildAccountCards(instances, [row("grok", null, null, null, false)], []).find((card) => card.key === "grok")!;
    expect(failed.reading).toBe("error");
    expect(failed.error).toBe("expired");
  });

  it("names an instance for the screen", () => {
    expect(instanceLabel(instances, "claude")).toBe("claude");
    expect(instanceLabel(instances, "claude-78baf5fa")).toBe("Pessoal");
    expect(instanceLabel(instances, "unknown")).toBe("unknown");
  });
});

describe("robot list", () => {
  const robots = [
    bot("1", "claude", { name: "Ana", section: "Vendas" }), bot("2", "codex", { name: "Beto", section: "Vendas" }),
    bot("3", "chatgpt", { name: "Bia" }), bot("4", "claude", { name: "Caio", section: "Time" }),
  ];

  it("filters by account (Codex and ChatGPT together) and by name", () => {
    expect(filterRobots(robots, "codex", "").map((r) => r.id)).toEqual(["2", "3"]);
    expect(filterRobots(robots, "claude", "ca").map((r) => r.id)).toEqual(["4"]);
    expect(filterRobots(robots, null, "B").map((r) => r.id)).toEqual(["2", "3"]);
  });

  it("groups by section in the sidebar order and puts the unsectioned last", () => {
    const groups = groupBySection(robots, ["Time", "Vendas"]);
    expect(groups.map((group) => [group.section, group.bots.map((r) => r.id)])).toEqual([["Time", ["4"]], ["Vendas", ["1", "2"]], [null, ["3"]]]);
  });

  it("selects every robot in the filter, then clears just them", () => {
    const first = toggleAll(new Set(["1"]), ["2", "3"]);
    expect([...first].sort()).toEqual(["1", "2", "3"]);
    expect([...toggleAll(first, ["2", "3"])]).toEqual(["1"]);
    expect([...toggleAll(new Set(), [])]).toEqual([]);
  });
});

describe("planned destination", () => {
  const codex = instance("codex", "codex", {
    models: { default: "gpt-6.1-sol", options: [{ id: "gpt-6.1-sol", label: "Sol" }, { id: "gpt-6.1-terra", label: "Terra" }] },
    capabilities: { effortLevels: ["low", "medium", "high", "xhigh", "max"] },
  });
  const claudeBot: RobotView = { id: "a", name: "Ana", modelSelection: { instanceId: "claude", model: "claude-opus-5-5", effort: "max" } };

  it("applies the rule by default and the person's choice when given", () => {
    expect(planMoves([claudeBot], codex, { model: "", effort: "" })[0]!.to).toEqual({ instanceId: "codex", model: "gpt-6.1-sol", effort: "high" });
    expect(planMoves([claudeBot], codex, { model: "gpt-6.1-terra", effort: "low" })[0]!.to).toEqual({ instanceId: "codex", model: "gpt-6.1-terra", effort: "low" });
    expect(planMoves([claudeBot], codex, { model: "", effort: "none" })[0]!.to).toEqual({ instanceId: "codex", model: "gpt-6.1-sol" });
  });

  it("falls back to the destination's own default when the rule's model is not in its catalog", () => {
    const odd = instance("grok", "grokAgent", { models: { default: "grok-x", options: [{ id: "grok-x", label: "x" }] }, capabilities: { effortLevels: ["low", "medium", "high"] } });
    const plan = planMoves([claudeBot], odd, { model: "", effort: "" })[0]!;
    expect(plan.to).toEqual({ instanceId: "grok", model: "grok-x", effort: "high" });
    expect(plan.fellBack).toBe(true);
    expect(plan.from).toEqual(claudeBot.modelSelection);
  });

  it("offers only the efforts the family accepts and the engine declares", () => {
    expect(effortChoices(codex)).toEqual(["low", "medium", "high", "xhigh"]);
    expect(effortChoices(instance("cursor", "cursorAgent"))).toEqual([]);
  });
});
