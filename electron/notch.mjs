import { fileURLToPath } from "node:url";
import { chatLinkFor, fromNotchWindow, NOTCH_ARM_MS, NOTCH_CHANNELS as CH, parseDecision, parseNotchFeed } from "./notch-ipc.mjs";
import { chooseTarget, learnedNotches, menuBarHidden, observeDisplays, placeNotch } from "./notch-placement.mjs";
import { createNotchPrefs } from "./notch-prefs.mjs";
import { createNotchMachine } from "./notch-state.mjs";

const PAGE = fileURLToPath(new URL("./notch.html", import.meta.url));
const PRELOAD = fileURLToPath(new URL("./notch-preload.cjs", import.meta.url));
const SHRINK_DELAY_MS = 240;
const WATCH_MS = 1500;
const DISPLAY_EVENTS = ["display-added", "display-removed", "display-metrics-changed"];

const sameBounds = (a, b) => a && b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

/**
 * Agents at the top of the screen, around the Mac's notch (a pill under the menu bar on a display without one).
 * The page publishes what is happening; this shows it in a small window that never takes focus, and hands a tap on
 * Aprovar/Recusar back to the page that published it. `sendDecision(payload)` reaches that page, `openLink(link)`
 * brings the app to a conversation (null: just the app).
 */
