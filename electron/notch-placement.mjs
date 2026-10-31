export const NOTCH_MIN_INSET = 28;
export const NOTCH_GAP = 212;
export const NOTCH_STRIP = 32;
export const WING_LEFT = 58;
export const WING_RIGHT = 172;
export const PILL_WIDTH = 226;
export const PILL_HEIGHT = 34;
export const PILL_TOP_MARGIN = 6;
export const PANEL_WIDTH = 420;
export const PANEL_HEIGHT = 128;

export const topInset = (display) => Math.max(0, Math.round(display.workArea.y - display.bounds.y));

/** Notched MacBook panels (3024x1964, 3456x2234, 2560x1664, 2880x1864) are about 1.54 wide to tall; built-in panels without a notch are 16:10 or wider. */
const hasNotchedShape = ({ bounds }) => {
  const ratio = bounds.width / bounds.height;
  return ratio >= 1.5 && ratio <= 1.57;
};

/** The built-in display's menu bar is taller than a plain one only around a notch. Electron has no safe-area API. */
export function isNotched(display, learned) {
  return display.internal === true && (topInset(display) >= NOTCH_MIN_INSET || learned.has(display.id) || hasNotchedShape(display));
}

/** Remembers each display's tallest menu bar, so a hidden one (full screen, auto-hide) is told apart from a plain one. */
export function observeDisplays(displays, insets) {
  const present = new Set(displays.map((display) => display.id));
  for (const id of insets.keys()) if (!present.has(id)) insets.delete(id);
  for (const display of displays) insets.set(display.id, Math.max(insets.get(display.id) ?? 0, topInset(display)));
}

export const learnedNotches = (displays, insets) =>
  new Set(displays.filter((display) => display.internal === true && (insets.get(display.id) ?? 0) >= NOTCH_MIN_INSET).map((display) => display.id));

export function chooseTarget({ displays, primary, learned = new Set() }) {
  const notched = displays.find((display) => isNotched(display, learned));
  if (notched) return { display: notched, kind: "notch" };
  const display = primary ?? displays[0];
  return display ? { display, kind: "pill" } : null;
}

/** A menu bar that was there and is gone means a full-screen app owns this display. */
export const menuBarHidden = (display, insets) => topInset(display) === 0 && (insets.get(display.id) ?? 0) > 0;

const clamp = (value, low, high) => Math.min(Math.max(value, low), Math.max(low, high));

/** `bounds` in the same global points Electron's screen uses; `layout` is what the page draws inside them. */
export function placeNotch({ display, kind, expanded }) {
  const area = display.bounds;
  const centre = area.x + area.width / 2;
  const inset = topInset(display);
  if (kind === "notch") {
    const strip = inset >= NOTCH_MIN_INSET ? inset : NOTCH_STRIP;
    const compact = WING_LEFT + NOTCH_GAP + WING_RIGHT;
    const width = expanded ? Math.max(compact, PANEL_WIDTH) : compact;
    const side = (width - NOTCH_GAP) / 2;
    const left = expanded ? side : WING_LEFT;
    const right = expanded ? side : WING_RIGHT;
    const x = Math.round(centre - NOTCH_GAP / 2 - left);
    return {
      bounds: { x: clamp(x, area.x, area.x + area.width - width), y: area.y, width, height: strip + (expanded ? PANEL_HEIGHT : 0) },
      layout: { kind, left, gap: NOTCH_GAP, right, strip, panel: expanded ? PANEL_HEIGHT : 0 },
    };
  }
  const width = expanded ? PANEL_WIDTH : PILL_WIDTH;
  const left = expanded ? width / 2 : WING_LEFT;
  const right = width - left;
  const x = Math.round(centre - width / 2);
  return {
    bounds: {
      x: clamp(x, area.x, area.x + area.width - width),
      y: display.workArea.y + PILL_TOP_MARGIN,
      width,
      height: PILL_HEIGHT + (expanded ? PANEL_HEIGHT : 0),
    },
    layout: { kind, left, gap: 0, right, strip: PILL_HEIGHT, panel: expanded ? PANEL_HEIGHT : 0 },
  };
}
