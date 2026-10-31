// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { applyAccent, setAccentBase } from "./accent-color";
import { applyBrand, DEFAULT_BRAND } from "./brand";

const accent = () => document.documentElement.style.getPropertyValue("--color-accent");

afterEach(() => {
  applyAccent(null);
  setAccentBase({});
});

describe("the person's accent and the workspace brand", () => {
  it("keeps the person's colour when the brand loads after it, as it does on every page load", () => {
    applyAccent("#3b82f6");
    applyBrand({ brand: DEFAULT_BRAND, source: "default", file: "" });
    expect(accent()).toBe("#3b82f6");
    expect(document.documentElement.style.getPropertyValue("--color-accent-ink")).toBe("#ffffff");
  });

  it("wears the brand's colour while the person has not picked one, and again after they clear it", () => {
    applyBrand({ brand: { name: "Reliable Platform", accent: "#1D4ED8" }, source: "file", file: "" });
    expect(accent()).toBe("#1D4ED8");
    applyAccent("#ec4899");
    expect(accent()).toBe("#ec4899");
    applyAccent(null);
    expect(accent()).toBe("#1D4ED8");
  });
});
