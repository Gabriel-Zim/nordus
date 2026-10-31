// The phone's edge swipe back, for every screen in the stack: the conversation over the list, and
// any screen pushed over them (the bot's or the room's profile, the alerts, the computer…).
// Only the moving elements are touched, straight through their transform, once per frame: a CSS
// variable on the stack root would restyle the whole tree on every touchmove (WebKit, iOS 26).
import { haptic, settleEdgeSwipe, STACK_POP_EVENT } from "@/lib/ios-motion";

/** How far from the left edge a touch may start an edge swipe. */
export const EDGE_PX = 24;
/** A drag counts once it has moved this far; a steeper one is a scroll and is left alone. */
const SLOP_PX = 8;
const PARALLAX = 0.3;

/** Screens pushed over the conversation or the list, front-most last. */
export const PUSHED_SCREENS = ":scope > [data-stack-layer], [data-stack-main] [data-stack-layer], [data-stack-main] [data-room-info], [data-stack-main] [data-stack-panel]";

export interface StackSwipeOptions {
  /** False on a wide screen, where nothing is stacked. */
  enabled: () => boolean;
  /** True while the list is the screen in front. */
  listShown: () => boolean;
  /** The conversation was swiped away: show the list. */
  onBackToList: () => void;
}

type Target =
  | { kind: "main"; top: HTMLElement; under: HTMLElement | null; shade: HTMLElement | null }
  | { kind: "layer"; top: HTMLElement }
  | { kind: "sub"; back: HTMLElement; top: HTMLElement };

function visible(el: HTMLElement): boolean {
  const box = el.getBoundingClientRect();
  return box.width > 0 && box.height > 0;
}

/** The front-most pushed screen, if any. */
export function frontScreen(stack: HTMLElement): HTMLElement | null {
  const all = [...stack.querySelectorAll<HTMLElement>(PUSHED_SCREENS)].filter(visible);
  return all.at(-1) ?? null;
}

/** Takes every inline trace of a drag or a slide off an element, so its CSS state shows again. */
export function clearMotion(el: HTMLElement | null | undefined): void {
  if (!el) return;
  el.style.removeProperty("transform");
  el.style.removeProperty("transition");
  el.style.removeProperty("animation");
  el.style.removeProperty("will-change");
  el.style.removeProperty("opacity");
}

/** Closes a pushed screen that is already out of sight: its own pop handler, else its close button. */
export function popScreen(screen: HTMLElement): void {
  const close = screen.querySelector<HTMLElement>("[data-layer-close]");
  if (screen.matches("[data-stack-layer]") && !screen.matches("[data-stack-panel]")) {
    screen.dispatchEvent(new Event(STACK_POP_EVENT));
    return;
  }
  close?.click();
}

function targetFor(stack: HTMLElement, options: StackSwipeOptions): Target | null {
  const screen = frontScreen(stack);
  if (screen) {
    const back = [...screen.querySelectorAll<HTMLElement>("[data-layer-subback]")].find(visible);
    return back ? { kind: "sub", back, top: screen } : { kind: "layer", top: screen };
  }
  if (options.listShown()) return null;
  const top = stack.querySelector<HTMLElement>(":scope > [data-stack-main]");
  if (!top) return null;
  return {
    kind: "main",
    top,
    under: stack.querySelector<HTMLElement>(":scope > aside[data-sidebar]"),
    shade: stack.querySelector<HTMLElement>(":scope > [data-stack-shade]"),
  };
}

function moving(target: Target): HTMLElement[] {
  if (target.kind === "main") return [target.top, target.under, target.shade].filter((el): el is HTMLElement => Boolean(el));
  return target.kind === "layer" ? [target.top] : [];
}

function place(target: Target, dx: number, width: number): void {
  if (target.kind === "sub") return;
  target.top.style.transform = `translate3d(${dx}px,0,0)`;
  if (target.kind !== "main") return;
  if (target.under) target.under.style.transform = `translate3d(calc(${-PARALLAX * 100}% + ${dx * PARALLAX}px),0,0)`;
  if (target.shade) target.shade.style.opacity = String(Math.max(0, 1 - dx / width));
}

export function attachStackSwipe(stack: HTMLElement, options: StackSwipeOptions): () => void {
  let drag: { x: number; y: number; dx: number; t: number; v: number; on: boolean; target: Target } | null = null;
  let frame = 0;

  const start = (event: TouchEvent) => {
    if (drag || event.touches.length !== 1 || !options.enabled()) return;
    const touch = event.touches[0]!;
    if (touch.clientX > EDGE_PX) return;
    const target = targetFor(stack, options);
    if (!target) return;
    drag = { x: touch.clientX, y: touch.clientY, dx: 0, t: event.timeStamp, v: 0, on: false, target };
  };

  const move = (event: TouchEvent) => {
    if (!drag) return;
    const touch = event.touches[0]!;
    const dx = Math.max(0, touch.clientX - drag.x);
    const dy = Math.abs(touch.clientY - drag.y);
    if (!drag.on) {
      if (dy > SLOP_PX && dy > dx) {
        drag = null;
        return;
      }
      if (dx < SLOP_PX) return;
      drag.on = true;
      stack.setAttribute("data-dragging", "");
      for (const el of moving(drag.target)) {
        el.style.transition = "none";
        el.style.animation = "none";
        el.style.willChange = el.matches("[data-stack-shade]") ? "opacity" : "transform";
      }
    }
    event.preventDefault();
    const ms = Math.max(1, event.timeStamp - drag.t);
    drag.v = drag.v * 0.4 + ((dx - drag.dx) / ms) * 0.6;
    drag.t = event.timeStamp;
    drag.dx = dx;
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (drag?.on) place(drag.target, drag.dx, window.innerWidth);
    });
  };

  const end = () => {
    const done = drag;
    drag = null;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    if (!done?.on) return;
    stack.removeAttribute("data-dragging");
    const width = window.innerWidth;
    const { back, ms } = settleEdgeSwipe(done.dx, width, done.v);
    const target = done.target;
    if (target.kind === "sub") {
      if (back) {
        haptic("selection");
        target.back.click();
      }
      return;
    }
    const els = moving(target);
    for (const el of els) {
      el.style.transition = el.matches("[data-stack-shade]")
        ? `opacity ${ms}ms linear`
        : `transform ${ms}ms var(--ios-push-ease)`;
    }
    place(target, back ? width : 0, width);
    window.setTimeout(() => {
      if (back) {
        haptic("selection");
        if (target.kind === "main") options.onBackToList();
        else popScreen(target.top);
      }
      // After the state change has been committed, so the CSS state the element lands in matches.
      requestAnimationFrame(() => requestAnimationFrame(() => els.forEach(clearMotion)));
    }, ms);
  };

  stack.addEventListener("touchstart", start, { passive: true });
  stack.addEventListener("touchmove", move, { passive: false });
  stack.addEventListener("touchend", end);
  stack.addEventListener("touchcancel", end);
  return () => {
    if (frame) cancelAnimationFrame(frame);
    stack.removeEventListener("touchstart", start);
    stack.removeEventListener("touchmove", move);
    stack.removeEventListener("touchend", end);
    stack.removeEventListener("touchcancel", end);
  };
}
