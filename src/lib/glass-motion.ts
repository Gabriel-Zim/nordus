// How the Nordus glass moves, measured frame by frame on WhatsApp for iOS 26
// (nordus-ai/estudo_glass-anim/ANALISE.md). Two behaviours, added to every glass piece on the page
// without touching the components that draw them:
//
// 1. Lift: under the finger a glass control swells (a round button to 1.28x in 120 ms, wider
//    pieces less) and lights up inside; let go and it springs back in 220 ms with a 4% overshoot.
// 2. Morph: a glass menu that opens from a button grows out of that button as one piece of glass:
//    from the button's box to its own in 230 ms, peaking 5% past its size near 170 ms, round
//    corners easing to its own, its items going from blurred to sharp. Closing is the same way back
//    in 150 ms, the items blurring first, the button fading back in.
//
// Only transform, opacity, filter and border-radius animate; the backdrop-filter of a piece never
// changes per frame. With prefers-reduced-motion there is no lift and no morph, only a 120 ms fade.

import { haptic } from "@/lib/ios-motion";
import { LENS_SELECTOR } from "@/lib/liquid-glass";

/** What lifts under a finger: every glass control. */
export const LIFT_SELECTOR = LENS_SELECTOR;

/** What morphs out of the button that opened it: the glass menus and the select menu. */
export const MORPH_SELECTOR = [
  '[role="menu"]:is(.bg-menu, .bg-card, .bg-raised)',
  ".nordus-select-menu",
  "[data-glass-morph]",
].join(", ");

/** UIKit-like spring back from a lift: 4% past rest, settled by 220 ms. */
export const LIFT_RELEASE_EASE = "linear(0, 0.34 12%, 0.66 25%, 0.88 38%, 1.01 50%, 1.04 60%, 1.03 72%, 1.01 86%, 1)";
/** The morph: past the target by 5% at about 74% of 230 ms, then back to rest. */
export const MORPH_EASE = "linear(0, 0.28 10%, 0.58 24%, 0.82 40%, 0.96 55%, 1.04 68%, 1.05 74%, 1.02 87%, 1)";
export const MORPH_OPEN_MS = 230;
export const MORPH_CLOSE_MS = 150;

/** How much a piece swells: a small round button to 1.28x, a wide pill only a few points more. */
export function liftScale(width: number, height: number): number {
  const longest = Math.max(width, height, 1);
  return Math.round(Math.min(1.28, 1 + 16 / longest) * 1000) / 1000;
}

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * The transform that lays a box of size `to` over `from` (FLIP): where the menu must start so it
 * looks like the button, as translate and scale from its own top-left corner.
 */
export function flipFrom(from: Box, to: Box): { x: number; y: number; sx: number; sy: number } {
  const sx = to.width > 0 ? from.width / to.width : 1;
  const sy = to.height > 0 ? from.height / to.height : 1;
  return { x: from.left - to.left, y: from.top - to.top, sx, sy };
}

/** Corner radii that look round on the scaled box: a circle the size of the button. */
export function roundRadius(from: Box, scale: { sx: number; sy: number }): string {
  const r = Math.min(from.width, from.height) / 2;
  const rx = scale.sx > 0 ? r / scale.sx : r;
  const ry = scale.sy > 0 ? r / scale.sy : r;
  return `${Math.round(rx * 10) / 10}px / ${Math.round(ry * 10) / 10}px`;
}

const boxOf = (el: Element): Box => {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
};

