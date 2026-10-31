import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");

describe("composer on a touch screen", () => {
  it("gives every composer button a 44px target", () => {
    const rule = /@media \(pointer: coarse\) \{\s*\[data-composer-row\] button \{[^}]*min-width: 44px;[^}]*min-height: 44px;[^}]*\}/.exec(css);
    expect(rule).not.toBeNull();
  });

  it("lets the layout shrink above the on-screen keyboard", () => {
    expect(html).toMatch(/<meta name="viewport"[^>]*interactive-widget=resizes-content/);
  });
});
