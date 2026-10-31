import { describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ tools: null as { xvfb: string; x11vnc: string } | null }));
vi.mock("./browser/native/display.ts", async (original) => ({ ...(await original<typeof import("./browser/native/display.ts")>()), nativeTools: () => native.tools }));

import { appliesBrowserViewport } from "./browser-runtime.ts";

describe("the fixed page size", () => {
  const env = { AGENT_BROWSER_HEADED: "1" };

  it("is applied to a windowed Chrome that has no display of its own", () => {
    native.tools = null;
    expect(appliesBrowserViewport(env)).toBe(true);
  });

  it("is left out of a native window, so the page fills it", () => {
    native.tools = { xvfb: "/usr/bin/Xvfb", x11vnc: "/usr/bin/x11vnc" };
    expect(appliesBrowserViewport(env)).toBe(false);
  });
});
