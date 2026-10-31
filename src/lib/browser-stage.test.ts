// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { BROWSER_STAGE_EVENT, openBrowserStage, takeAnyPendingBrowserStage } from "./browser-stage";

describe("openBrowserStage", () => {
  it("announces the stage for the bot and leaves it pending for a host that is still loading", () => {
    const heard = vi.fn();
    window.addEventListener(BROWSER_STAGE_EVENT, heard);
    openBrowserStage("pepper");
    window.removeEventListener(BROWSER_STAGE_EVENT, heard);
    expect((heard.mock.calls[0]![0] as CustomEvent).detail).toEqual({ botId: "pepper" });
    expect(takeAnyPendingBrowserStage()).toBe("pepper");
    expect(takeAnyPendingBrowserStage()).toBeNull();
  });
});
