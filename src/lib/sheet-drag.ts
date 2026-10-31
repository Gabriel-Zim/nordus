// Drag a sheet down to close it, as on iOS: on a phone every glass pop-up is a sheet risen from the
// bottom (styles.css). A pull down that starts where the sheet's content is at its top follows the
// finger 1:1 while the dim behind clears; released past a third of the height or on a downward
// flick it falls away on the measured sheet curve and closes, otherwise it springs back.
import { haptic } from "@/lib/ios-motion";

export const SHEET_MS = 480;

/** Where a released sheet goes: away past a third of its height or on a downward flick (px per ms). */
export function settleSheet(dy: number, height: number, velocity: number): { close: boolean; ms: number } {
  const close = velocity < -0.2 ? false : velocity * 1000 > height * 0.5 || dy > height / 3;
  const left = close ? 1 - dy / height : dy / height;
  return { close, ms: Math.round(Math.max(200, SHEET_MS * Math.min(1, left * 1.3))) };
}

function scrolledDown(from: Element, sheet: Element): boolean {
  for (let node: Element | null = from; node && node !== sheet.parentElement; node = node.parentElement) {
    if (node instanceof HTMLElement && node.scrollTop > 0) return true;
  }
  return false;
}

/** Closes a sheet the way its own backdrop does: a press on the frame around it. */
function closeSheet(frame: HTMLElement) {
  frame.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
}

export function installSheetDrag(root: Document = document): () => void {
  let drag: { sheet: HTMLElement; scrim: HTMLElement | null; frame: HTMLElement; y: number; x: number; t: number; dy: number; v: number; on: boolean; height: number } | null = null;
  let frame = 0;

  const start = (event: TouchEvent) => {
    if (event.touches.length !== 1 || !(event.target instanceof Element)) return;
    const sheet = event.target.closest<HTMLElement>(".glass-popup");
    const frame = sheet?.closest<HTMLElement>(".glass-popup-frame");
    if (!sheet || !frame || scrolledDown(event.target, sheet)) return;
    if (event.target.closest("input, textarea, select, [contenteditable='true'], [role='slider']")) return;
    const touch = event.touches[0]!;
    drag = { sheet, frame, scrim: frame.querySelector<HTMLElement>(":scope > .glass-scrim"), y: touch.clientY, x: touch.clientX, t: event.timeStamp, dy: 0, v: 0, on: false, height: 0 };
  };

  const move = (event: TouchEvent) => {
    if (!drag) return;
    const touch = event.touches[0]!;
    const dy = touch.clientY - drag.y;
    if (!drag.on) {
      if (Math.abs(touch.clientX - drag.x) > Math.abs(dy) || dy < 0) {
        if (Math.abs(dy) > 6 || Math.abs(touch.clientX - drag.x) > 6) drag = null;
        return;
      }
      if (dy < 6) return;
      drag.on = true;
      drag.height = drag.sheet.offsetHeight;
      drag.sheet.style.animation = "none";
      drag.sheet.style.transition = "none";
      drag.sheet.style.willChange = "transform";
      if (drag.scrim) {
        drag.scrim.style.animation = "none";
        drag.scrim.style.transition = "none";
      }
    }
    event.preventDefault();
    const ms = Math.max(1, event.timeStamp - drag.t);
    drag.v = drag.v * 0.4 + ((Math.max(0, dy) - drag.dy) / ms) * 0.6;
    drag.t = event.timeStamp;
    drag.dy = Math.max(0, dy);
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (!drag?.on) return;
      drag.sheet.style.transform = `translate3d(0,${drag.dy}px,0)`;
      if (drag.scrim) drag.scrim.style.opacity = String(1 - drag.dy / drag.height);
    });
  };

  const end = () => {
    const done = drag;
    drag = null;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    if (!done?.on) return;
    const { sheet, scrim, frame: sheetFrame } = done;
    const { close, ms } = settleSheet(done.dy, done.height, done.v);
    sheet.style.transition = `transform ${ms}ms var(--ios-sheet-ease)`;
    sheet.style.transform = close ? "translateY(100%)" : "";
    if (scrim) {
      scrim.style.transition = `opacity ${ms}ms var(--ios-sheet-ease)`;
      scrim.style.opacity = close ? "0" : "";
    }
    window.setTimeout(() => {
      if (close) {
        haptic("selection");
        closeSheet(sheetFrame);
        return;
      }
      sheet.style.transition = "";
      sheet.style.willChange = "";
      if (scrim) scrim.style.transition = "";
    }, ms);
  };

  root.addEventListener("touchstart", start, { passive: true });
  root.addEventListener("touchmove", move, { passive: false });
  root.addEventListener("touchend", end);
  root.addEventListener("touchcancel", end);
  return () => {
    root.removeEventListener("touchstart", start);
    root.removeEventListener("touchmove", move);
    root.removeEventListener("touchend", end);
    root.removeEventListener("touchcancel", end);
  };
}