export function createNotch({
  platform = process.platform,
  ipcMain,
  screen,
  BrowserWindow,
  localOnly,
  userData,
  sendDecision,
  openLink,
  log = () => {},
  now = Date.now,
  timers = { setTimeout, clearTimeout, setInterval, clearInterval },
  files,
}) {
  if (platform !== "darwin") return { supported: false, start() {}, close() {} };

  const prefs = createNotchPrefs(userData, files);
  const machine = createNotchMachine();
  const insets = new Map();
  const decided = new Set();
  const shownAt = new Map();
  let win = null;
  let pageReady = false;
  let shown = null;
  let applied = null;
  let lastSent = "";
  let wakeTimer = null;
  let watchTimer = null;
  let shrinkTimer = null;
  let publisher = null;
  let detachPublisher = null;
  let started = false;

  const displays = () => {
    const all = screen.getAllDisplays();
    observeDisplays(all, insets);
    return all;
  };
  const target = () => {
    const all = displays();
    return chooseTarget({ displays: all, primary: screen.getPrimaryDisplay(), learned: learnedNotches(all, insets) });
  };
  const enabled = () => prefs.enabled() ?? target()?.kind === "notch";

  const send = (view) => {
    const body = JSON.stringify(view);
    if (!win || win.isDestroyed() || !pageReady || body === lastSent) return;
    lastSent = body;
    win.webContents.send(CH.view, view);
  };

  const destroyWindow = () => {
    timers.clearTimeout(shrinkTimer);
    const old = win;
    win = null;
    pageReady = false;
    shown = null;
    shownAt.clear();
    applied = null;
    lastSent = "";
    if (old && !old.isDestroyed()) old.destroy();
  };

  const makeWindow = () => {
    const window = new BrowserWindow({
      width: 420,
      height: 40,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      focusable: false,
      acceptFirstMouse: true,
      enableLargerThanScreen: true,
      type: "panel",
      webPreferences: {
        preload: PRELOAD,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webviewTag: false,
        spellcheck: false,
        devTools: false,
        backgroundThrottling: false,
      },
    });
    window.setAlwaysOnTop(true, "pop-up-menu");
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false, skipTransformProcessType: true });
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event) => event.preventDefault());
    window.webContents.on("render-process-gone", destroyWindow);
    window.once("closed", () => {
      if (win === window) {
        win = null;
        pageReady = false;
        shown = null;
        shownAt.clear();
        applied = null;
        lastSent = "";
      }
    });
    void window.loadFile(PAGE).catch((error) => log(`notch page failed to load: ${error?.message ?? error}`));
    return window;
  };

  const hide = () => {
    timers.clearTimeout(shrinkTimer);
    if (win && !win.isDestroyed() && shown) win.hide();
    shown = null;
    shownAt.clear();
  };

  const present = (view, place) => {
    win ??= makeWindow();
    const next = place.bounds;
    if (shown && applied?.expanded && !view.expanded) {
      timers.clearTimeout(shrinkTimer);
      shrinkTimer = timers.setTimeout(() => {
        if (win && !win.isDestroyed()) win.setBounds(next);
      }, SHRINK_DELAY_MS);
      applied = { bounds: next, expanded: false };
    } else if (!sameBounds(applied?.bounds, next)) {
      timers.clearTimeout(shrinkTimer);
      win.setBounds(next);
      applied = { bounds: next, expanded: view.expanded };
    }
    const appearing = !shown && pageReady;
    if (pageReady && view.approval && !shownAt.has(view.approval.id)) shownAt.set(view.approval.id, now());
    send({ ...view, layout: place.layout, appearing });
    if (appearing) {
      win.showInactive();
      shown = true;
    }
  };

  function refresh() {
    timers.clearTimeout(wakeTimer);
    wakeTimer = null;
    machine.advance(now());
    const view = machine.view();
    const on = enabled();
    if (view.visible && on) watchTimer ??= timers.setInterval(refresh, WATCH_MS);
    else {
      timers.clearInterval(watchTimer);
      watchTimer = null;
    }
    const place = view.visible && on ? target() : null;
    if (!on) {
      hide();
      destroyWindow();
    } else if (!place || menuBarHidden(place.display, insets)) hide();
    else present(view, placeNotch({ display: place.display, kind: place.kind, expanded: view.expanded }));
    const at = machine.wakeAt();
    if (at !== null) wakeTimer = timers.setTimeout(refresh, Math.max(0, at - now()));
  }

  const clear = () => {
    machine.reset();
    decided.clear();
    refresh();
  };

  const watch = (sender) => {
    if (publisher === sender) return;
    detachPublisher?.();
    publisher = sender;
    const onNavigate = (details) => {
      if (details?.isMainFrame === true && details.isSameDocument !== true) clear();
    };
    sender.once("destroyed", clear);
    sender.on("render-process-gone", clear);
    sender.on("did-start-navigation", onNavigate);
    sender.on("did-navigate", clear);
    detachPublisher = () => {
      sender.removeListener("destroyed", clear);
      sender.removeListener("render-process-gone", clear);
      sender.removeListener("did-start-navigation", onNavigate);
      sender.removeListener("did-navigate", clear);
    };
  };

  const state = () => ({ supported: true, enabled: enabled(), saved: prefs.enabled() !== null, display: target()?.kind ?? "none" });

  const handlers = new Map();
  const handle = (channel, fn) => {
    handlers.set(channel, fn);
    ipcMain.handle(channel, localOnly(channel, fn));
  };
  const listeners = new Map();
  const listen = (channel, fn) => {
    const wrapped = (event, ...args) => {
      if (fromNotchWindow(event, win?.webContents)) fn(...args);
    };
    listeners.set(channel, wrapped);
    ipcMain.on(channel, wrapped);
  };

  handle(CH.feed, (event, raw) => {
    const feed = parseNotchFeed(raw);
    if (!feed) {
      log("notch: refused a malformed snapshot");
      return false;
    }
    watch(event.sender);
    const open = new Set(feed.approvals.map((entry) => entry.id));
    for (const id of decided) if (!open.has(id)) decided.delete(id);
    for (const id of shownAt.keys()) if (!open.has(id)) shownAt.delete(id);
    machine.feed(feed, now());
    refresh();
    return true;
  });
  handle(CH.state, () => state());
  handle(CH.setEnabled, (_event, value) => {
    if (typeof value !== "boolean") throw new Error("The notch switch is on or off");
    prefs.setEnabled(value);
    refresh();
    return state();
  });

  listen(CH.ready, () => {
    pageReady = true;
    refresh();
  });
  listen(CH.decide, (raw) => {
    const decision = parseDecision(raw);
    const approval = machine.view().approval;
    if (!decision || !approval || approval.id !== decision.id || approval.decidable !== true || decided.has(decision.id)) return;
    const since = shownAt.get(approval.id);
    if (since === undefined || now() - since < NOTCH_ARM_MS) return;
    decided.add(decision.id);
    if (!sendDecision(decision)) decided.delete(decision.id);
  });
  listen(CH.open, () => {
    openLink(chatLinkFor(machine.view().target));
  });

  return {
    supported: true,
    start() {
      if (started) return;
      started = true;
      for (const event of DISPLAY_EVENTS) screen.on(event, refresh);
      refresh();
    },
    close() {
      for (const event of DISPLAY_EVENTS) screen.removeListener(event, refresh);
      for (const [channel, wrapped] of listeners) ipcMain.removeListener(channel, wrapped);
      for (const channel of handlers.keys()) ipcMain.removeHandler(channel);
      timers.clearTimeout(wakeTimer);
      timers.clearInterval(watchTimer);
      detachPublisher?.();
      destroyWindow();
      started = false;
    },
  };
}
