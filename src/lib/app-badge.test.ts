import { afterEach, describe, expect, it, vi } from "vitest";
import { publishAppBadge } from "./app-badge";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("publishAppBadge", () => {
  it("sends the count to the Mac app when it is there", () => {
    const setBadge = vi.fn();
    const setAppBadge = vi.fn(() => Promise.resolve());
    vi.stubGlobal("window", { nordusShell: { setBadge } });
    vi.stubGlobal("navigator", { setAppBadge });
    publishAppBadge(3);
    expect(setBadge).toHaveBeenCalledWith(3);
    expect(setAppBadge).not.toHaveBeenCalled();
  });

  it("uses the Badging API in an installed web app and clears it at zero", () => {
    const setAppBadge = vi.fn(() => Promise.resolve());
    const clearAppBadge = vi.fn(() => Promise.resolve());
    vi.stubGlobal("window", {});
    vi.stubGlobal("navigator", { setAppBadge, clearAppBadge });
    publishAppBadge(2);
    publishAppBadge(0);
    expect(setAppBadge).toHaveBeenCalledWith(2);
    expect(clearAppBadge).toHaveBeenCalledTimes(1);
  });

  it("does nothing in a browser without badges", () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("navigator", {});
    expect(() => publishAppBadge(4)).not.toThrow();
  });
});
