import { describe, expect, it, vi } from "vitest";

import { ensureList, registerListLoader } from "./lazy-lists";

describe("lazy lists", () => {
  it("loads lists asked for before the store started once it registers, and later asks at once", () => {
    ensureList("routines");
    const load = vi.fn();
    const unregister = registerListLoader(load);
    expect(load).toHaveBeenCalledWith("routines");
    ensureList("webhooks");
    expect(load).toHaveBeenCalledWith("webhooks");
    unregister();
    ensureList("notifications");
    expect(load).not.toHaveBeenCalledWith("notifications");
  });
});
