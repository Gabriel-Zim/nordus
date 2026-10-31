// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { visibleInterval } from "./visible-interval";

function show(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("visibleInterval", () => {
  beforeEach(() => { vi.useFakeTimers(); show("visible"); });
  afterEach(() => { vi.useRealTimers(); show("visible"); });

  it("ticks on the interval while the tab is visible", () => {
    const tick = vi.fn();
    const stop = visibleInterval(tick, 1_000);
    vi.advanceTimersByTime(3_000);
    expect(tick).toHaveBeenCalledTimes(3);
    stop();
  });

  it("does not tick while hidden and catches up once when it shows again", () => {
    const tick = vi.fn();
    const stop = visibleInterval(tick, 1_000);
    show("hidden");
    vi.advanceTimersByTime(60_000);
    expect(tick).not.toHaveBeenCalled();
    show("visible");
    expect(tick).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1_000);
    expect(tick).toHaveBeenCalledTimes(2);
    stop();
  });

  it("stays quiet after it is stopped", () => {
    const tick = vi.fn();
    const stop = visibleInterval(tick, 1_000);
    stop();
    vi.advanceTimersByTime(5_000);
    show("hidden");
    show("visible");
    expect(tick).not.toHaveBeenCalled();
  });
});
