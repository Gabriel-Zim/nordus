// The iOS motion the Nordus phone layout copies, measured frame by frame from Grok on an iPhone
// (nordus-ai/estudo_grok-ui/iphone/ANALISE.md). The CSS twins live in styles.css as --ios-*.

/** Push and pop: the screen above starts at full speed and settles like UIKit's damped spring. */
export const IOS_PUSH_MS = 350;
export const IOS_POP_MS = 300;
/** Pull to refresh: the spinner fires past this many points, then rests at REST while it loads. */
export const PULL_TRIGGER = 64;
export const PULL_REST = 52;

/** UIScrollView's rubber band: the further the pull, the less the content follows. */
export function rubberBand(raw: number, dimension: number): number {
  if (raw <= 0) return 0;
  return (1 - 1 / ((raw * 0.55) / dimension + 1)) * dimension;
}

/**
 * Where an edge swipe goes when the finger lifts: back to the list past half the width or on a
 * flick to the right (UIKit's rule), else home again. `velocity` is in px per ms, to the right.
 */
export function settleEdgeSwipe(dx: number, width: number, velocity: number): { back: boolean; ms: number } {
  const flick = velocity * 1000 > width * 0.5;
  const back = velocity < -0.2 ? false : flick || dx > width / 2;
  const left = back ? 1 - dx / width : dx / width;
  return { back, ms: Math.round(Math.max(180, IOS_POP_MS * Math.min(1, left * 1.4))) };
}

/** Event a screen pushed over the conversation (the bot's profile) gets when it should close. */
export const STACK_POP_EVENT = "nordus:stack-pop";

/** True on a phone, where the conversation and what opens over it move as a stack. */
export function inPhoneStack(el: Element | null): boolean {
  return Boolean(el?.closest("[data-mobile-stack]")) && window.matchMedia("(max-width: 767px)").matches;
}

/**
 * Slides a screen pushed over the conversation out to the right (pop) or back home, on the
 * measured curve, from wherever it is now (a finger may have dragged it part way).
 */
export function slideLayer(el: HTMLElement, to: "out" | "home", ms: number = IOS_POP_MS, done?: () => void): void {
  el.style.animation = "none";
  el.style.transition = `transform ${ms}ms var(--ios-push-ease)`;
  // Read the layout so the start position is committed before the transition target is set.
  void el.offsetWidth;
  el.style.transform = to === "out" ? "translateX(100%)" : "translateX(0)";
  window.setTimeout(() => {
    done?.();
    // Every exit and every return ends clean: nothing inline survives to the next time the screen opens.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      for (const property of ["transform", "transition", "animation", "will-change"]) el.style.removeProperty(property);
    }));
  }, ms);
}

type ImpactStyle = "LIGHT" | "MEDIUM" | "HEAVY";
interface HapticsPlugin {
  impact?: (options: { style: ImpactStyle }) => Promise<void>;
  selectionChanged?: () => Promise<void>;
}

function haptics(): HapticsPlugin | null {
  if (typeof window === "undefined") return null;
  const cap = (window as Window & { Capacitor?: { Plugins?: { Haptics?: HapticsPlugin } } }).Capacitor;
  return cap?.Plugins?.Haptics ?? null;
}

/** A tap of the Taptic Engine inside the iPhone app; nothing anywhere else. */
export function haptic(kind: "light" | "selection"): void {
  const plugin = haptics();
  const run = kind === "light" ? plugin?.impact?.({ style: "LIGHT" }) : plugin?.selectionChanged?.();
  void run?.catch(() => {});
}
