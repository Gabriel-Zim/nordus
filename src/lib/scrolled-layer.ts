/** Screens whose header turns to glass once their content scrolls under it (CSS: `[data-scrolled] [data-layer-head]`). */
export const LAYER_ROOTS = "[data-stack-layer], [data-room-info], .glass-popup";

export function markScrolledLayer(scroller: Element): void {
  if (!(scroller instanceof HTMLElement) || !scroller.matches("[data-layer-body]")) return;
  const layer = scroller.closest<HTMLElement>(LAYER_ROOTS);
  if (!layer) return;
  const scrolled = scroller.scrollTop > 2;
  if (scrolled === layer.hasAttribute("data-scrolled")) return;
  layer.toggleAttribute("data-scrolled", scrolled);
}

/** One capturing listener for every layer: scroll events do not bubble, so each body's scroll is seen here. */
export function watchScrolledLayers(doc: Document = document): () => void {
  const onScroll = (event: Event) => {
    if (event.target instanceof Element) markScrolledLayer(event.target);
  };
  doc.addEventListener("scroll", onScroll, { capture: true, passive: true });
  return () => doc.removeEventListener("scroll", onScroll, { capture: true });
}
