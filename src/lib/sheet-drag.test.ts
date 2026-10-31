import { describe, expect, it } from "vitest";

import { settleSheet } from "./sheet-drag";

describe("settleSheet", () => {
  it("closes past a third of the height", () => {
    expect(settleSheet(300, 800, 0).close).toBe(true);
    expect(settleSheet(200, 800, 0).close).toBe(false);
  });

  it("closes on a downward flick even when short", () => {
    expect(settleSheet(80, 800, 0.6).close).toBe(true);
  });

  it("springs back when the finger was moving up", () => {
    expect(settleSheet(400, 800, -0.5).close).toBe(false);
  });

  it("takes at most the measured 480 ms and less the less is left", () => {
    expect(settleSheet(0, 800, 0).ms).toBeLessThanOrEqual(480);
    expect(settleSheet(700, 800, 0.1).ms).toBeLessThan(settleSheet(300, 800, 0.1).ms);
    expect(settleSheet(799, 800, 0).ms).toBeGreaterThanOrEqual(200);
  });
});
