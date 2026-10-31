// A second CDP connection to the browser agent-browser started: every page, cross-site frame and worker gets the browser's
// own identity before it runs (auto-attach paused on start), so no page or worker ever reads "HeadlessChrome". It sends
// nothing but the override and the release; never Runtime.enable, the call sites detect (deviceandbrowserinfo, Chrome 153).
import { execFile } from "node:child_process";

import { inRunningBrowser } from "../../browser-engine.ts";
import { browserRuntimeEnv } from "../../browser-runtime.ts";
import { connectCdp, type Cdp, type CdpEvent } from "../../browser-sites.ts";
import { NO_PASSKEY_COMMANDS } from "../cdp/passkeys.ts";
import { webglIdentityScript, type GpuIdentity } from "./gpu.ts";
import type { ChromeIdentity } from "./identity.ts";

/** The pages and workers the browser session attaches to itself; frames and dedicated workers come through their page. */
const BROWSER_TARGETS = [{ type: "page" }, { type: "service_worker" }, { type: "shared_worker" }, { exclude: true }];
const PAUSED_ON_START = { autoAttach: true, waitForDebuggerOnStart: true, flatten: true };

export interface IdentitySidecar {
  /** Resolves when the browser closes the connection: it exited, or was replaced. */
  closed: Promise<void>;
  close(): void;
}

export interface SidecarOptions {
  /** A headless browser's tabs: passkey requests end at once as unavailable (../cdp/passkeys.ts). */
  noPasskeys?: boolean;
}

/** The browser's identity, and the languages its pages are told (a list, see languageList in ./wrapper.ts). */
export type SidecarIdentity = ChromeIdentity & {
  acceptLanguage?: string;
  gpu?: GpuIdentity;
  /** A windowed Chrome on its own display (../native/display.ts): its window fills that display and no empty tab is left beside the bot's pages. */
  window?: { width: number; height: number };
};

const BLANK = /^(?:about:blank|chrome:\/\/newtab\/?|chrome:\/\/new-tab-page\/?|chrome-search:\/\/local-ntp\/.*)$/u;
const WINDOW_EVERY_MS = 1_500;
const BLANK_GRACE_MS = 4_000;

/** Keeps the window at the display's size, whoever resized it (agent-browser sets its own page size), and closes the empty tab Chrome
 * opens at launch once the bot has a real page. A blank tab is given a few seconds first: the bot may be about to use it. */
function keepWindow(cdp: Cdp, size: { width: number; height: number }): { event: (message: CdpEvent) => void; stop: () => void } {
  const pages = new Map<string, { url: string; blankSince: number | null; windowId?: number }>();
  const note = (info: { targetId?: string; type?: string; url?: string } | undefined) => {
    if (!info || info.type !== "page" || typeof info.targetId !== "string") return;
    const url = info.url ?? "";
    const known = pages.get(info.targetId);
    const blank = BLANK.test(url);
    const entry = known ?? { url, blankSince: null as number | null };
    entry.url = url;
    entry.blankSince = blank ? entry.blankSince ?? Date.now() : null;
    pages.set(info.targetId, entry);
    if (!known) void cdp.send("Browser.getWindowForTarget", { targetId: info.targetId }).then((answer) => {
      const id = (answer as { windowId?: number } | undefined)?.windowId;
      if (typeof id === "number") entry.windowId = id;
    }).catch(() => undefined);
  };
  const tick = async () => {
    const windows = new Set([...pages.values()].flatMap((page) => page.windowId === undefined ? [] : [page.windowId]));
    for (const windowId of windows) {
      try {
        const { bounds } = await cdp.send("Browser.getWindowBounds", { windowId }) as { bounds?: { left?: number; top?: number; width?: number; height?: number; windowState?: string } };
        if (bounds && (bounds.left !== 0 || bounds.top !== 0 || bounds.width !== size.width || bounds.height !== size.height || bounds.windowState !== "normal")) {
          if (bounds.windowState && bounds.windowState !== "normal") await cdp.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "normal" } });
          await cdp.send("Browser.setWindowBounds", { windowId, bounds: { left: 0, top: 0, width: size.width, height: size.height } });
        }
      } catch {}
    }
    const real = [...pages.values()].some((page) => /^https?:/u.test(page.url));
    if (!real || pages.size < 2) return;
    for (const [targetId, page] of pages) {
      if (page.blankSince !== null && Date.now() - page.blankSince >= BLANK_GRACE_MS && pages.size > 1) {
        pages.delete(targetId);
        void cdp.send("Target.closeTarget", { targetId }).catch(() => undefined);
      }
    }
  };
  const timer = setInterval(() => { void tick(); }, WINDOW_EVERY_MS);
  timer.unref?.();
  void cdp.send("Target.setDiscoverTargets", { discover: true }).catch(() => undefined);
  return {
    event: (message) => {
      const params = (message.params ?? {}) as { targetInfo?: { targetId?: string; type?: string; url?: string }; targetId?: string };
      if (message.method === "Target.targetCreated" || message.method === "Target.targetInfoChanged") note(params.targetInfo);
      else if (message.method === "Target.targetDestroyed" && params.targetId) pages.delete(params.targetId);
    },
    stop: () => clearInterval(timer),
  };
}

