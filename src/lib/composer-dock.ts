import { useLayoutEffect, type RefObject } from "react";

/** Must equal Tailwind `gap-3` on the transcript stack. */
export const TRANSCRIPT_GAP = "0.75rem";

export const COMPOSER_DOCK_HEIGHT = "var(--composer-dock-h, 64px)";

/** Room the transcript leaves under its last row for the composer floating over it. */
export const TRANSCRIPT_END_PAD = `calc(${COMPOSER_DOCK_HEIGHT} + ${TRANSCRIPT_GAP})`;

export function composerDockHeightValue(heightPx: number): string | null {
  return Number.isFinite(heightPx) && heightPx > 0 ? `${Math.ceil(heightPx)}px` : null;
}

/**
 * Publishes the dock's height as a CSS variable on its parent. Typing a new line changes a style, not React state,
 * so the conversation above does not render again.
 */
export function useComposerDockHeight(ref: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const el = ref.current;
    const host = el?.parentElement;
    if (!el || !host) return;
    const apply = () => {
      const value = composerDockHeightValue(el.getBoundingClientRect().height);
      if (value) host.style.setProperty("--composer-dock-h", value);
      else host.style.removeProperty("--composer-dock-h");
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(el);
    return () => {
      observer.disconnect();
      host.style.removeProperty("--composer-dock-h");
    };
  }, [ref]);
}
