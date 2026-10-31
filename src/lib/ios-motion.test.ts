import { describe, expect, it } from "vitest";

import { rubberBand, settleEdgeSwipe } from "./ios-motion";

describe("rubberBand", () => {
  it("follows less the further it is pulled and never passes the dimension", () => {
    expect(rubberBand(0, 800)).toBe(0);
    expect(rubberBand(-20, 800)).toBe(0);
    const near = rubberBand(100, 800);
    const far = rubberBand(400, 800);
    expect(near).toBeLessThan(100);
    expect(far - near).toBeLessThan(300);
    expect(rubberBand(100_000, 800)).toBeLessThan(800);
  });

  it("reaches the refresh trigger with a pull of about 130 px on a phone", () => {
    expect(rubberBand(125, 812)).toBeLessThan(64);
    expect(rubberBand(140, 812)).toBeGreaterThan(64);
  });
});

describe("settleEdgeSwipe", () => {
  it("goes back past half the width", () => {
    expect(settleEdgeSwipe(200, 375, 0).back).toBe(true);
    expect(settleEdgeSwipe(150, 375, 0).back).toBe(false);
  });

  it("goes back on a flick even when short", () => {
    expect(settleEdgeSwipe(60, 375, 0.4).back).toBe(true);
  });

  it("stays when the finger was moving back to the edge", () => {
    expect(settleEdgeSwipe(250, 375, -0.5).back).toBe(false);
  });

  it("takes less time the less is left to travel", () => {
    expect(settleEdgeSwipe(340, 375, 0.1).ms).toBeLessThan(settleEdgeSwipe(200, 375, 0.1).ms);
    expect(settleEdgeSwipe(374, 375, 0).ms).toBeGreaterThanOrEqual(180);
    expect(settleEdgeSwipe(0, 375, 0).ms).toBeLessThanOrEqual(300);
  });
});
