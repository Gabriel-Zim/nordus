import { describe, expect, it } from "vitest";

import {
  dividerRelease,
  effectiveSidebarDensity,
  isSidebarToggleShortcut,
  SIDEBAR_COLLAPSE_BELOW,
  SIDEBAR_RESIZE_HANDLE_CLASS,
} from "./sidebar-rail";

describe("dragging the divider", () => {
  it("collapses the list when it is released left of the threshold", () => {
    expect(dividerRelease("list", SIDEBAR_COLLAPSE_BELOW - 1)).toBe("collapse");
    expect(dividerRelease("list", 40)).toBe("collapse");
  });

  it("keeps the list when it is released at or past the threshold", () => {
    expect(dividerRelease("list", SIDEBAR_COLLAPSE_BELOW)).toBe("keep");
    expect(dividerRelease("list", 320)).toBe("keep");
  });

  it("expands the rail when it is dragged right past the threshold", () => {
    expect(dividerRelease("rail", SIDEBAR_COLLAPSE_BELOW + 1)).toBe("expand");
    expect(dividerRelease("rail", 400)).toBe("expand");
  });

  it("leaves the rail alone for a small drag or a plain click", () => {
    expect(dividerRelease("rail", 80)).toBe("keep");
    expect(dividerRelease("rail", SIDEBAR_COLLAPSE_BELOW)).toBe("keep");
  });
});

describe("the density the sidebar draws", () => {
  it("draws what the person chose on a desktop", () => {
    expect(effectiveSidebarDensity({ stored: "icons", forceRail: false, desktop: true })).toBe("icons");
    expect(effectiveSidebarDensity({ stored: "compact", forceRail: false, desktop: true })).toBe("compact");
  });

  it("collapses to the rail while side panels force it, without touching the choice", () => {
    expect(effectiveSidebarDensity({ stored: "comfortable", forceRail: true, desktop: true })).toBe("icons");
  });

  it("ignores the rail on a phone, where the list stays full screen", () => {
    expect(effectiveSidebarDensity({ stored: "icons", forceRail: false, desktop: false })).toBe("comfortable");
    expect(effectiveSidebarDensity({ stored: "icons", forceRail: true, desktop: false })).toBe("comfortable");
    expect(effectiveSidebarDensity({ stored: "compact", forceRail: false, desktop: false })).toBe("compact");
  });
});

describe("the collapse shortcut", () => {
  const press = (init: Partial<Parameters<typeof isSidebarToggleShortcut>[0]>) =>
    isSidebarToggleShortcut({ key: "\\", metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, isComposing: false, ...init });

  it("is Cmd or Ctrl with a backslash", () => {
    expect(press({ metaKey: true })).toBe(true);
    expect(press({ ctrlKey: true })).toBe(true);
  });

  it("ignores a bare backslash, other keys, Shift, Alt and composition", () => {
    expect(press({})).toBe(false);
    expect(press({ metaKey: true, key: "/" })).toBe(false);
    expect(press({ metaKey: true, shiftKey: true })).toBe(false);
    expect(press({ ctrlKey: true, altKey: true })).toBe(false);
    expect(press({ metaKey: true, isComposing: true })).toBe(false);
  });
});

describe("the divider's look", () => {
  it("never paints the accent, at rest or on hover, focus or drag", () => {
    expect(SIDEBAR_RESIZE_HANDLE_CLASS).not.toMatch(/accent/);
    expect(SIDEBAR_RESIZE_HANDLE_CLASS).not.toMatch(/(^|\s)(hover:|focus-visible:)?bg-/);
  });

  it("shows a 1px neutral line only while hovered, focused or dragged", () => {
    expect(SIDEBAR_RESIZE_HANDLE_CLASS).toContain("before:w-px");
    expect(SIDEBAR_RESIZE_HANDLE_CLASS).toContain("before:bg-transparent");
    for (const state of ["hover:", "focus-visible:", "data-[dragging]:"]) expect(SIDEBAR_RESIZE_HANDLE_CLASS).toContain(`${state}before:bg-hairline`);
  });
});
