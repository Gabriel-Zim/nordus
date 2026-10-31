import { describe, expect, it } from "vitest";

import { installLiquidGlass, lensFilterMarkup, lensId, lensMapSvg, lensSize, lensSupported, LENS_RIM } from "./liquid-glass";

describe("lensSize", () => {
  it("snaps to a 4-point grid so near sizes share a filter", () => {
    expect(lensSize(118.6, 43.2)).toEqual({ width: 120, height: 44 });
    expect(lensSize(1, 1)).toEqual({ width: 8, height: 8 });
  });
});

describe("lensMapSvg", () => {
  it("bends the same few points of rim whatever the size", () => {
    const wide = lensMapSvg(700, 140);
    const pct = Math.round((LENS_RIM / 700) * 10000) / 100;
    expect(wide).toContain(`offset="${pct}%" stop-color="rgb(128,0,0)"`);
    expect(wide).toContain(`offset="10%" stop-color="rgb(0,128,0)"`);
    expect(wide).toContain('offset="0%" stop-color="rgb(0,0,0)"');
    expect(wide).toContain('offset="100%" stop-color="rgb(0,255,0)"');
  });

  it("never lets the rim pass the middle on a tiny piece", () => {
    expect(lensMapSvg(10, 10)).toContain('offset="50%" stop-color="rgb(128,0,0)"');
  });
});

describe("lensFilterMarkup", () => {
  it("is a displacement filter in the piece's own points, fed by its map", () => {
    const markup = lensFilterMarkup(120, 44, 20);
    expect(markup).toContain(`id="${lensId(120, 44)}"`);
    expect(markup).toContain('primitiveUnits="userSpaceOnUse"');
    expect(markup).toContain('width="120" height="44"');
    expect(markup).toContain('scale="20"');
    expect(markup).toContain("data:image/svg+xml,");
  });
});

describe("lensSupported", () => {
  it("asks the engine, not the user agent", () => {
    expect(lensSupported({ supports: (_p, v) => v.startsWith("url(") })).toBe(true);
    expect(lensSupported({ supports: () => false })).toBe(false);
    expect(lensSupported(undefined)).toBe(false);
    expect(lensSupported({ supports: () => { throw new Error("old"); } })).toBe(false);
  });
});

describe("installLiquidGlass", () => {
  it("installs nothing: no observers, no markup, no mark on <html>", () => {
    const touched: string[] = [];
    const doc = {
      documentElement: { dataset: { glassLens: "" } as Record<string, string | undefined> },
      body: { prepend: () => touched.push("prepend") },
      createElementNS: () => { touched.push("create"); return {}; },
      defaultView: null,
    } as unknown as Document;
    const off = installLiquidGlass(doc);
    expect(touched).toEqual([]);
    expect("glassLens" in doc.documentElement.dataset && doc.documentElement.dataset.glassLens !== undefined).toBe(false);
    expect(() => off()).not.toThrow();
  });
});