export function installGlassMotion(doc: Document = document): () => void {
  const win = doc.defaultView;
  if (!win || typeof win.MutationObserver !== "function") return () => {};
  const reduced = () => win.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  const cleanups: (() => void)[] = [];

  // ── Lift ───────────────────────────────────────────────────────────────────
  let lifted: HTMLElement | null = null;
  let lastPressed: { el: Element; at: number } | null = null;
  const drop = () => {
    if (!lifted) return;
    lifted.removeAttribute("data-glass-lifted");
    lifted = null;
  };
  const down = (event: PointerEvent) => {
    if (!(event.target instanceof Element)) return;
    const control = event.target.closest("button, [role='button'], a[href], [role='tab'], [role='menuitem']");
    if (control) lastPressed = { el: control, at: event.timeStamp };
    if (event.button !== 0 || reduced()) return;
    const piece = event.target.closest<HTMLElement>(LIFT_SELECTOR);
    if (!piece || !control || !(piece.contains(control) || control.contains(piece))) return;
    if ((control as HTMLButtonElement).disabled) return;
    const rect = piece.getBoundingClientRect();
    piece.style.setProperty("--lg-lift", String(liftScale(rect.width, rect.height)));
    piece.setAttribute("data-glass-lifted", "");
    lifted = piece;
    if (event.pointerType === "touch") haptic("selection");
  };
  doc.addEventListener("pointerdown", down, { capture: true, passive: true });
  for (const type of ["pointerup", "pointercancel"] as const) doc.addEventListener(type, drop, { capture: true, passive: true });
  cleanups.push(() => {
    doc.removeEventListener("pointerdown", down, { capture: true });
    for (const type of ["pointerup", "pointercancel"] as const) doc.removeEventListener(type, drop, { capture: true });
  });

  // ── Morph ──────────────────────────────────────────────────────────────────
  const opened = new WeakMap<Element, { trigger: Element | null; box: Box }>();
  // Buttons hidden while their menu is open. A menu that goes some way this file does not see
  // (hidden instead of removed) must not leave its button invisible: a light check brings it back.
  const hidden = new Map<HTMLElement, HTMLElement>();
  let watch = 0;
  const reveal = (trigger: HTMLElement) => {
    hidden.delete(trigger);
    for (const animation of trigger.getAnimations()) animation.cancel();
  };
  const sweep = () => {
    for (const [trigger, menu] of hidden) {
      if (!menu.isConnected || menu.getClientRects().length === 0) reveal(trigger);
    }
    if (hidden.size === 0) {
      win.clearInterval(watch);
      watch = 0;
    }
  };

  const triggerFor = (menu: Element, now: number): Element | null => {
    const id = menu.id;
    const byAria = id ? doc.querySelector(`[aria-controls="${CSS.escape(id)}"]`) : null;
    if (byAria) return byAria;
    if (lastPressed && now - lastPressed.at < 800 && lastPressed.el.isConnected && !menu.contains(lastPressed.el)) return lastPressed.el;
    const active = doc.activeElement;
    return active && active !== doc.body && !menu.contains(active) ? active : null;
  };

  const open = (menu: HTMLElement) => {
    const trigger = triggerFor(menu, win.performance.now());
    const box = boxOf(menu);
    opened.set(menu, { trigger, box });
    if (reduced() || !trigger || box.width < 1) {
      menu.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120, easing: "linear" });
      return;
    }
    const from = boxOf(trigger);
    const flip = flipFrom(from, box);
    const radius = win.getComputedStyle(menu).borderRadius || "16px";
    menu.animate(
      [
        { transformOrigin: "0 0", transform: `translate(${flip.x}px, ${flip.y}px) scale(${flip.sx}, ${flip.sy})`, borderRadius: roundRadius(from, flip), opacity: 0.9 },
        { transformOrigin: "0 0", transform: "translate(0, 0) scale(1, 1)", borderRadius: radius, opacity: 1 },
      ],
      { duration: MORPH_OPEN_MS, easing: MORPH_EASE },
    );
    for (const item of Array.from(menu.children) as HTMLElement[]) {
      item.animate(
        [
          { opacity: 0, filter: "blur(8px)", transform: "scale(0.92)", offset: 0 },
          { opacity: 0, filter: "blur(8px)", transform: "scale(0.92)", offset: 0.26 },
          { opacity: 1, filter: "blur(0px)", transform: "scale(1)", offset: 0.78 },
          { opacity: 1, filter: "blur(0px)", transform: "scale(1)", offset: 1 },
        ],
        { duration: MORPH_OPEN_MS, easing: "ease-out" },
      );
    }
    // The button turns into the menu: it is not there while the menu is.
    if (trigger instanceof HTMLElement) {
      trigger.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 60, fill: "forwards", easing: "linear" });
      hidden.set(trigger, menu);
      if (!watch) watch = win.setInterval(sweep, 400);
    }
    win.setTimeout(() => {
      if (menu.isConnected) opened.set(menu, { trigger, box: boxOf(menu) });
    }, MORPH_OPEN_MS + 20);
  };

  const close = (menu: HTMLElement) => {
    const state = opened.get(menu);
    if (!state) return;
    opened.delete(menu);
    const trigger = state.trigger instanceof HTMLElement && state.trigger.isConnected ? state.trigger : null;
    const showTrigger = () => {
      if (!trigger) return;
      reveal(trigger);
      trigger.animate([{ opacity: 0, filter: "brightness(1.4)" }, { opacity: 1, filter: "brightness(1)" }], { duration: 100, easing: "ease-out" });
    };
    if (reduced() || !trigger || state.box.width < 1) {
      showTrigger();
      return;
    }
    // The menu is already out of the page: a still copy of it shrinks back into the button.
    const ghost = menu.cloneNode(true) as HTMLElement;
    ghost.removeAttribute("id");
    ghost.setAttribute("aria-hidden", "true");
    ghost.setAttribute("inert", "");
    Object.assign(ghost.style, {
      position: "fixed",
      left: `${state.box.left}px`,
      top: `${state.box.top}px`,
      width: `${state.box.width}px`,
      height: `${state.box.height}px`,
      right: "auto",
      bottom: "auto",
      margin: "0",
      transform: "none",
      zIndex: "2147483000",
      pointerEvents: "none",
    });
    doc.body.append(ghost);
    const to = boxOf(trigger);
    const flip = flipFrom(to, state.box);
    const radius = win.getComputedStyle(ghost).borderRadius || "16px";
    for (const item of Array.from(ghost.children) as HTMLElement[]) {
      item.animate([{ opacity: 1, filter: "blur(0px)" }, { opacity: 0, filter: "blur(8px)", offset: 0.34 }, { opacity: 0, filter: "blur(8px)" }], {
        duration: MORPH_CLOSE_MS,
        fill: "forwards",
      });
    }
    const shrink = ghost.animate(
      [
        { transformOrigin: "0 0", transform: "translate(0, 0) scale(1, 1)", borderRadius: radius, opacity: 1 },
        { transformOrigin: "0 0", transform: `translate(${flip.x}px, ${flip.y}px) scale(${flip.sx}, ${flip.sy})`, borderRadius: roundRadius(to, flip), opacity: 0.6 },
      ],
      { duration: MORPH_CLOSE_MS, easing: "cubic-bezier(.4, 0, .2, 1)", fill: "forwards" },
    );
    win.setTimeout(showTrigger, MORPH_CLOSE_MS - 50);
    shrink.finished.finally(() => ghost.remove()).catch(() => {});
  };

  const visit = (nodes: NodeList, fn: (menu: HTMLElement) => void) => {
    for (const node of Array.from(nodes)) {
      if (!(node instanceof HTMLElement)) continue;
      if (node.matches(MORPH_SELECTOR)) fn(node);
      for (const inner of node.querySelectorAll<HTMLElement>(MORPH_SELECTOR)) fn(inner);
    }
  };
  const tree = new win.MutationObserver((records) => {
    for (const record of records) {
      visit(record.removedNodes, close);
      visit(record.addedNodes, (menu) => {
        if (!opened.has(menu) && !menu.hasAttribute("aria-hidden")) open(menu);
      });
    }
  });
  tree.observe(doc.body, { childList: true, subtree: true });
  cleanups.push(() => tree.disconnect());

  cleanups.push(() => {
    win.clearInterval(watch);
    for (const trigger of hidden.keys()) reveal(trigger);
  });

  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}
