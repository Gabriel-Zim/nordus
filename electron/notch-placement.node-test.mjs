import assert from "node:assert/strict";
import test from "node:test";

import {
  chooseTarget,
  isNotched,
  learnedNotches,
  menuBarHidden,
  NOTCH_GAP,
  observeDisplays,
  PANEL_HEIGHT,
  PANEL_WIDTH,
  PILL_HEIGHT,
  PILL_TOP_MARGIN,
  PILL_WIDTH,
  placeNotch,
  topInset,
  WING_LEFT,
  WING_RIGHT,
} from "./notch-placement.mjs";

const display = (id, { x = 0, y = 0, width = 1512, height = 982, bar = 37, internal = false } = {}) => ({
  id,
  internal,
  bounds: { x, y, width, height },
  workArea: { x, y: y + bar, width, height: height - bar },
});
const builtIn = (id = 1, extra = {}) => display(id, { internal: true, bar: 37, ...extra });
const plainBuiltIn = (id = 1, extra = {}) => display(id, { internal: true, width: 1440, height: 900, bar: 25, ...extra });
const external = (id = 2, extra = {}) => display(id, { width: 2560, height: 1440, bar: 25, ...extra });

test("the menu bar height is what the display gives up at the top", () => {
  assert.equal(topInset(builtIn()), 37);
  assert.equal(topInset(external()), 25);
  assert.equal(topInset(display(3, { bar: 0 })), 0);
});

test("only the built-in display with a tall menu bar counts as notched", () => {
  assert.equal(isNotched(builtIn(), new Set()), true);
  assert.equal(isNotched(plainBuiltIn(), new Set()), false);
  assert.equal(isNotched(display(2, { bar: 37 }), new Set()), false, "an external display never has the notch");
});

test("the menu bar of a scaled notched display still tells it apart from a plain one", () => {
  const scaled = (bar) => display(1, { internal: true, width: 1496, height: 967, bar });
  assert.equal(isNotched(scaled(29), new Set()), true);
  assert.equal(isNotched(plainBuiltIn(1, { bar: 27 }), new Set()), false);
  assert.equal(isNotched(plainBuiltIn(1, { bar: 28 }), new Set()), true);
});

test("a notched display whose menu bar is hidden at the moment is still the notched one", () => {
  const hidden = plainBuiltIn(1, { bar: 0 });
  assert.equal(isNotched(hidden, new Set()), false);
  assert.equal(isNotched(hidden, new Set([1])), true);
});

test("the shape of the panel finds the notch even when the menu bar was never seen", () => {
  for (const [width, height] of [[1512, 982], [1728, 1117], [1470, 956], [1710, 1107], [1800, 1169], [1352, 878]]) {
    assert.equal(isNotched(display(1, { internal: true, width, height, bar: 0 }), new Set()), true, `${width}x${height}`);
  }
  for (const [width, height] of [[1440, 900], [1680, 1050], [1280, 800], [1366, 768], [2560, 1440]]) {
    assert.equal(isNotched(display(1, { internal: true, width, height, bar: 0 }), new Set()), false, `${width}x${height}`);
  }
  assert.equal(isNotched(display(2, { width: 1512, height: 982, bar: 0 }), new Set()), false, "never on an external display");
  assert.equal(isNotched(display(1, { internal: true, width: 0, height: 0, bar: 0 }), new Set()), false);
});

test("the notch goes to the built-in display, whichever display is primary", () => {
  const laptop = builtIn(1, { x: 2560, y: 400 });
  const monitor = external(2, { x: 0, y: 0 });
  const target = chooseTarget({ displays: [monitor, laptop], primary: monitor });
  assert.equal(target.kind, "notch");
  assert.equal(target.display.id, 1);
});

test("without a notch the primary display gets a pill", () => {
  const monitor = external(2);
  const old = plainBuiltIn(1);
  const target = chooseTarget({ displays: [old, monitor], primary: monitor });
  assert.equal(target.kind, "pill");
  assert.equal(target.display.id, 2);
  assert.equal(chooseTarget({ displays: [], primary: undefined }), null);
});

test("on the notch the wings sit either side of it and the window starts at the top of the screen", () => {
  const { bounds, layout } = placeNotch({ display: builtIn(), kind: "notch", expanded: false });

  assert.equal(bounds.y, 0);
  assert.equal(bounds.height, 37);
  assert.equal(bounds.width, WING_LEFT + NOTCH_GAP + WING_RIGHT);
  assert.equal(bounds.x + WING_LEFT + NOTCH_GAP / 2, 1512 / 2, "the gap is centred on the display, where the notch is");
  assert.deepEqual(layout, { kind: "notch", left: WING_LEFT, gap: NOTCH_GAP, right: WING_RIGHT, strip: 37, panel: 0 });
});

