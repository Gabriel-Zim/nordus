// A segmented control (and tab bar) in the Nordus glass, measured on WhatsApp for iOS 26
// (nordus-ai/estudo_glass-anim/ANALISE.md, item 4): at rest the chosen option sits on a flat
// translucent pill. Under a finger the pill lifts into a lens larger than the bar that magnifies
// what is under it 1.15x, with a thin rainbow fringe at its rim; it follows a dragging finger,
// travels to the new option on a 250 ms spring and lands back into a flat pill in 150 ms.
//
// The lens magnifies by carrying a copy of the options inside it, scaled about its own centre, so
// it works the same in every engine (no backdrop-filter needed). With prefers-reduced-motion the
// pill just moves, without the lens.
import { useCallback, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { cn } from "@/lib/cn";
import { haptic } from "@/lib/ios-motion";

export interface GlassSegment<V extends string> {
  value: V;
  label: ReactNode;
  disabled?: boolean;
}

/** Magnification inside the lens, and how much bigger than the pill the lens is. */
export const LENS_ZOOM = 1.15;
export const LENS_LIFT = { x: 1.1, y: 1.3 };

/** The option under a point, from the options' left edges and widths along the bar. */
export function segmentAt(x: number, edges: readonly { left: number; width: number }[]): number {
  if (edges.length === 0) return -1;
  let best = 0;
  let bestDistance = Infinity;
  edges.forEach((edge, index) => {
    const centre = edge.left + edge.width / 2;
    const distance = Math.abs(x - centre);
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  });
  return best;
}

/**
 * Where the magnified copy sits inside the lens so that what shows through the lens is the bar
 * beneath, grown `zoom` times about the lens centre (the lens itself is scaled `lift`).
 */
export function lensCopyTransform(lens: { left: number; top: number; width: number; height: number }, lift: { x: number; y: number }, zoom = LENS_ZOOM) {
  const cx = lens.left + lens.width / 2;
  const cy = lens.top + lens.height / 2;
  return {
    left: -lens.left,
    top: -lens.top,
    origin: `${cx}px ${cy}px`,
    transform: `scale(${Math.round((zoom / lift.x) * 1000) / 1000}, ${Math.round((zoom / lift.y) * 1000) / 1000})`,
  };
}

export function GlassSegmented<V extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
  role = "radiogroup",
}: {
  options: readonly GlassSegment<V>[];
  value: V;
  onChange: (value: V) => void;
  ariaLabel: string;
  className?: string;
  /** "tablist" for a tab bar; the options then are tabs. */
  role?: "radiogroup" | "tablist";
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const [pill, setPill] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const [lens, setLens] = useState<{ left: number; on: boolean; moving: boolean }>({ left: 0, on: false, moving: false });
  const drag = useRef<{ start: number; offset: number; index: number } | null>(null);
  const active = Math.max(0, options.findIndex((option) => option.value === value));
  const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

  const edges = useCallback(() => buttons.current.map((button) => ({ left: button?.offsetLeft ?? 0, width: button?.offsetWidth ?? 0 })), []);

  useLayoutEffect(() => {
    const button = buttons.current[active];
    if (!button) return;
    const place = () => setPill({ left: button.offsetLeft, top: button.offsetTop, width: button.offsetWidth, height: button.offsetHeight });
    place();
    const sizes = typeof ResizeObserver === "function" ? new ResizeObserver(place) : null;
    if (rowRef.current) sizes?.observe(rowRef.current);
    return () => sizes?.disconnect();
  }, [active, options.length]);

  const choose = (index: number) => {
    const option = options[index];
    if (!option || option.disabled || option.value === value) return;
    haptic("selection");
    onChange(option.value);
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !pill || reduced) return;
    const row = rowRef.current;
    if (!row) return;
    const x = event.clientX - row.getBoundingClientRect().left;
    const index = segmentAt(x, edges());
    drag.current = { start: x, offset: pill.left - x, index };
    row.setPointerCapture(event.pointerId);
    setLens({ left: pill.left, on: true, moving: false });
  };
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    const row = rowRef.current;
    if (!current || !row || !pill) return;
    const x = event.clientX - row.getBoundingClientRect().left;
    const max = row.clientWidth - pill.width;
    setLens({ left: Math.max(0, Math.min(max, x + current.offset)), on: true, moving: true });
    current.index = segmentAt(x, edges());
  };
  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    drag.current = null;
    if (!current) return;
    rowRef.current?.releasePointerCapture?.(event.pointerId);
    const row = rowRef.current;
    const x = row ? event.clientX - row.getBoundingClientRect().left : current.start;
    const index = Math.abs(x - current.start) < 4 ? segmentAt(x, edges()) : current.index;
    choose(index);
    // The lens lands where the pill goes, then flattens back into it.
    const target = buttons.current[index]?.offsetLeft ?? pill?.left ?? 0;
    setLens({ left: target, on: true, moving: true });
    window.setTimeout(() => setLens((lens) => ({ ...lens, on: false, moving: false })), 250);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const step = event.key === "ArrowRight" ? 1 : -1;
    let next = active;
    for (let i = 0; i < options.length; i++) {
      next = (next + step + options.length) % options.length;
      if (!options[next]?.disabled) break;
    }
    choose(next);
    buttons.current[next]?.focus();
  };

  const lensBox = pill ? { left: lens.on ? lens.left : pill.left, top: pill.top, width: pill.width, height: pill.height } : null;
  const copy = lensBox ? lensCopyTransform(lensBox, LENS_LIFT) : null;
  const row = (copyMode: boolean) =>
    options.map((option, index) => (
      <button
        key={option.value}
        ref={copyMode ? undefined : (el) => { buttons.current[index] = el; }}
        type="button"
        tabIndex={copyMode ? -1 : index === active ? 0 : -1}
        role={copyMode ? undefined : role === "tablist" ? "tab" : "radio"}
        aria-selected={copyMode || role !== "tablist" ? undefined : index === active}
        aria-checked={copyMode || role === "tablist" ? undefined : index === active}
        disabled={option.disabled}
        data-glass-segment={option.value}
        className={cn("nb-segment-option", index === active && "nb-segment-option--on")}
        // A finger is handled by the lens above; a keyboard press (detail 0) or reduced motion clicks.
        onClick={copyMode ? undefined : (event) => { if (reduced || event.detail === 0) choose(index); }}
      >
        {option.label}
      </button>
    ));

  return (
    <div
      ref={rowRef}
      role={role}
      aria-label={ariaLabel}
      data-glass-segmented=""
      className={cn("nb-segmented", className)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
    >
      {lensBox && (
        <span
          aria-hidden="true"
          data-glass-segment-pill=""
          data-lens={lens.on ? "" : undefined}
          data-moving={lens.moving ? "" : undefined}
          className="nb-segment-pill"
          style={{
            left: 0,
            top: lensBox.top,
            width: lensBox.width,
            height: lensBox.height,
            transform: `translateX(${lensBox.left}px) scale(${lens.on ? `${LENS_LIFT.x}, ${LENS_LIFT.y}` : "1, 1"})`,
          }}
        >
          {lens.on && copy && (
            <span className="nb-segment-copy" style={{ left: copy.left, top: copy.top, transformOrigin: copy.origin, transform: copy.transform }}>
              {row(true)}
            </span>
          )}
        </span>
      )}
      {row(false)}
    </div>
  );
}