export async function startIdentitySidecar(url: string, identity: SidecarIdentity, connect: typeof connectCdp = connectCdp, options: SidecarOptions = {}): Promise<IdentitySidecar> {
  let onClosed!: () => void;
  const closed = new Promise<void>((resolve) => { onClosed = resolve; });
  let cdp: Cdp | null = null;
  let window: ReturnType<typeof keepWindow> | null = null;
  const configure = (message: CdpEvent) => {
    window?.event(message);
    if (message.method !== "Target.attachedToTarget" || !cdp) return;
    const { sessionId, targetInfo } = (message.params ?? {}) as { sessionId?: string; targetInfo?: { type?: string } };
    if (typeof sessionId === "string") void applyIdentity(cdp, sessionId, targetInfo?.type ?? "", identity, options);
  };
  cdp = await connect(url, 15_000, { event: configure, closed: () => { window?.stop(); onClosed(); } });
  if (identity.window) window = keepWindow(cdp, identity.window);
  try {
    await cdp.send("Target.setAutoAttach", { ...PAUSED_ON_START, filter: BROWSER_TARGETS });
  } catch (error) {
    cdp.close();
    throw error;
  }
  return { closed, close: () => { window?.stop(); cdp?.close(); } };
}

/** A paused worker answers its overrides only once it runs, so a worker is sent them and released at once. */
async function applyIdentity(cdp: Cdp, sessionId: string, type: string, identity: SidecarIdentity, options: SidecarOptions): Promise<void> {
  try {
    if (type === "page" && options.noPasskeys) for (const [method, params] of NO_PASSKEY_COMMANDS) await cdp.send(method, params, sessionId).catch(() => undefined);
    const { gpu, window: _window, ...override } = identity;
    if (type === "page" || type === "iframe") {
      // A native window shows the page at the window's real size: no emulated viewport survives on a new page.
      if (type === "page" && identity.window) await cdp.send("Emulation.clearDeviceMetricsOverride", {}, sessionId).catch(() => undefined);
      await cdp.send("Emulation.setUserAgentOverride", { ...override }, sessionId);
      if (gpu) await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: webglIdentityScript(gpu) }, sessionId).catch(() => undefined);
      await cdp.send("Target.setAutoAttach", PAUSED_ON_START, sessionId);
    } else if (type.endsWith("worker")) {
      if (type !== "worker") void cdp.send("Emulation.setUserAgentOverride", { ...override }, sessionId).catch(() => undefined);
      void cdp.send("Network.setUserAgentOverride", { ...override }, sessionId).catch(() => undefined);
    }
  } catch {}
  await cdp.send("Runtime.runIfWaitingForDebugger", {}, sessionId).catch(() => undefined);
}

type LaunchSpec = { command: string; env?: Record<string, string | undefined> };

/** One sidecar per browser session, attached again whenever the session's browser was started anew. */
export class IdentitySidecars {
  private live = new Map<string, IdentitySidecar>();
  private attaching = new Map<string, Promise<void>>();
  private cdpUrl: (session: string, spec: LaunchSpec) => Promise<string | null>;
  private start: typeof startIdentitySidecar;

  constructor(options: { cdpUrl?: (session: string, spec: LaunchSpec) => Promise<string | null>; start?: typeof startIdentitySidecar } = {}) {
    this.cdpUrl = options.cdpUrl ?? runningBrowserCdpUrl;
    this.start = options.start ?? startIdentitySidecar;
  }

  attached(session: string): boolean { return this.live.has(session); }

  ensure(session: string, spec: LaunchSpec, identity: SidecarIdentity): Promise<void> {
    if (this.live.has(session)) return Promise.resolve();
    let attaching = this.attaching.get(session);
    if (!attaching) {
      attaching = this.attach(session, spec, identity).finally(() => this.attaching.delete(session));
      this.attaching.set(session, attaching);
    }
    return attaching;
  }

  forget(session: string): void {
    this.live.get(session)?.close();
    this.live.delete(session);
  }

  private async attach(session: string, spec: LaunchSpec, identity: SidecarIdentity): Promise<void> {
    const url = await this.cdpUrl(session, spec);
    if (!url) return;
    const sidecar = await this.start(url, identity, undefined, { noPasskeys: spec.env?.AGENT_BROWSER_HEADLESS === "1" });
    this.live.get(session)?.close();
    this.live.set(session, sidecar);
    void sidecar.closed.then(() => { if (this.live.get(session) === sidecar) this.live.delete(session); });
  }
}

/** The engine's own Chrome on this machine only, read with the session's launch settings so the engine does not relaunch the
 * browser for it. A session closed since (a bot can close its browser) is started first, with `open` and no URL, which never
 * navigates, so the identity is in place before the bot's next command. */
async function runningBrowserCdpUrl(session: string, spec: LaunchSpec): Promise<string | null> {
  const env = browserRuntimeEnv({ ...spec.env, AGENT_BROWSER_SESSION: session });
  let answer = await inRunningBrowser(spec.command, env, ["get", "cdp-url"]);
  if (!answer) {
    await new Promise<void>((resolve, reject) => {
      execFile(spec.command, ["open", "--json", "--no-webmcp"], { env, timeout: 60_000, windowsHide: true }, (error) => error ? reject(error) : resolve());
    });
    answer = await inRunningBrowser(spec.command, env, ["get", "cdp-url"]);
  }
  const url = answer?.cdpUrl;
  return typeof url === "string" && /^wss?:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):\d+\//u.test(url) ? url : null;
}
