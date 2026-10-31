import { describe, expect, it, vi } from "vitest";

import type { Cdp, CdpListeners } from "../../browser-sites.ts";
import { NO_PASSKEY_AUTHENTICATOR } from "../cdp/passkeys.ts";
import type { ChromeIdentity } from "./identity.ts";
import { IdentitySidecars, startIdentitySidecar } from "./sidecar.ts";

const IDENTITY: ChromeIdentity = {
  userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36",
  userAgentMetadata: {
    brands: [{ brand: "Chromium", version: "153" }], fullVersionList: [{ brand: "Chromium", version: "153.0.8010.47" }], fullVersion: "153.0.8010.47",
    platform: "macOS", platformVersion: "26.3.1", architecture: "arm", model: "", mobile: false, bitness: "64", wow64: false, formFactors: ["Desktop"],
  },
};

/** A browser connection that records what is sent and lets the test attach targets. */
function fakeBrowser() {
  const sent: Array<{ method: string; params?: Record<string, unknown>; sessionId?: string }> = [];
  let listeners: CdpListeners = {};
  const cdp: Cdp = {
    send: async (method, params, sessionId) => { sent.push({ method, params, sessionId }); return {}; },
    close: () => listeners.closed?.(),
  };
  const connect = vi.fn(async (_url: string, _timeoutMs?: number, given: CdpListeners = {}) => { listeners = given; return cdp; });
  const attach = (sessionId: string, type: string, parent?: string) =>
    listeners.event?.({ method: "Target.attachedToTarget", params: { sessionId, targetInfo: { type, url: "" }, waitingForDebugger: true }, ...(parent ? { sessionId: parent } : {}) });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  const on = (sessionId: string) => sent.filter((message) => message.sessionId === sessionId).map((message) => message.method);
  return { sent, connect, attach, settle, on, drop: () => listeners.closed?.() };
}

describe("the identity sidecar for a windowed Chrome on its own display", () => {
  function windowed(bounds: Record<string, unknown>) {
    const sent: Array<{ method: string; params?: Record<string, unknown> }> = [];
    let listeners: CdpListeners = {};
    const cdp: Cdp = {
      send: async (method, params) => {
        sent.push({ method, params });
        if (method === "Browser.getWindowForTarget") return { windowId: 7 };
        if (method === "Browser.getWindowBounds") return { bounds };
        return {};
      },
      close: () => listeners.closed?.(),
    };
    const connect = vi.fn(async (_url: string, _timeoutMs?: number, given: CdpListeners = {}) => { listeners = given; return cdp; });
    const page = (targetId: string, url: string, method = "Target.targetCreated") => listeners.event?.({ method, params: { targetInfo: { targetId, type: "page", url } } });
    return { sent, connect, page, drop: () => listeners.closed?.() };
  }
  const SIZE = { width: 1440, height: 900 };

  it("puts the window back over the whole display when anything resizes it, and leaves it alone when it fits", async () => {
    vi.useFakeTimers();
    try {
      const small = windowed({ left: 0, top: 0, width: 1280, height: 808, windowState: "normal" });
      const sidecar = await startIdentitySidecar("ws://127.0.0.1:9/x", { ...IDENTITY, window: SIZE }, small.connect);
      small.page("t1", "https://x.com/");
      await vi.advanceTimersByTimeAsync(1600);
      expect(small.sent).toContainEqual({ method: "Browser.setWindowBounds", params: { windowId: 7, bounds: { left: 0, top: 0, width: 1440, height: 900 } } });
      sidecar.close();
      const fits = windowed({ left: 0, top: 0, width: 1440, height: 900, windowState: "normal" });
      await startIdentitySidecar("ws://127.0.0.1:9/x", { ...IDENTITY, window: SIZE }, fits.connect);
      fits.page("t1", "https://x.com/");
      await vi.advanceTimersByTimeAsync(3200);
      expect(fits.sent.some((message) => message.method === "Browser.setWindowBounds")).toBe(false);
    } finally { vi.useRealTimers(); }
  });

  it("clears any emulated viewport on each new page, so the page fills the real window", async () => {
    const browser = fakeBrowser();
    await startIdentitySidecar("ws://127.0.0.1:9/x", { ...IDENTITY, window: SIZE }, browser.connect);
    browser.attach("p1", "page");
    browser.attach("w1", "service_worker");
    await browser.settle();
    expect(browser.on("p1")).toContain("Emulation.clearDeviceMetricsOverride");
    expect(browser.on("w1")).not.toContain("Emulation.clearDeviceMetricsOverride");
    const plain = fakeBrowser();
    await startIdentitySidecar("ws://127.0.0.1:9/x", IDENTITY, plain.connect);
    plain.attach("p1", "page");
    await plain.settle();
    expect(plain.on("p1")).not.toContain("Emulation.clearDeviceMetricsOverride");
  });

  it("closes the empty tab beside the bot's page after a short grace, never the only tab and never a tab the bot is about to use", async () => {
    vi.useFakeTimers();
    try {
      const browser = windowed({ left: 0, top: 0, width: 1440, height: 900, windowState: "normal" });
      await startIdentitySidecar("ws://127.0.0.1:9/x", { ...IDENTITY, window: SIZE }, browser.connect);
      browser.page("blank", "chrome://newtab/");
      await vi.advanceTimersByTimeAsync(6000);
      expect(browser.sent.some((message) => message.method === "Target.closeTarget")).toBe(false);
      browser.page("site", "https://x.com/");
      await vi.advanceTimersByTimeAsync(1600);
      expect(browser.sent.filter((message) => message.method === "Target.closeTarget")).toEqual([{ method: "Target.closeTarget", params: { targetId: "blank" } }]);
      browser.page("fresh", "about:blank");
      await vi.advanceTimersByTimeAsync(1600);
      browser.page("fresh", "https://example.com/", "Target.targetInfoChanged");
      await vi.advanceTimersByTimeAsync(6000);
      expect(browser.sent.filter((message) => message.method === "Target.closeTarget")).toHaveLength(1);
    } finally { vi.useRealTimers(); }
  });
});

