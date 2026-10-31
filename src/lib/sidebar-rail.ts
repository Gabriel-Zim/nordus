import type { SidebarDensity } from "./sidebar-preferences";

/** Releasing the divider with the pointer left of this x (relative to the sidebar) collapses the list to the rail. */
export const SIDEBAR_COLLAPSE_BELOW = 180;

/** The rail's own width, matching the `w-[80px]` the collapsed sidebar draws. */
export const SIDEBAR_RAIL_WIDTH = 80;

export type DividerRelease = "collapse" | "expand" | "keep";

/** What letting go of the divider does. `from` is the density the drag started in; `x` is the pointer's distance from the sidebar's left edge. */
export function dividerRelease(from: "list" | "rail", x: number): DividerRelease {
  if (from === "list") return x < SIDEBAR_COLLAPSE_BELOW ? "collapse" : "keep";
  return x > SIDEBAR_COLLAPSE_BELOW ? "expand" : "keep";
}

/** The density the sidebar draws. The rail is a desktop layout: on a phone the list always stays full screen. */
export function effectiveSidebarDensity({ stored, forceRail, desktop }: { stored: SidebarDensity; forceRail: boolean; desktop: boolean }): SidebarDensity {
  if (!desktop) return stored === "icons" ? "comfortable" : stored;
  return forceRail ? "icons" : stored;
}

/** Cmd/Ctrl + backslash, with no Shift or Alt (AltGr layouts type a backslash with Ctrl+Alt). */
export function isSidebarToggleShortcut(event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey" | "isComposing">): boolean {
  return event.key === "\\" && (event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && !event.isComposing;
}

/** The divider between sidebar and chat: invisible at rest, a 1px neutral line while hovered, focused or dragged. Never the accent. */
export const SIDEBAR_RESIZE_HANDLE_CLASS =
  "absolute inset-y-0 -right-1 z-20 hidden w-2 cursor-col-resize touch-none outline-none md:block " +
  "before:absolute before:inset-y-0 before:left-1/2 before:w-px before:-translate-x-1/2 before:bg-transparent before:transition-colors " +
  "hover:before:bg-hairline focus-visible:before:bg-hairline data-[dragging]:before:bg-hairline";
