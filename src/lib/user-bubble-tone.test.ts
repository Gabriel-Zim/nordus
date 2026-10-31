import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { contrastRatio, relativeLuminance, toOklch } from "./color-contrast";
import { CRITTER_COLORS, CRITTER_COLOR_NAMES } from "./mascot";
import { SKIN_IDS } from "./skins";
import {
  BUBBLE_TEXT_MIN,
  mentionChipBackground,
  quoteSurface,
  ROOM_OWN_BUBBLE_COLOR,
  roomOwnBubbleStyle,
  selectionBackground,
  userBubbleStyle,
  userBubbleTone,
} from "./user-bubble-tone";

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../styles.css"), "utf8");

function declarations(body: string): Record<string, string> {
  return Object.fromEntries([...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]));
}

const theme = declarations(css.match(/@theme\s*\{([^}]*)\}/)?.[1] ?? "");
const skin = (id: string) => ({
  ...theme,
  ...declarations(css.match(new RegExp(`\\[data-skin="${id}"\\]\\s*\\{([^}]*)\\}`))?.[1] ?? ""),
});

function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
}

describe("user bubble tone", () => {
  it.each(CRITTER_COLOR_NAMES)("fills %s with a gradient that stays on the bot's hue", (color) => {
    const tone = userBubbleTone(color);
    expect(tone.ink).toBe(color === "yellow" ? "#101410" : "#ffffff");
    expect(tone.gradient).toBe(`linear-gradient(to bottom left, ${tone.background}, ${tone.deep})`);
    expect(tone.deep).not.toBe(tone.background);
    expect(relativeLuminance(tone.deep)).toBeLessThan(relativeLuminance(tone.background));
    expect(hueDistance(toOklch(tone.background).h, toOklch(CRITTER_COLORS[color]).h)).toBeLessThanOrEqual(8);
    expect(hueDistance(toOklch(tone.deep).h, toOklch(CRITTER_COLORS[color]).h)).toBeLessThanOrEqual(20);
    if (tone.ink === "#ffffff" && contrastRatio("#ffffff", CRITTER_COLORS[color]) >= BUBBLE_TEXT_MIN) {
      expect(tone.background).toBe(CRITTER_COLORS[color]);
    }
  });

  it("keeps yellow bright with dark text instead of darkening it to olive", () => {
    const tone = userBubbleTone("yellow");
    expect(toOklch(tone.background).l).toBeGreaterThan(toOklch(CRITTER_COLORS.yellow).l);
    expect(contrastRatio(tone.ink, tone.deep)).toBeGreaterThanOrEqual(BUBBLE_TEXT_MIN);
  });

  it.each(SKIN_IDS.flatMap((id) => CRITTER_COLOR_NAMES.map((color) => [id, color] as const)))(
    "clears AA for %s × %s, including the pieces inside the bubble",
    (id, color) => {
      const tone = userBubbleTone(color);
      const page = skin(id)["--color-app"];
      expect(page, id).toMatch(/^#[0-9a-f]{6}$/i);
      for (const [end, fill] of [["light end", tone.background], ["deep end", tone.deep]] as const) {
        expect(contrastRatio(tone.ink, fill), `body, ${end}`).toBeGreaterThanOrEqual(BUBBLE_TEXT_MIN);
        expect(contrastRatio(tone.secondary, fill), `secondary, ${end}`).toBeGreaterThanOrEqual(BUBBLE_TEXT_MIN);
        expect(contrastRatio(tone.tertiary, fill), `tertiary, ${end}`).toBeGreaterThanOrEqual(BUBBLE_TEXT_MIN);
        expect(contrastRatio(tone.accent, fill), `link, ${end}`).toBeGreaterThanOrEqual(BUBBLE_TEXT_MIN);
        expect(contrastRatio(tone.danger, fill), `danger, ${end}`).toBeGreaterThanOrEqual(BUBBLE_TEXT_MIN);
        expect(contrastRatio(tone.success, fill), `success, ${end}`).toBeGreaterThanOrEqual(BUBBLE_TEXT_MIN);
        expect(contrastRatio(tone.hairline, fill), `hairline, ${end}`).toBeGreaterThanOrEqual(3);
        expect(contrastRatio(tone.focus, fill), `focus, ${end}`).toBeGreaterThanOrEqual(3);
        const quote = quoteSurface(tone.inset, fill);
        expect(contrastRatio(tone.accent, quote), `quote name, ${end}`).toBeGreaterThanOrEqual(BUBBLE_TEXT_MIN);
        expect(contrastRatio(tone.secondary, quote), `quote snippet, ${end}`).toBeGreaterThanOrEqual(BUBBLE_TEXT_MIN);
      }
      expect(contrastRatio(tone.tertiary, tone.background)).toBeLessThanOrEqual(contrastRatio(tone.secondary, tone.background));
      expect(contrastRatio(tone.ink, tone.inset), "code").toBeGreaterThanOrEqual(BUBBLE_TEXT_MIN);
      expect(contrastRatio(tone.secondary, tone.inset), "code secondary").toBeGreaterThanOrEqual(BUBBLE_TEXT_MIN);
      expect(contrastRatio(tone.ink, tone.raised), "hover").toBeGreaterThanOrEqual(BUBBLE_TEXT_MIN);
      expect(contrastRatio(tone.ink, tone.raisedHover), "hover stronger").toBeGreaterThanOrEqual(BUBBLE_TEXT_MIN);
      expect(contrastRatio(tone.accent, tone.raised), "link on hover").toBeGreaterThanOrEqual(BUBBLE_TEXT_MIN);
      expect(contrastRatio(tone.accentInk, tone.accent), "send").toBeGreaterThanOrEqual(BUBBLE_TEXT_MIN);
      expect(contrastRatio(tone.dangerInk, tone.danger), "danger fill").toBeGreaterThanOrEqual(BUBBLE_TEXT_MIN);
      expect(contrastRatio(tone.successInk, tone.success), "success fill").toBeGreaterThanOrEqual(BUBBLE_TEXT_MIN);
      expect(contrastRatio(tone.selectionInk, tone.selection), "selection").toBeGreaterThanOrEqual(BUBBLE_TEXT_MIN);
      if (tone.ink === "#ffffff") expect(tone.selection).toBe(selectionBackground(tone.background));
      for (const mention of CRITTER_COLOR_NAMES) {
        const chip = mentionChipBackground(CRITTER_COLORS[mention], tone.inset);
        expect(contrastRatio(tone.ink, chip), `mention ${mention}`).toBeGreaterThanOrEqual(BUBBLE_TEXT_MIN);
      }
    },
  );
});

describe("the owner's bubble in a room", () => {
  it("wears the brand coral, since a room has no bot colour of its own", () => {
    expect(ROOM_OWN_BUBBLE_COLOR).toBe("coral");
    expect(userBubbleTone(ROOM_OWN_BUBBLE_COLOR).ink).toBe("#ffffff");
    expect(contrastRatio(userBubbleTone(ROOM_OWN_BUBBLE_COLOR).background, "#ffffff")).toBeGreaterThanOrEqual(BUBBLE_TEXT_MIN);
  });

  it("is the same style a one-to-one bubble of that colour has, computed once", () => {
    expect(roomOwnBubbleStyle()).toEqual(userBubbleStyle(ROOM_OWN_BUBBLE_COLOR));
    expect(roomOwnBubbleStyle()).toBe(roomOwnBubbleStyle());
  });
});
