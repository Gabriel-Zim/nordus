import { describe, expect, it } from "vitest";

import { browserInUse, runningBrowserStep } from "./browser-auto-open";

describe("runningBrowserStep", () => {
  it("finds the newest browser tool still running", () => {
    expect(runningBrowserStep([
      { id: "a", tool: { name: "agent_browser_click" } },
      { id: "b", tool: { name: "shell", ok: undefined } },
    ])).toBe("a");
  });
  it("ignores finished and unrelated tools", () => {
    expect(runningBrowserStep([
      { id: "a", tool: { name: "agent_browser_click", ok: true } },
      { id: "b", tool: { name: "shell" } },
      { id: "c" },
    ])).toBeNull();
  });
});

describe("browserInUse", () => {
  const step = (id: string, name: string) => ({ id, role: "bot", tool: { name } });
  it("is the newest browser step since the person last wrote, simple or goal", () => {
    expect(browserInUse([{ id: "u", role: "user" }, step("a", "agent_browser_open"), step("b", "Read")])).toBe("a");
    expect(browserInUse([step("g", "agent_browser_goal")])).toBe("g");
  });
  it("is nothing before the first browser step of a turn, and after the browser was closed", () => {
    expect(browserInUse([step("a", "agent_browser_open"), { id: "u", role: "user" }])).toBeNull();
    expect(browserInUse([step("a", "agent_browser_open"), step("c", "agent_browser_close")])).toBeNull();
    expect(browserInUse([])).toBeNull();
  });
});
