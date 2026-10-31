import { useLayoutEffect, type RefObject } from "react";

/**
 * A name in a header capsule: whole at its own size when it fits; a step smaller when it does not;
 * cut with an ellipsis only if even that is too wide.
 */
export function useFitName(ref: RefObject<HTMLElement | null>, text: string, smallerPx = 14): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      el.style.removeProperty("font-size");
      if (el.scrollWidth > el.clientWidth + 1) el.style.fontSize = `${smallerPx}px`;
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el.parentElement ?? el);
    return () => observer.disconnect();
  }, [ref, text, smallerPx]);
}