describe("the identity sidecar on a server with no GPU", () => {
  it("gives every page and frame the chip's WebGL identity before it runs, and sends no chip field to workers", async () => {
    const browser = fakeBrowser();
    const gpu = { vendor: "Google Inc. (Intel)", renderer: "ANGLE (Intel, Mesa Intel(R) UHD Graphics 630 (CFL GT2), OpenGL 4.6)" };
    await startIdentitySidecar("ws://127.0.0.1:9/devtools/browser/x", { ...IDENTITY, gpu }, browser.connect);
    browser.attach("page-1", "page");
    browser.attach("frame-1", "iframe", "page-1");
    browser.attach("sw-1", "service_worker");
    await browser.settle();
    expect(browser.on("page-1")).toEqual(["Emulation.setUserAgentOverride", "Page.addScriptToEvaluateOnNewDocument", "Target.setAutoAttach", "Runtime.runIfWaitingForDebugger"]);
    expect(browser.on("frame-1")).toContain("Page.addScriptToEvaluateOnNewDocument");
    expect(browser.on("sw-1")).not.toContain("Page.addScriptToEvaluateOnNewDocument");
    const script = browser.sent.find((message) => message.method === "Page.addScriptToEvaluateOnNewDocument")?.params?.source as string;
    expect(script).toContain(JSON.stringify(gpu.renderer));
    for (const message of browser.sent.filter((candidate) => /UserAgentOverride/u.test(candidate.method))) expect(message.params).not.toHaveProperty("gpu");
  });
});

