import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { SKINS, SKIN_IDS, DEFAULT_SKIN, PRIOR_INSTALL_SKIN } from "./skins";

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../styles.css"),
  "utf8",
);

const blocks = new Set(
  [...css.matchAll(/\[data-skin="([a-z-]+)"\]/g)].map(([, id]) => id),
);

describe("skins", () => {
  it("gives every registered skin a stylesheet block", () => {
    for (const id of SKIN_IDS) expect(blocks).toContain(id);
  });

  it("registers every stylesheet block", () => {
    for (const id of blocks) expect(SKIN_IDS).toContain(id as (typeof SKIN_IDS)[number]);
  });

  it("defines the same tokens in every skin", () => {
    const tokensOf = (id: string) => {
      const body = css.match(new RegExp(`\\[data-skin="${id}"\\]\\s*\\{([^}]*)\\}`))?.[1] ?? "";
      return new Set([...body.matchAll(/(--[\w-]+)\s*:/g)].map(([, name]) => name));
    };
    const reference = tokensOf(PRIOR_INSTALL_SKIN);
    expect(reference.size).toBeGreaterThan(15);
    expect(reference).toContain("--color-composer-ring");
    for (const id of SKIN_IDS) {
      expect([...reference].filter((t) => !tokensOf(id).has(t))).toEqual([]);
    }
  });

  it("selects a code-only light or dark palette in every nearest skin", () => {
    for (const id of SKIN_IDS) {
      const body = css.match(new RegExp(`\\[data-skin="${id}"\\]\\s*\\{([^}]*)\\}`))?.[1] ?? "";
      const scheme = ["atelier", "lagoon", "linen", "daylight", "meadow", "nordus-light", "pop"].includes(id) ? "light" : "dark";
      expect(body).toContain(`--code-color-scheme: ${scheme};`);
    }
    expect(css).toMatch(/\.chat-md \.shiki\s*\{\s*color-scheme:\s*var\(--code-color-scheme\);\s*\}/);
  });

  it("puts Nordus first and keeps Meadow and the original eight in their order", () => {
    expect(SKIN_IDS).toContain("meadow");
    expect(SKIN_IDS[0]).toBe("nordus");
    expect(SKIN_IDS.slice(1, 9)).toEqual([
      "midnight", "atelier", "foundry", "lagoon", "graphite", "linen", "dusk", "daylight",
    ]);
    expect(DEFAULT_SKIN).toBe("nordus");
    expect(PRIOR_INSTALL_SKIN).toBe("nordus");
  });

  it("gives Meadow's dark bubble its own inverted context", () => {
    expect(css).toMatch(/@scope \(\[data-skin="meadow"\]\) to \(\[data-skin\]\)\s*\{\s*\.bg-bubble-user\s*\{/);
  });

  it("adds Pop after Meadow and Nordus claro with its own inverted bubble and sticker scope", () => {
    expect(SKIN_IDS.slice(1, 10)).toEqual([
      "midnight", "atelier", "foundry", "lagoon", "graphite", "linen", "dusk", "daylight", "meadow",
    ]);
    expect(SKIN_IDS.slice(10, 12)).toEqual(["nordus-light", "pop"]);
    expect(css).toMatch(/@scope \(\[data-skin="pop"\]\) to \(\[data-skin\]\)\s*\{\s*\.bg-bubble-user\s*\{/);
    expect(css).toMatch(/@scope \(\[data-skin="pop"\]:not\(\[data-skin-preview\]\)\) to \(\[data-skin\]\)/);
  });

  it("adds Halloween last, dark, with its atmosphere kept off the picker miniature", () => {
    expect(SKIN_IDS.at(-1)).toBe("halloween");
    expect(SKINS.find((s) => s.id === "halloween")?.name).toBe("Halloween");
    expect(css).toMatch(/@scope \(\[data-skin="halloween"\]:not\(\[data-skin-preview\]\)\) to \(\[data-skin\]\)\s*\{\s*main\.bg-app\s*\{/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\[data-skin="halloween"\] main\.bg-app::before/);
  });

  it("describes each skin exactly once", () => {
    expect(SKINS.map((s) => s.id).sort()).toEqual([...SKIN_IDS].sort());
    for (const skin of SKINS) {
      expect(skin.name.length).toBeGreaterThan(0);
      expect(skin.tagline.length).toBeGreaterThan(0);
    }
  });
});
