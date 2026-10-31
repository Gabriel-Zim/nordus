import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "styles.css"), "utf8");

function tokens(id: string): Record<string, string> {
  const body = css.match(new RegExp(`\\[data-skin="${id}"\\]\\s*\\{([^}]*)\\}`))?.[1] ?? "";
  return Object.fromEntries([...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(([, name, value]) => [name, value!.trim()]));
}

function rgb(hex: string): [number, number, number] {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) throw new Error(`not a 6-digit hex colour: ${hex}`);
  const value = parseInt(match[1]!, 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((channel) => {
    const v = channel / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

const SURFACES = ["app", "panel", "raised", "card", "inset", "menu"];

describe.each(["nordus", "nordus-light"])("%s skin", (id) => {
  const skin = tokens(id);

  it("keeps secondary text and links at AA (4.5:1) on every surface", () => {
    for (const surface of SURFACES) {
      expect(contrast(skin["--color-ink-secondary"]!, skin[`--color-${surface}`]!), `secondary on ${surface}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(skin["--color-accent-text"]!, skin[`--color-${surface}`]!), `accent text on ${surface}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("draws the focus ring at 3:1 or more on every surface", () => {
    for (const surface of SURFACES) {
      expect(contrast(skin["--color-focus"]!, skin[`--color-${surface}`]!), `focus on ${surface}`).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("nordus focus colour", () => {
  it("is the brand orange family, not the default blue", () => {
    expect(tokens("nordus")["--color-focus"]).toBe("#ff8a5f");
  });
});
