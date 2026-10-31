import { describe, expect, it } from "vitest";

import { POOLS } from "./CursorAvatar";
import { CURSOR_STATES } from "./cursor-state";

describe("CURSOR_STATES", () => {
  it("lists every state the expression pools define, in their order", () => {
    expect(CURSOR_STATES).toEqual(Object.keys(POOLS));
  });
});