test("an approval grows the notch downward and keeps the gap centred", () => {
  const { bounds, layout } = placeNotch({ display: builtIn(), kind: "notch", expanded: true });

  assert.equal(bounds.y, 0);
  assert.equal(bounds.height, 37 + PANEL_HEIGHT);
  assert.equal(bounds.width, Math.max(WING_LEFT + NOTCH_GAP + WING_RIGHT, PANEL_WIDTH));
  assert.equal(bounds.x + layout.left + NOTCH_GAP / 2, 1512 / 2);
  assert.equal(layout.left + layout.gap + layout.right, bounds.width);
  assert.equal(layout.panel, PANEL_HEIGHT);
});

test("a second display keeps its own coordinates, even left of the primary", () => {
  const left = builtIn(5, { x: -1512, y: -200 });
  const { bounds } = placeNotch({ display: left, kind: "notch", expanded: false });
  assert.equal(bounds.y, -200);
  assert.equal(bounds.x + WING_LEFT + NOTCH_GAP / 2, -1512 + 1512 / 2);
});

test("a hidden menu bar on a notched display falls back to the usual strip height", () => {
  const { bounds, layout } = placeNotch({ display: builtIn(1, { bar: 0 }), kind: "notch", expanded: false });
  assert.equal(bounds.height, 32);
  assert.equal(layout.strip, 32);
});

test("a scaled display with a shorter menu bar gets a strip as tall as that bar", () => {
  const { bounds, layout } = placeNotch({ display: display(1, { internal: true, width: 1496, height: 967, bar: 29 }), kind: "notch", expanded: false });
  assert.equal(bounds.height, 29);
  assert.equal(layout.strip, 29);
});

test("without a notch the pill hangs under the menu bar, centred", () => {
  const monitor = external(2, { x: 100, y: 50 });
  const { bounds, layout } = placeNotch({ display: monitor, kind: "pill", expanded: false });

  assert.equal(bounds.y, 50 + 25 + PILL_TOP_MARGIN);
  assert.equal(bounds.width, PILL_WIDTH);
  assert.equal(bounds.height, PILL_HEIGHT);
  assert.equal(bounds.x + bounds.width / 2, 100 + 2560 / 2);
  assert.equal(layout.gap, 0);
  assert.equal(layout.left + layout.right, PILL_WIDTH);
});

test("the pill expands with an approval", () => {
  const { bounds, layout } = placeNotch({ display: external(2), kind: "pill", expanded: true });
  assert.equal(bounds.width, PANEL_WIDTH);
  assert.equal(bounds.height, PILL_HEIGHT + PANEL_HEIGHT);
  assert.equal(layout.panel, PANEL_HEIGHT);
});

test("the window never leaves a display narrower than itself", () => {
  const tiny = display(9, { width: 300, height: 400, bar: 25 });
  const { bounds } = placeNotch({ display: tiny, kind: "pill", expanded: true });
  assert.ok(bounds.x >= 0);
});

test("a menu bar seen and now gone means a full-screen app", () => {
  const insets = new Map();
  const bar = builtIn(1);
  observeDisplays([bar], insets);
  assert.equal(menuBarHidden(bar, insets), false);

  const full = builtIn(1, { bar: 0 });
  assert.equal(menuBarHidden(full, insets), true);
  observeDisplays([full], insets);
  assert.equal(menuBarHidden(full, insets), true, "remembered, not overwritten by the hidden bar");
  assert.equal(menuBarHidden(bar, insets), false);
});

test("a display that never showed a menu bar is not treated as full screen", () => {
  const insets = new Map();
  const autoHide = display(3, { bar: 0 });
  observeDisplays([autoHide], insets);
  assert.equal(menuBarHidden(autoHide, insets), false);
});

test("unplugged displays are forgotten and notches are learned only on the built-in one", () => {
  const insets = new Map();
  observeDisplays([builtIn(1), external(2)], insets);
  assert.deepEqual([...learnedNotches([builtIn(1), external(2)], insets)], [1]);

  observeDisplays([builtIn(1)], insets);
  assert.equal(insets.has(2), false);
});
