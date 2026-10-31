import { describe, expect, it } from "vitest";

import { mcpSelectionWidens } from "./bot-mcp-servers";

describe("mcpSelectionWidens", () => {
  it("lets a bot without a list name a server it could use before, but not an explicit one", () => {
    expect(mcpSelectionWidens(undefined, ["notes"])).toBe(false);
    expect(mcpSelectionWidens(undefined, ["notes", "trafego"], ["trafego"])).toBe(true);
    expect(mcpSelectionWidens(undefined, ["notes"], ["trafego"])).toBe(false);
  });

  it("keeps its other rules", () => {
    expect(mcpSelectionWidens(undefined, undefined, ["trafego"])).toBe(false);
    expect(mcpSelectionWidens(["notes"], undefined, ["trafego"])).toBe(true);
    expect(mcpSelectionWidens(["notes"], ["notes", "trafego"], ["trafego"])).toBe(true);
    expect(mcpSelectionWidens(["notes", "trafego"], ["notes"], ["trafego"])).toBe(false);
  });
});