describe("the identity sidecar", () => {
  it("holds every new page and worker until it has the browser's own identity, then lets it run", async () => {
    const browser = fakeBrowser();
    await startIdentitySidecar("ws://127.0.0.1:9/devtools/browser/x", IDENTITY, browser.connect);
    expect(browser.sent[0]).toEqual({ method: "Target.setAutoAttach", sessionId: undefined, params: {
      autoAttach: true, waitForDebuggerOnStart: true, flatten: true,
      filter: [{ type: "page" }, { type: "service_worker" }, { type: "shared_worker" }, { exclude: true }],
    } });
    browser.attach("page-1", "page");
    browser.attach("frame-1", "iframe", "page-1");
    browser.attach("sw-1", "service_worker");
    browser.attach("worker-1", "worker", "page-1");
    await browser.settle();
    expect(browser.on("page-1")).toEqual(["Emulation.setUserAgentOverride", "Target.setAutoAttach", "Runtime.runIfWaitingForDebugger"]);
    expect(browser.on("frame-1")).toEqual(["Emulation.setUserAgentOverride", "Target.setAutoAttach", "Runtime.runIfWaitingForDebugger"]);
    expect(browser.on("sw-1")).toEqual(["Emulation.setUserAgentOverride", "Network.setUserAgentOverride", "Runtime.runIfWaitingForDebugger"]);
    expect(browser.on("worker-1")).toEqual(["Network.setUserAgentOverride", "Runtime.runIfWaitingForDebugger"]);
    const override = browser.sent.find((message) => message.sessionId === "page-1" && message.method === "Emulation.setUserAgentOverride");
    expect(override?.params).toEqual({ userAgent: IDENTITY.userAgent, userAgentMetadata: IDENTITY.userAgentMetadata });
    expect(browser.sent.find((message) => message.sessionId === "page-1" && message.method === "Target.setAutoAttach")?.params).toEqual({ autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
  });

  it("gives a headless browser's pages an authenticator with no passkey before they run, so a passkey request ends at once", async () => {
    const headless = fakeBrowser();
    await startIdentitySidecar("ws://127.0.0.1:9/devtools/browser/x", IDENTITY, headless.connect, { noPasskeys: true });
    headless.attach("page-1", "page");
    headless.attach("frame-1", "iframe", "page-1");
    await headless.settle();
    expect(headless.on("page-1")).toEqual(["WebAuthn.enable", "WebAuthn.addVirtualAuthenticator", "Emulation.setUserAgentOverride", "Target.setAutoAttach", "Runtime.runIfWaitingForDebugger"]);
    expect(headless.sent.find((message) => message.method === "WebAuthn.enable")?.params).toEqual({ enableUI: false });
    expect(headless.sent.find((message) => message.method === "WebAuthn.addVirtualAuthenticator")?.params).toEqual({ options: NO_PASSKEY_AUTHENTICATOR });
    expect(NO_PASSKEY_AUTHENTICATOR).toMatchObject({ isUserVerified: false, automaticPresenceSimulation: true });
    expect(headless.on("frame-1")).not.toContain("WebAuthn.enable");
    const headed = fakeBrowser();
    await startIdentitySidecar("ws://127.0.0.1:9/devtools/browser/x", IDENTITY, headed.connect);
    headed.attach("page-1", "page");
    await headed.settle();
    expect(headed.on("page-1")).not.toContain("WebAuthn.enable");
  });

  it("never sends the calls sites detect, whatever attaches", async () => {
    const browser = fakeBrowser();
    await startIdentitySidecar("ws://127.0.0.1:9/devtools/browser/x", IDENTITY, browser.connect);
    for (const [index, type] of ["page", "iframe", "worker", "service_worker", "shared_worker", "other"].entries()) browser.attach(`s${index}`, type);
    await browser.settle();
    const methods = new Set(browser.sent.map((message) => message.method));
    expect([...methods].sort()).toEqual(["Emulation.setUserAgentOverride", "Network.setUserAgentOverride", "Runtime.runIfWaitingForDebugger", "Target.setAutoAttach"]);
    expect(browser.on("s5")).toEqual(["Runtime.runIfWaitingForDebugger"]);
  });
});

describe("one sidecar per browser session", () => {
  const spec = { command: "/engine/agent-browser", env: { AGENT_BROWSER_HEADLESS: "1" } };

  it("attaches once, and again after the browser was started anew", async () => {
    const browsers = [fakeBrowser(), fakeBrowser()];
    const cdpUrl = vi.fn(async () => "ws://127.0.0.1:9/devtools/browser/x");
    let started = 0;
    const sidecars = new IdentitySidecars({ cdpUrl, start: (url, identity) => startIdentitySidecar(url, identity, browsers[started++]!.connect) });
    await Promise.all([sidecars.ensure("bot-1", spec, IDENTITY), sidecars.ensure("bot-1", spec, IDENTITY)]);
    await sidecars.ensure("bot-1", spec, IDENTITY);
    expect(cdpUrl).toHaveBeenCalledOnce();
    expect(sidecars.attached("bot-1")).toBe(true);
    browsers[0]!.drop();
    await browsers[0]!.settle();
    expect(sidecars.attached("bot-1")).toBe(false);
    await sidecars.ensure("bot-1", spec, IDENTITY);
    expect(cdpUrl).toHaveBeenCalledTimes(2);
    expect(browsers[1]!.connect).toHaveBeenCalledOnce();
    sidecars.forget("bot-1");
    expect(sidecars.attached("bot-1")).toBe(false);
  });

  it("turns passkeys down in a headless session's browser only", async () => {
    const start = vi.fn(async () => ({ closed: new Promise<void>(() => {}), close: () => {} }));
    const sidecars = new IdentitySidecars({ cdpUrl: async () => "ws://127.0.0.1:9/devtools/browser/x", start });
    await sidecars.ensure("bot-1", spec, IDENTITY);
    await sidecars.ensure("bot-2", { ...spec, env: {} }, IDENTITY);
    expect(start.mock.calls.map((call) => (call as unknown[])[3])).toEqual([{ noPasskeys: true }, { noPasskeys: false }]);
  });

  it("does nothing when the session has no browser to reach", async () => {
    const start = vi.fn();
    const sidecars = new IdentitySidecars({ cdpUrl: async () => null, start });
    await sidecars.ensure("bot-1", spec, IDENTITY);
    expect(start).not.toHaveBeenCalled();
    expect(sidecars.attached("bot-1")).toBe(false);
  });
});
