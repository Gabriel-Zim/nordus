import { describe, expect, it } from "vitest";
import {
  addressLabel, endedSummary, goalCardLive, goalCardNote, goalOfInput, isBrowserGoalTool, lastActionPhrase, pickRun, stepPhrase, statusNote,
  type GoalLiveRun, type GoalStepKind,
} from "./browser-goal";

const run = (over: Partial<GoalLiveRun>): GoalLiveRun => ({
  id: "r", threadId: "t", botId: "b", botName: "Pepper", goal: "g", startedAt: 1_000, endedAt: null,
  status: "running", url: "", title: "", steps: [], frameAt: null, ...over,
});

describe("browser goal helpers", () => {
  it("recognizes the tool with or without a namespace", () => {
    expect(isBrowserGoalTool("agent_browser_goal")).toBe(true);
    expect(isBrowserGoalTool("mcp__browser__agent_browser_goal")).toBe(true);
    expect(isBrowserGoalTool("agent_browser_click")).toBe(false);
    expect(isBrowserGoalTool("use_tool", { tool_name: "browser__agent_browser_goal", tool_input: { goal: "x" } })).toBe(true);
    expect(isBrowserGoalTool("use_tool", '{"tool_name":"browser__agent_browser_click"}')).toBe(false);
  });

  it("reads the goal from an object or a JSON string", () => {
    expect(goalOfInput({ goal: "book" })).toBe("book");
    expect(goalOfInput('{"goal":"book","url":"https://a.b"}')).toBe("book");
    expect(goalOfInput("not json")).toBeNull();
    expect(goalOfInput(undefined)).toBeNull();
    expect(goalOfInput({ tool_name: "browser__agent_browser_goal", tool_input: '{"goal":"airbnb"}' }, "use_tool")).toBe("airbnb");
  });

  it("matches the latest run with the same goal, else the newest started after the message", () => {
    const runs = [run({ id: "a", goal: "x", startedAt: 100 }), run({ id: "b", goal: "y", startedAt: 5_000 }), run({ id: "c", goal: "x", startedAt: 9_000 })];
    expect(pickRun(runs, "x", 50)?.id).toBe("c");
    expect(pickRun(runs, "zzz", 6_000)?.id).toBe("c");
    expect(pickRun(runs, null, 20_000)).toBeNull();
  });

  it("has a phrase for every step kind", () => {
    const kinds: GoalStepKind[] = ["read", "click", "fill", "select", "scroll", "wait", "cookies"];
    for (const kind of kinds) {
      expect(stepPhrase(kind)).not.toMatch(/browserGoal/);
      expect(lastActionPhrase(run({ steps: [{ kind, label: "", url: "", title: "", at: 1 }] }))).not.toMatch(/browserGoal/);
    }
  });

  it("shows host and path without the scheme", () => {
    expect(addressLabel("https://www.airbnb.com.br/s/Chicago?x=1")).toBe("www.airbnb.com.br/s/Chicago?x=1");
    expect(addressLabel("https://example.com/")).toBe("example.com");
  });

  it("summarizes an ended run and notes non-done statuses", () => {
    const ended = run({ endedAt: 8_400, status: "done", steps: [{ kind: "click", label: "", url: "", title: "", at: 2 }] });
    expect(endedSummary(ended)).toContain("7.4");
    expect(statusNote("done")).toBeNull();
    expect(statusNote("blocked")).toBeTruthy();
  });
});

describe("goalCardLive", () => {
  it("keeps the newest run open while the bot's turn goes on, and only that one", () => {
    expect(goalCardLive({ running: false, turnBusy: true, newest: true })).toBe(true);
    expect(goalCardLive({ running: false, turnBusy: true, newest: false })).toBe(false);
    expect(goalCardLive({ running: false, turnBusy: false, newest: true })).toBe(false);
    expect(goalCardLive({ running: true, turnBusy: false, newest: false })).toBe(true);
  });
});

describe("goalCardNote", () => {
  it("keeps a stop note out of the card while the bot is still working on the turn", () => {
    expect(goalCardNote("blocked", { running: false, live: true })).toBeNull();
    expect(goalCardNote("blocked", { running: true, live: true })).toBeNull();
    expect(goalCardNote("blocked", { running: false, live: false })).toBeTruthy();
    expect(goalCardNote(null, { running: false, live: false })).toBeNull();
  });
});
