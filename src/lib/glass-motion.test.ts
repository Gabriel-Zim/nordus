import { describe, expect, it } from "vitest";

import { flipFrom, liftScale, MORPH_EASE, roundRadius } from "./glass-motion";
import { lensCopyTransform, segmentAt } from "../components/GlassSegmented";

describe("liftScale", () => {
  it("swells a round button to 1.28x and a wide pill only a few points", () => {
    expect(liftScale(44, 44)).toBe(1.28);
    expect(liftScale(120, 44)).toBeCloseTo(1.133, 3);
    expect(liftScale(400, 44)).toBe(1.04);
  });
});

describe("flipFrom", () => {
  it("lays the menu over the button it grows from", () => {
    const button = { left: 300, top: 10, width: 44, height: 44 };
    const menu = { left: 120, top: 60, width: 220, height: 176 };
    expect(flipFrom(button, menu)).toEqual({ x: 180, y: -50, sx: 0.2, sy: 0.25 });
  });

  it("does not divide by zero on an unmeasured menu", () => {
    expect(flipFrom({ left: 0, top: 0, width: 10, height: 10 }, { left: 0, top: 0, width: 0, height: 0 })).toEqual({ x: 0, y: 0, sx: 1, sy: 1 });
  });
});

describe("roundRadius", () => {
  it("keeps the shrunken menu a circle the size of the button", () => {
    expect(roundRadius({ left: 0, top: 0, width: 44, height: 44 }, { sx: 0.2, sy: 0.25 })).toBe("110px / 88px");
  });
});

describe("the morph curve", () => {
  it("goes 5% past its size near the end, then rests", () => {
    expect(MORPH_EASE).toContain("1.05 74%");
    expect(MORPH_EASE.endsWith(", 1)")).toBe(true);
  });
});

describe("segmentAt", () => {
  it("picks the option whose middle is nearest", () => {
    const edges = [{ left: 0, width: 80 }, { left: 82, width: 90 }, { left: 174, width: 70 }];
    expect(segmentAt(10, edges)).toBe(0);
    expect(segmentAt(130, edges)).toBe(1);
    expect(segmentAt(400, edges)).toBe(2);
    expect(segmentAt(10, [])).toBe(-1);
  });
});

describe("lensCopyTransform", () => {
  it("magnifies the bar 1.15x about the lens centre, net of the lens's own lift", () => {
    const t = lensCopyTransform({ left: 100, top: 3, width: 80, height: 32 }, { x: 1.1, y: 1.3 });
    expect(t.left).toBe(-100);
    expect(t.top).toBe(-3);
    expect(t.origin).toBe("140px 19px");
    expect(t.transform).toBe("scale(1.045, 0.885)");
  });
});
