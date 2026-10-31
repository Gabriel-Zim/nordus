import { describe, expect, it } from "vitest";
import { nextGridIndex } from "./SidebarPopoverMenu";

describe("arrow keys across a grid of tiles", () => {
  it("lands on the first tile going forward and the last going back, from nothing focused", () => {
    for (const key of ["ArrowRight", "ArrowDown"]) expect(nextGridIndex(key, -1, 5, 3)).toBe(0);
    for (const key of ["ArrowLeft", "ArrowUp"]) expect(nextGridIndex(key, -1, 5, 3)).toBe(4);
  });

  it("walks left and right in reading order, wrapping at the ends", () => {
    expect(nextGridIndex("ArrowRight", 2, 5, 3)).toBe(3);
    expect(nextGridIndex("ArrowRight", 4, 5, 3)).toBe(0);
    expect(nextGridIndex("ArrowLeft", 0, 5, 3)).toBe(4);
  });

  it("moves down a column, onto the short last row's end, and back to the top", () => {
    expect(nextGridIndex("ArrowDown", 0, 5, 3)).toBe(3);
    expect(nextGridIndex("ArrowDown", 2, 5, 3)).toBe(4);
    expect(nextGridIndex("ArrowDown", 4, 5, 3)).toBe(1);
  });

  it("moves up a column, and from the top row to the same column at the bottom", () => {
    expect(nextGridIndex("ArrowUp", 4, 5, 3)).toBe(1);
    expect(nextGridIndex("ArrowUp", 0, 5, 3)).toBe(3);
    expect(nextGridIndex("ArrowUp", 2, 5, 3)).toBe(4);
    expect(nextGridIndex("ArrowUp", 2, 6, 3)).toBe(5);
  });

  it("keeps Home and End, and ignores other keys", () => {
    expect(nextGridIndex("Home", 3, 5, 3)).toBe(0);
    expect(nextGridIndex("End", 0, 5, 3)).toBe(4);
    expect(nextGridIndex("a", 0, 5, 3)).toBeNull();
    expect(nextGridIndex("ArrowDown", -1, 0, 3)).toBeNull();
  });
});
