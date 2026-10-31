import { describe, expect, it } from "vitest";
import { ACCENT_PRESETS, MONO_ACCENT, deriveAccentTokens, normalizeAccent } from "./accent-color";
import { contrastRatio, mixSrgb } from "./color-contrast";

describe("accent colour", () => {
  it("accepts only six-digit hex", () => {
    expect(normalizeAccent(" #FF6633 ")).toBe("#ff6633");
    expect(normalizeAccent("red")).toBeNull();
    expect(normalizeAccent("#fff")).toBeNull();
  });

  it.each([...ACCENT_PRESETS.map((preset) => preset.hex), "#123456", "#ffffff", "#000000", "#00ff00"])("keeps %s readable on dark and light surfaces", (accent) => {
    for (const app of ["#080808", "#ffffff"]) {
      const tokens = deriveAccentTokens(accent, app);
      expect(contrastRatio(tokens["--color-accent-text"], app)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(tokens["--color-bubble-user-ink"], tokens["--color-bubble-user"])).toBeGreaterThanOrEqual(7);
      expect(contrastRatio(tokens["--color-accent-ink"], accent)).toBeGreaterThanOrEqual(2.8);
    }
  });

  it("keeps the orange bubble the brand's warm tone", () => {
    const bubble = deriveAccentTokens("#ff6633", "#0a0a0a")["--color-bubble-user"];
    const target = [0x3d, 0x2d, 0x23];
    [1, 3, 5].forEach((at, i) => expect(Math.abs(parseInt(bubble.slice(at, at + 2), 16) - target[i]!)).toBeLessThanOrEqual(3));
  });

  it("has a no-colour mode that stays readable on both surfaces", () => {
    expect(normalizeAccent(MONO_ACCENT)).toBe("mono");
    for (const app of ["#0a0a0a", "#ffffff"]) {
      const tokens = deriveAccentTokens(MONO_ACCENT, app);
      expect(contrastRatio(tokens["--color-accent-text"], app)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(tokens["--color-accent-ink"], tokens["--color-accent"])).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(tokens["--color-bubble-user-ink"], tokens["--color-bubble-user"])).toBeGreaterThanOrEqual(7);
    }
    expect(deriveAccentTokens(MONO_ACCENT, "#0a0a0a")["--color-bubble-user"]).toBe("#3d2d23");
  });

  it("keeps the tag chip's ink readable on its own 14% fill", () => {
    for (const accent of ACCENT_PRESETS.map((preset) => preset.hex)) {
      const tokens = deriveAccentTokens(accent, "#0a0a0a");
      const fill = mixSrgb(accent, "#0a0a0a", 0.14);
      expect(contrastRatio(tokens["--color-accent-chip-ink"], fill)).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrastRatio("#e6e6e6", mixSrgb("#ffffff", "#0a0a0a", 0.12))).toBeGreaterThanOrEqual(4.5);
  });
});
