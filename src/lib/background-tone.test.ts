import { describe, expect, it } from "vitest";
import { BACKGROUND_TONES, clampStrength, effectiveTone, isToneId } from "./background-tone";

describe("background tone", () => {
  it("offers the seven presets, the accent's own first", () => {
    expect(BACKGROUND_TONES.map((tone) => tone.id)).toEqual(["accent", "amber", "copper", "graphite", "midnight", "moss", "plain"]);
    expect(isToneId("moss")).toBe(true);
    expect(isToneId("red")).toBe(false);
  });

  it("keeps the strength between 0 and 100", () => {
    expect(clampStrength(140)).toBe(100);
    expect(clampStrength(-5)).toBe(0);
    expect(clampStrength("abc")).toBe(100);
  });

  it("follows the accent until the person chooses: no colour means graphite", () => {
    expect(effectiveTone(null, null)).toBe("amber");
    expect(effectiveTone(null, "mono")).toBe("graphite");
    expect(effectiveTone(null, "#ff6633")).toBe("amber");
    expect(effectiveTone(null, "#8b5cf6")).toBe("accent");
    expect(effectiveTone("copper", "mono")).toBe("copper");
  });
});
