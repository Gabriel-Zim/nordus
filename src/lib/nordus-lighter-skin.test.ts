import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "styles.css"), "utf8");

const rules = [...css.matchAll(/(html\[data-skin="nordus"\][^{}]*)\{([^{}]*)\}/g)].map(([, selector, body]) => ({
  selector: selector!.trim(),
  body: body!.trim(),
}));

describe("the lighter Nordus skin", () => {
  it("leaves a pinned circle out of every rule that styles a bot row", () => {
    const rows = rules.filter(({ selector }) => selector.includes("[data-sidebar-bot-row]"));
    expect(rows.length).toBeGreaterThan(0);
    const bare = rows.filter(({ selector }) => /\[data-sidebar-bot-row\](?!:not\(\[data-sidebar-pinned-circle\]\))/.test(selector));
    expect(bare.map(({ selector }) => selector)).toEqual([]);
  });

  it("gives toasts, the tag picker and sheets back the outline its lowered rim took", () => {
    const restored = rules.filter(({ body }) => body.includes("--lg-rim: rgb(255 255 255 / 0.08);"));
    for (const surface of ["[data-notice-toast]", "[data-tag-picker]", ".glass-surface"]) {
      expect(restored.some(({ selector }) => selector.includes(surface)), surface).toBe(true);
    }
  });
});
