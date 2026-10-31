import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { RailCardData } from "./sidebar-preview";

export type RailAnchor = { right: number; top: number; height: number };

const OPEN_DELAY_MS = 120;
const LONG_PRESS_MS = 450;
const CARD_WIDTH = 280;
const CLOSE_GRACE_MS = 160;
const VIEWPORT_MARGIN = 8;

/** Where the card's top edge goes: centred on the avatar, but never past the top or bottom of the window. */
export function railCardTop(anchor: Pick<RailAnchor, "top" | "height">, cardHeight: number, viewportHeight: number): number {
  const centred = anchor.top + anchor.height / 2 - cardHeight / 2;
  return Math.max(VIEWPORT_MARGIN, Math.min(centred, viewportHeight - cardHeight - VIEWPORT_MARGIN));
}

/** Opens after a short hover or on keyboard focus, stays open while the pointer is on the avatar or the card, closes on Esc. */
export function useRailCardTrigger(enabled: boolean) {
  const [anchor, setAnchor] = useState<RailAnchor | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const onCard = useRef(false);
  // A touch held on the row opens the card (no hover on a phone) and must not also open the conversation or the menu.
  const pressTimer = useRef<number | undefined>(undefined);
  const longPressed = useRef(false);
  const clear = () => window.clearTimeout(timer.current);
  const measure = (element: Element): RailAnchor => {
    const rect = element.getBoundingClientRect();
    return { right: rect.right, top: rect.top, height: rect.height };
  };
  const open = (element: Element, delay: number) => {
    clear();
    timer.current = window.setTimeout(() => setAnchor(measure(element)), delay);
  };
  const close = (delay: number) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setAnchor(null), delay);
  };
  const hold = () => {
    onCard.current = true;
    window.clearTimeout(timer.current);
  };
  const release = () => {
    onCard.current = false;
    close(CLOSE_GRACE_MS);
  };

  useEffect(() => () => { window.clearTimeout(timer.current); window.clearTimeout(pressTimer.current); }, []);
  useEffect(() => {
    if (!enabled) setAnchor(null);
  }, [enabled]);
  useEffect(() => {
    if (!anchor) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      window.clearTimeout(timer.current);
      onCard.current = false;
      setAnchor(null);
    };
    // A tap or click anywhere else closes it (on a phone there is no pointer leaving to close it).
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest("[data-sidebar-rail-card]")) return;
      window.clearTimeout(timer.current);
      onCard.current = false;
      setAnchor(null);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [anchor]);

  return {
    anchor: enabled ? anchor : null,
    /** Spread on the element that wraps the avatar. */
    triggerProps: enabled
      ? {
          onMouseEnter: (event: React.MouseEvent<HTMLElement>) => open(event.currentTarget, OPEN_DELAY_MS),
          onMouseLeave: () => close(CLOSE_GRACE_MS),
          onFocus: (event: React.FocusEvent<HTMLElement>) => open(event.currentTarget, 0),
          // Pressing a button inside the card moves focus off the row; the card must outlive that.
          onBlur: () => {
            if (!onCard.current) close(0);
          },
          onTouchStart: (event: React.TouchEvent<HTMLElement>) => {
            longPressed.current = false;
            const element = event.currentTarget;
            window.clearTimeout(pressTimer.current);
            pressTimer.current = window.setTimeout(() => {
              longPressed.current = true;
              clear();
              setAnchor(measure(element));
            }, LONG_PRESS_MS);
          },
          onTouchMove: () => window.clearTimeout(pressTimer.current),
          onTouchEnd: (event: React.TouchEvent<HTMLElement>) => {
            window.clearTimeout(pressTimer.current);
            if (longPressed.current) event.preventDefault();
          },
        }
      : {},
    /** True while the last touch was a long press that opened the card, so the row skips its own menu and navigation. */
    wasLongPress: () => longPressed.current,
    cardProps: { onMouseEnter: hold, onMouseLeave: release },
  };
}

export function SidebarRailCard({
  anchor,
  data,
  avatar,
  onMouseEnter,
  onMouseLeave,
  children,
}: {
  anchor: RailAnchor | null;
  data: RailCardData;
  avatar: ReactNode;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  /** Room for what a card can offer to do, such as approval buttons. */
  children?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState<number | null>(null);
  // Beside the avatar when there is room; a row as wide as the window (a phone) gets the card just below it instead.
  const below = anchor ? anchor.right + CARD_WIDTH > window.innerWidth : false;
  useLayoutEffect(() => {
    if (!anchor || !ref.current) return;
    const height = ref.current.getBoundingClientRect().height;
    setTop(below
      ? Math.max(VIEWPORT_MARGIN, Math.min(anchor.top + anchor.height + 4, window.innerHeight - height - VIEWPORT_MARGIN))
      : railCardTop(anchor, height, window.innerHeight));
  }, [anchor, data, children, below]);
  if (!anchor) return null;
  const stateLine = data.state === "waiting" ? t("sidebar.preview.waiting") : data.state === "working" ? data.step ?? t("sidebar.preview.working") : "";
  return createPortal(
    // The outer box starts at the avatar's edge, so the 10px between avatar and card still counts as hovering.
    <div
      ref={ref}
      data-sidebar-rail-card=""
      data-kind={data.kind}
      data-state={data.state}
      className={cn("fixed z-[80] w-[17.5rem]", !below && "pl-2.5")}
      style={{
        left: below ? Math.max(VIEWPORT_MARGIN, window.innerWidth - CARD_WIDTH - VIEWPORT_MARGIN) : anchor.right,
        top: top ?? anchor.top,
        visibility: top === null ? "hidden" : undefined,
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div
        // With something to answer inside, the card is a small dialog; otherwise it only describes the row.
        role={children ? "dialog" : "tooltip"}
        aria-label={children ? data.name : undefined}
        className="rounded-[12px] border border-white/10 px-3 py-2.5 shadow-[0_18px_44px_-18px_rgba(0,0,0,0.7)]"
        style={{ background: "var(--color-menu)" }}
      >
        <div className="flex items-center gap-2">
          <span className="flex size-7 shrink-0 items-center justify-center">{avatar}</span>
          <span className="nb-name min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">{data.name}</span>
          {data.unread && <span className="size-2 shrink-0 rounded-full bg-unread" aria-label={t("task.unread")} />}
        </div>
        {data.preview && <div className="mt-1.5 line-clamp-2 text-[12.5px] leading-[17px] text-ink-secondary">{data.preview}</div>}
        {stateLine && (
          <div data-rail-card-state={data.state} className={cn("mt-1.5 text-[12px] leading-4", data.state === "waiting" ? "text-warning" : "text-ink-tertiary")}>{stateLine}</div>
        )}
        {children && <div data-rail-card-actions="" className="mt-2">{children}</div>}
      </div>
    </div>,
    document.body,
  );
}
