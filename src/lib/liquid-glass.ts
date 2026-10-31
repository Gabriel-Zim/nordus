// The Nordus glass, after Apple's Liquid Glass (macOS and iOS 26): a translucent piece whose rim
// bends what is behind it like a lens. The look itself lives in styles.css (.nb-glass and the
// --lg-* tokens); this file adds the one thing CSS cannot: the lens, an SVG displacement filter
// that backdrop-filter points at through --lg-lens.
//
// Only engines that apply an SVG filter to the backdrop get it (Chromium: the Mac app, Chrome,
// Edge). It is detected by support, never by user agent: CSS.supports answers for the
// declaration, and WebKit (Safari, the iPhone app) answers no and keeps the blur, saturation,
// rim light and shadow that read as the same glass. Reduced transparency turns the lens off.
//
// The rim is the same few points wide on every piece, as on macOS, so each size of piece gets its
// own filter (sizes are rounded, so a screen needs only a handful).

export const LENS_SELECTOR = [
  ".nb-glass:not(.nb-glass--flat)",
  ".nb-pill",
  "[data-ios-glass-button]",
  "[data-chathead-pill]",
  '[data-chathead-controls] [data-testid="chat-more"]',
  "[data-layer-close]",
  "[data-glass-action]",
  "[data-composer-plus]",
].join(", ");

/** Points of rim that bend, and how far the rim reaches out for what it shows. */
export const LENS_RIM = 14;
export const LENS_BEND = 22;
const STEP = 4;

export function lensId(width: number, height: number): string {
  return `nb-lens-${width}x${height}`;
}

/** Sizes snap to a 4-point grid so pieces of nearly the same size share a filter. */
export function lensSize(width: number, height: number): { width: number; height: number } {
  const snap = (n: number) => Math.max(STEP * 2, Math.round(n / STEP) * STEP);
  return { width: snap(width), height: snap(height) };
}

/**
 * The displacement map for a piece of this size: red pushes sideways, green up and down, 0.5 is
 * still. The middle stays still; across the last `rim` points toward each edge the value ramps
 * away from 0.5, so the rim pulls in what lies just outside it, which reads as a lens bending
 * the background.
 */
export function lensMapSvg(width: number, height: number, rim = LENS_RIM): string {
  const pct = (n: number, of: number) => Math.round(Math.min(50, (n / of) * 100) * 100) / 100;
  const ax = pct(rim, width);
  const ay = pct(rim, height);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">`,
    `<defs>`,
    `<linearGradient id="x" x1="0" x2="1" y1="0" y2="0">`,
    `<stop offset="0%" stop-color="rgb(0,0,0)"/><stop offset="${ax}%" stop-color="rgb(128,0,0)"/>`,
    `<stop offset="${100 - ax}%" stop-color="rgb(128,0,0)"/><stop offset="100%" stop-color="rgb(255,0,0)"/>`,
    `</linearGradient>`,
    `<linearGradient id="y" x1="0" x2="0" y1="0" y2="1">`,
    `<stop offset="0%" stop-color="rgb(0,0,0)"/><stop offset="${ay}%" stop-color="rgb(0,128,0)"/>`,
    `<stop offset="${100 - ay}%" stop-color="rgb(0,128,0)"/><stop offset="100%" stop-color="rgb(0,255,0)"/>`,
    `</linearGradient>`,
    `</defs>`,
    `<rect width="${width}" height="${height}" fill="url(#x)"/>`,
    `<rect width="${width}" height="${height}" fill="url(#y)" style="mix-blend-mode:screen"/>`,
    `</svg>`,
  ].join("");
}

/** The filter a piece of this size points its backdrop at, in the piece's own points. */
export function lensFilterMarkup(width: number, height: number, bend = LENS_BEND): string {
  const href = `data:image/svg+xml,${encodeURIComponent(lensMapSvg(width, height))}`;
  return [
    `<filter id="${lensId(width, height)}" x="0" y="0" width="${width}" height="${height}" filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse" color-interpolation-filters="sRGB">`,
    `<feImage href="${href}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="none" result="map"/>`,
    `<feGaussianBlur in="map" stdDeviation="2" result="soft"/>`,
    `<feDisplacementMap in="SourceGraphic" in2="soft" scale="${bend}" xChannelSelector="R" yChannelSelector="G"/>`,
    `</filter>`,
  ].join("");
}

/** True where backdrop-filter takes an SVG filter (Chromium), so the rim can really bend. */
export function lensSupported(css: { supports?: (property: string, value: string) => boolean } | undefined = globalThis.CSS): boolean {
  try {
    return Boolean(css?.supports?.("backdrop-filter", "url(#nb-lens) blur(1px)"));
  } catch {
    return false;
  }
}

/**
 * The lens is off: the flat Nordus look has one light blur on the composer and the chat header and
 * nothing that bends, so no SVG filters, observers or hidden markup are installed. The helpers above
 * stay for anyone who wants to bring the lens back; this keeps the entry point and its cleanup.
 */
export function installLiquidGlass(doc: Document = document): () => void {
  delete doc.documentElement.dataset.glassLens;
  return () => {};
}
