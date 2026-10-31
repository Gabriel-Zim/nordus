import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import test from "node:test";

import { createNotch } from "./notch.mjs";
import { NOTCH_ARM_MS } from "./notch-ipc.mjs";
import { NOTCH_APPEAR_MS, NOTCH_DONE_MS } from "./notch-state.mjs";
import { NOTCH_GAP, WING_LEFT } from "./notch-placement.mjs";

const require = createRequire(import.meta.url);
const { localOnly, setLocalOrigin } = require("./local-origin.cjs");

const LOCAL = "http://127.0.0.1:8799";
const labels = { done: "Pronto", approve: "Aprovar", decline: "Recusar", open: "Abrir no app", several: "{count} agentes" };
const agent = (name, extra = {}) => ({ id: name.toLowerCase(), name, color: "#377fe6", status: "Gerando imagem", botId: `bot-${name}`, threadId: `thread-${name}`, ...extra });
const approval = (name, extra = {}) => ({
  id: `thread-${name}:request-${name}`,
  name,
  color: "#d94b52",
  header: `${name} pede sua aprovação`,
  text: "Quero publicar a página do artigo.",
  decidable: true,
  botId: `bot-${name}`,
  threadId: `thread-${name}`,
  ...extra,
});
const feed = ({ agents = [], approvals = [] } = {}) => ({ agents, approvals, labels });

const display = (id, { x = 0, y = 0, width = 1512, height = 982, bar = 37, internal = false } = {}) => ({
  id,
  internal,
  bounds: { x, y, width, height },
  workArea: { x, y: y + bar, width, height: height - bar },
});

function harness({ platform = "darwin", displays = [display(1, { internal: true })], saved } = {}) {
  setLocalOrigin(LOCAL);
  let clock = 1_000_000;
  const queue = [];
  let nextId = 1;
  const timers = {
    setTimeout: (fn, ms) => { const id = nextId++; queue.push({ id, at: clock + ms, fn, every: null }); return id; },
    clearTimeout: (id) => { const at = queue.findIndex((job) => job.id === id); if (at >= 0) queue.splice(at, 1); },
    setInterval: (fn, ms) => { const id = nextId++; queue.push({ id, at: clock + ms, fn, every: ms }); return id; },
    clearInterval: (id) => timers.clearTimeout(id),
  };
  const advance = (ms) => {
    const end = clock + ms;
    for (;;) {
      queue.sort((a, b) => a.at - b.at);
      const job = queue[0];
      if (!job || job.at > end) break;
      clock = job.at;
      if (job.every) job.at += job.every;
      else queue.shift();
      job.fn();
    }
    clock = end;
  };

  const handlers = new Map();
  const listeners = new Map();
  const ipcMain = {
    handle: (channel, fn) => handlers.set(channel, fn),
    removeHandler: (channel) => handlers.delete(channel),
    on: (channel, fn) => listeners.set(channel, fn),
    removeListener: (channel) => listeners.delete(channel),
  };

  const screen = Object.assign(new EventEmitter(), {
    displays,
    getAllDisplays() { return this.displays; },
    getPrimaryDisplay() { return this.displays[0]; },
  });

  const windows = [];
  class FakeWindow {
    constructor(options) {
      this.options = options;
      this.calls = [];
      this.bounds = null;
      this.visible = false;
      this.destroyed = false;
      this.sent = [];
      this.handlers = new EventEmitter();
      const frame = {};
      this.webContents = Object.assign(new EventEmitter(), {
        mainFrame: frame,
        isDestroyed: () => this.destroyed,
        send: (channel, value) => this.sent.push([channel, value]),
        setWindowOpenHandler: (fn) => { this.openHandler = fn; },
      });
      windows.push(this);
    }
    setAlwaysOnTop(...args) { this.calls.push(["setAlwaysOnTop", ...args]); }
    setVisibleOnAllWorkspaces(...args) { this.calls.push(["setVisibleOnAllWorkspaces", ...args]); }
    loadFile(file) { this.loaded = file; return Promise.resolve(); }
    setBounds(bounds) { this.bounds = bounds; this.calls.push(["setBounds", bounds]); }
    showInactive() { this.visible = true; this.calls.push(["showInactive"]); }
    hide() { this.visible = false; this.calls.push(["hide"]); }
    destroy() { this.destroyed = true; this.calls.push(["destroy"]); this.handlers.emit("closed"); }
    isDestroyed() { return this.destroyed; }
    once(event, fn) { this.handlers.once(event, fn); }
    on(event, fn) { this.handlers.on(event, fn); }
    get views() { return this.sent.filter(([channel]) => channel === "notch:view").map(([, view]) => view); }
    get last() { return this.views.at(-1); }
  }

  const files = new Map();
  const memory = {
    readFileSync: (file) => { if (!files.has(file)) throw new Error("ENOENT"); return files.get(file); },
    writeFileSync: (file, text) => files.set(file, text),
    renameSync: (from, to) => { files.set(to, files.get(from)); files.delete(from); },
    rmSync: (file) => files.delete(file),
    mkdirSync: () => undefined,
  };
  if (saved !== undefined) files.set("/data/notch.json", JSON.stringify({ enabled: saved }));

  const decisions = [];
  const links = [];
  const logs = [];
  let delivered = true;
  const notch = createNotch({
    platform,
    ipcMain,
    screen,
    BrowserWindow: FakeWindow,
    localOnly,
    userData: "/data",
    sendDecision: (payload) => { decisions.push(payload); return delivered; },
    openLink: (link) => links.push(link),
    log: (line) => logs.push(line),
    now: () => clock,
    timers,
    files: memory,
  });

  const page = Object.assign(new EventEmitter(), { id: "page" });
  const fromPage = { sender: page, senderFrame: { url: `${LOCAL}/` } };
  const publish = (snapshot, event = fromPage) => handlers.get("notch:feed")(event, snapshot);
  const fromNotch = (window = windows.at(-1)) => ({ sender: window.webContents, senderFrame: window.webContents.mainFrame });
  const pageLoaded = () => listeners.get("notch:ready")(fromNotch());
  const shownWindow = () => {
    advance(NOTCH_APPEAR_MS);
    pageLoaded();
    return windows.at(-1);
  };
  return { notch, screen, windows, handlers, listeners, advance, decisions, links, logs, publish, fromNotch, pageLoaded, shownWindow, page, files, setDelivered: (value) => { delivered = value; }, now: () => clock };
}

test("does nothing at all outside macOS", () => {
  const h = harness({ platform: "win32" });
  assert.equal(h.notch.supported, false);
  assert.equal(h.handlers.size, 0);
  assert.equal(h.listeners.size, 0);
  h.notch.start();
  assert.equal(h.windows.length, 0);
});

test("stays invisible and creates no window while nobody works", () => {
  const h = harness();
  h.notch.start();
  h.publish(feed());
  assert.equal(h.windows.length, 0);
});

test("an agent that starts appears around the notch, without taking focus", () => {
  const h = harness();
  h.notch.start();
  h.publish(feed({ agents: [agent("Maya")] }));
  assert.equal(h.windows.length, 0, "a quick reply never flashes");

  const win = h.shownWindow();
  assert.equal(h.windows.length, 1);
  assert.equal(win.visible, true);
  assert.equal(win.options.focusable, false);
  assert.equal(win.options.frame, false);
  assert.equal(win.options.transparent, true);
  assert.equal(win.options.type, "panel");
  assert.equal(win.options.skipTaskbar, true);
  assert.equal(win.options.enableLargerThanScreen, true);
  assert.equal(win.options.acceptFirstMouse, true);
  assert.equal(win.options.webPreferences.sandbox, true);
  assert.equal(win.options.webPreferences.contextIsolation, true);
  assert.equal(win.options.webPreferences.nodeIntegration, false);
  assert.ok(win.options.webPreferences.preload.endsWith("notch-preload.cjs"));
  assert.ok(win.loaded.endsWith("notch.html"));
  assert.deepEqual(win.calls.find((call) => call[0] === "setAlwaysOnTop"), ["setAlwaysOnTop", true, "pop-up-menu"]);
  assert.deepEqual(win.calls.find((call) => call[0] === "setVisibleOnAllWorkspaces"), ["setVisibleOnAllWorkspaces", true, { visibleOnFullScreen: false, skipTransformProcessType: true }]);
  assert.ok(win.calls.findIndex((call) => call[0] === "setBounds") < win.calls.findIndex((call) => call[0] === "showInactive"));
  assert.equal(win.calls.some((call) => call[0] === "show" || call[0] === "focus"), false);

  assert.equal(win.bounds.y, 0);
  assert.equal(win.bounds.x + WING_LEFT + NOTCH_GAP / 2, 756);
  assert.equal(win.last.phase, "working");
  assert.equal(win.last.text, "Gerando imagem");
  assert.deepEqual(win.last.avatars, [{ initial: "M", color: "#377fe6" }]);
  assert.equal(win.last.layout.kind, "notch");
});

test("the page cannot navigate away or open other windows", () => {
  const h = harness();
  h.notch.start();
  h.publish(feed({ agents: [agent("Maya")] }));
  const win = h.shownWindow();

  assert.deepEqual(win.openHandler({ url: "https://example.com" }), { action: "deny" });
  let prevented = false;
  win.webContents.emit("will-navigate", { preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
});

test("an approval opens below the notch and an answer goes back to the page that published it", () => {
  const h = harness();
  h.notch.start();
  h.publish(feed({ agents: [agent("Maya")] }));
  const win = h.shownWindow();
  const collapsed = win.bounds;

  h.publish(feed({ agents: [agent("Maya")], approvals: [approval("Maya")] }));
  assert.equal(win.last.phase, "approval");
  assert.equal(win.last.expanded, true);
  assert.ok(win.bounds.height > collapsed.height);
  assert.equal(win.bounds.y, 0);

  h.advance(NOTCH_ARM_MS);
  h.listeners.get("notch:decide")(h.fromNotch(win), { id: "thread-Maya:request-Maya", decision: "approve" });
  assert.deepEqual(h.decisions, [{ id: "thread-Maya:request-Maya", decision: "approve" }]);

  h.listeners.get("notch:decide")(h.fromNotch(win), { id: "thread-Maya:request-Maya", decision: "decline" });
  assert.equal(h.decisions.length, 1, "one answer per request");
});

test("a request that must be decided in the app cannot be answered from the notch", () => {
  const h = harness();
  h.notch.start();
  h.publish(feed({ approvals: [approval("Maya", { decidable: false })] }));
  const win = h.windows[0];
  h.pageLoaded();
  h.advance(NOTCH_ARM_MS);

  h.listeners.get("notch:decide")(h.fromNotch(win), { id: "thread-Maya:request-Maya", decision: "approve" });
  assert.deepEqual(h.decisions, []);

  h.listeners.get("notch:open")(h.fromNotch(win));
  assert.deepEqual(h.links, ["nordus://thread/thread-Maya?bot=bot-Maya"]);
});

test("answers that are malformed, stale or from anywhere else are ignored", () => {
  const h = harness();
  h.notch.start();
  h.publish(feed({ approvals: [approval("Maya")] }));
  const win = h.windows[0];
  h.pageLoaded();
  h.advance(NOTCH_ARM_MS);
  const decide = h.listeners.get("notch:decide");

  decide(h.fromNotch(win), { id: "thread-Maya:request-Maya", decision: "allow" });
  decide(h.fromNotch(win), { id: "another:request", decision: "approve" });
  decide(h.fromNotch(win), "approve");
  decide(h.fromNotch(win), undefined);
  decide({ sender: h.page, senderFrame: { url: `${LOCAL}/` } }, { id: "thread-Maya:request-Maya", decision: "approve" });
  decide({ sender: win.webContents, senderFrame: {} }, { id: "thread-Maya:request-Maya", decision: "approve" });
  h.listeners.get("notch:open")({ sender: h.page, senderFrame: { url: `${LOCAL}/` } });

  assert.deepEqual(h.decisions, []);
  assert.deepEqual(h.links, []);
});

test("an answer that could not be delivered can be tried again", () => {
  const h = harness();
  h.notch.start();
  h.publish(feed({ approvals: [approval("Maya")] }));
  const win = h.windows[0];
  h.pageLoaded();
  h.advance(NOTCH_ARM_MS);

  h.setDelivered(false);
  h.listeners.get("notch:decide")(h.fromNotch(win), { id: "thread-Maya:request-Maya", decision: "approve" });
  h.setDelivered(true);
  h.listeners.get("notch:decide")(h.fromNotch(win), { id: "thread-Maya:request-Maya", decision: "approve" });
  assert.equal(h.decisions.length, 2);
});

const MAYA = "thread-Maya:request-Maya";
const CAIO = "thread-Caio:request-Caio";

test("nothing is answered before the window has put the request on screen", () => {
  const h = harness();
  h.notch.start();
  h.publish(feed({ approvals: [approval("Maya")] }));
  const win = h.windows[0];

  h.listeners.get("notch:decide")(h.fromNotch(win), { id: MAYA, decision: "approve" });
  assert.deepEqual(h.decisions, []);
});

test("a tap in the first moments after a request appears is refused, a later one counts", () => {
  const h = harness();
  h.notch.start();
  h.publish(feed({ approvals: [approval("Maya")] }));
  const win = h.windows[0];
  h.pageLoaded();
  const decide = () => h.listeners.get("notch:decide")(h.fromNotch(win), { id: MAYA, decision: "approve" });

  decide();
  h.advance(NOTCH_ARM_MS - 1);
  decide();
  assert.deepEqual(h.decisions, [], "the fade and the first instants are not an answer");

  h.advance(1);
  decide();
  assert.deepEqual(h.decisions, [{ id: MAYA, decision: "approve" }]);
});

test("the request that takes the place of an answered one gets its own wait", () => {
  const h = harness();
  h.notch.start();
  h.publish(feed({ approvals: [approval("Maya"), approval("Caio")] }));
  const win = h.windows[0];
  h.pageLoaded();
  h.advance(NOTCH_ARM_MS);
  const decide = (id) => h.listeners.get("notch:decide")(h.fromNotch(win), { id, decision: "approve" });

  decide(MAYA);
  assert.deepEqual(h.decisions, [{ id: MAYA, decision: "approve" }]);

  h.advance(120);
  h.publish(feed({ approvals: [approval("Caio")] }));
  assert.equal(win.last.approval.id, CAIO);
  decide(CAIO);
  h.advance(NOTCH_ARM_MS - 1);
  decide(CAIO);
  assert.equal(h.decisions.length, 1, "a second tap meant for the first request does not reach the next one");

  h.advance(1);
  decide(CAIO);
  assert.deepEqual(h.decisions.map((decision) => decision.id), [MAYA, CAIO]);
});

test("a request that drops out of the snapshot and returns is a new appearance", () => {
  const h = harness();
  h.notch.start();
  h.publish(feed({ approvals: [approval("Maya")] }));
  const win = h.windows[0];
  h.pageLoaded();
  h.advance(NOTCH_ARM_MS);
  const decide = () => h.listeners.get("notch:decide")(h.fromNotch(win), { id: MAYA, decision: "approve" });

  h.publish(feed());
  h.advance(300);
  h.publish(feed({ approvals: [approval("Maya")] }));
  decide();
  assert.deepEqual(h.decisions, []);

  h.advance(NOTCH_ARM_MS);
  decide();
  assert.equal(h.decisions.length, 1);
});

test("a request that comes back after the notch stepped aside waits again before it can be answered", () => {
  const built = display(1, { internal: true });
  const h = harness({ displays: [built] });
  h.notch.start();
  h.publish(feed({ approvals: [approval("Maya")] }));
  const win = h.windows[0];
  h.pageLoaded();
  h.advance(NOTCH_ARM_MS);
  const decide = () => h.listeners.get("notch:decide")(h.fromNotch(win), { id: MAYA, decision: "approve" });

  h.screen.displays = [display(1, { internal: true, bar: 0 })];
  h.advance(2000);
  assert.equal(win.visible, false);
  decide();
  assert.deepEqual(h.decisions, [], "nothing hidden is answered");

  h.screen.displays = [built];
  for (let step = 0; step < 40 && !win.visible; step += 1) h.advance(100);
  assert.equal(win.visible, true);
  decide();
  assert.deepEqual(h.decisions, [], "it is only just back on screen");

  h.advance(NOTCH_ARM_MS);
  decide();
  assert.equal(h.decisions.length, 1);
});

test("the page is told each time the window is put back on screen, so it can wait again", () => {
  const built = display(1, { internal: true });
  const h = harness({ displays: [built] });
  h.notch.start();
  h.publish(feed({ approvals: [approval("Maya")] }));
  const win = h.windows[0];
  assert.deepEqual(win.views, [], "nothing is sent before the page is ready");
  h.pageLoaded();
  const appearances = () => win.views.filter((view) => view.appearing === true).length;
  assert.equal(win.last.appearing, true);
  assert.equal(appearances(), 1);

  h.advance(NOTCH_ARM_MS);
  h.publish(feed({ approvals: [approval("Maya")], agents: [agent("Maya")] }));
  assert.equal(win.last.appearing, false, "a change in what is drawn is not a new appearance");
  assert.equal(appearances(), 1);

  h.screen.displays = [display(1, { internal: true, bar: 0 })];
  h.advance(2000);
  assert.equal(win.visible, false);
  h.screen.displays = [built];
  for (let step = 0; step < 40 && !win.visible; step += 1) h.advance(100);
  assert.equal(win.visible, true);
  assert.equal(appearances(), 2);
  assert.equal(win.views.findLast((view) => view.appearing === true).approval.id, MAYA);
});

test("a tap on the notch opens that conversation in the app", () => {
  const h = harness();
  h.notch.start();
  h.publish(feed({ agents: [agent("Maya"), agent("Caio")] }));
  const win = h.shownWindow();

  h.listeners.get("notch:open")(h.fromNotch(win));
  assert.deepEqual(h.links, ["nordus://thread/thread-Maya?bot=bot-Maya"]);
});

test("a tap on a notch with no known conversation just brings the app forward", () => {
  const h = harness();
  h.notch.start();
  h.publish(feed({ agents: [agent("Maya", { botId: null, threadId: null })] }));
  const win = h.shownWindow();

  h.listeners.get("notch:open")(h.fromNotch(win));
  assert.deepEqual(h.links, [null]);
});

test("when the work ends it says Pronto, then hides", () => {
  const h = harness();
  h.notch.start();
  h.publish(feed({ agents: [agent("Maya")] }));
  const win = h.shownWindow();

  h.publish(feed());
  assert.equal(win.last.phase, "done");
  assert.equal(win.last.text, "Pronto");
  assert.equal(win.visible, true);

  h.advance(NOTCH_DONE_MS + 10);
  assert.equal(win.visible, false);
  assert.equal(win.calls.at(-1)[0], "hide");
});

test("after an approval the window folds first and shrinks once the page has finished", () => {
  const h = harness();
  h.notch.start();
  h.publish(feed({ agents: [agent("Maya")], approvals: [approval("Maya")] }));
  const win = h.windows[0];
  h.pageLoaded();
  const tall = win.bounds;

  h.publish(feed({ agents: [agent("Maya")] }));
  assert.equal(win.last.expanded, false);
  assert.deepEqual(win.bounds, tall, "still tall while the page folds");
  h.advance(300);
  assert.ok(win.bounds.height < tall.height);
});

test("a display change moves the notch window with it", () => {
  const h = harness({ displays: [display(1, { internal: true })] });
  h.notch.start();
  h.publish(feed({ agents: [agent("Maya")] }));
  const win = h.shownWindow();
  assert.equal(win.bounds.x + WING_LEFT + NOTCH_GAP / 2, 756);

  h.screen.displays = [display(1, { internal: true, x: 1920, y: -100, width: 1728, height: 1117 })];
  h.screen.emit("display-metrics-changed", {}, h.screen.displays[0], ["bounds"]);
  assert.equal(win.bounds.y, -100);
  assert.equal(win.bounds.x + WING_LEFT + NOTCH_GAP / 2, 1920 + 864);
});

test("with an external monitor the notch stays on the built-in display", () => {
  const external = display(2, { x: 0, y: 0, width: 2560, height: 1440, bar: 25 });
  const built = display(1, { internal: true, x: 2560, y: 300 });
  const h = harness({ displays: [external, built] });
  h.notch.start();
  h.publish(feed({ agents: [agent("Maya")] }));
  const win = h.shownWindow();

  assert.equal(win.bounds.y, 300);
  assert.equal(win.bounds.x + WING_LEFT + NOTCH_GAP / 2, 2560 + 756);
  assert.equal(win.last.layout.kind, "notch");
});

test("unplugging the built-in display hides the notch unless the person turned it on", () => {
  const external = display(2, { width: 2560, height: 1440, bar: 25 });
  const built = display(1, { internal: true });
  const h = harness({ displays: [built, external] });
  h.notch.start();
  h.publish(feed({ agents: [agent("Maya")] }));
  const win = h.shownWindow();
  assert.equal(win.visible, true);

  h.screen.displays = [external];
  h.screen.emit("display-removed", {}, built);
  assert.equal(win.visible, false);
  const local = { sender: h.page, senderFrame: { url: `${LOCAL}/` } };
  assert.deepEqual(h.handlers.get("notch:state")(local), { supported: true, enabled: false, saved: false, display: "pill" });
});

test("a person who turned it on gets a pill under the menu bar of the main display", () => {
  const external = display(2, { width: 2560, height: 1440, bar: 25 });
  const h = harness({ displays: [external], saved: true });
  h.notch.start();
  h.publish(feed({ agents: [agent("Maya")] }));
  const win = h.shownWindow();

  assert.equal(win.visible, true);
  assert.equal(win.last.layout.kind, "pill");
  assert.equal(win.bounds.y, 25 + 6);
});

test("a person who turned it off sees nothing, and turning it on shows what is happening", () => {
  const h = harness();
  h.notch.start();
  const local = { sender: h.page, senderFrame: { url: `${LOCAL}/` } };
  h.publish(feed({ agents: [agent("Maya")] }));
  h.advance(NOTCH_APPEAR_MS);

  assert.equal(h.handlers.get("notch:set-enabled")(local, false).enabled, false);
  assert.equal(h.windows.every((window) => window.destroyed), true);
  assert.equal(h.files.get("/data/notch.json"), JSON.stringify({ enabled: false }));

  const state = h.handlers.get("notch:set-enabled")(local, true);
  assert.equal(state.enabled, true);
  assert.equal(state.saved, true);
  h.pageLoaded();
  assert.equal(h.windows.at(-1).visible, true);
  assert.equal(h.windows.at(-1).destroyed, false);
});

test("the switch is on by default only where there is a notch", () => {
  const local = { sender: {}, senderFrame: { url: `${LOCAL}/` } };
  const notched = harness();
  assert.deepEqual(notched.handlers.get("notch:state")(local), { supported: true, enabled: true, saved: false, display: "notch" });

  const plain = harness({ displays: [display(2, { width: 2560, height: 1440, bar: 25 })] });
  assert.deepEqual(plain.handlers.get("notch:state")(local), { supported: true, enabled: false, saved: false, display: "pill" });

  const saved = harness({ displays: [display(2, { bar: 25 })], saved: true });
  assert.equal(saved.handlers.get("notch:state")(local).enabled, true);
});

test("only a plain true or false changes the switch", () => {
  const h = harness();
  const local = { sender: {}, senderFrame: { url: `${LOCAL}/` } };
  for (const value of [undefined, null, "true", 1, {}, []]) assert.throws(() => h.handlers.get("notch:set-enabled")(local, value));
  assert.equal(h.files.size, 0);
});

test("pages that are not the local app cannot publish, read or change anything", () => {
  const h = harness();
  const remote = { sender: {}, senderFrame: { url: "https://example.com/" } };
  assert.throws(() => h.publish(feed({ agents: [agent("Maya")] }), remote), /only available while using the local server/);
  assert.throws(() => h.handlers.get("notch:state")(remote), /local server/);
  assert.throws(() => h.handlers.get("notch:set-enabled")(remote, false), /local server/);
  assert.equal(h.windows.length, 0);
});

test("a malformed snapshot is refused and changes nothing", () => {
  const h = harness();
  h.notch.start();
  h.publish(feed({ agents: [agent("Maya")] }));
  const win = h.shownWindow();

  assert.equal(h.publish({ agents: "no" }), false);
  assert.equal(h.publish(null), false);
  assert.equal(win.visible, true);
  assert.equal(h.logs.length, 2);
});

test("when the page that published goes away the notch goes quiet", () => {
  const h = harness();
  h.notch.start();
  h.publish(feed({ agents: [agent("Maya")] }));
  const win = h.shownWindow();
  assert.equal(win.visible, true);

  h.page.emit("did-start-navigation", { isMainFrame: false, isSameDocument: false });
  h.page.emit("did-start-navigation", { isMainFrame: true, isSameDocument: true });
  assert.equal(win.visible, true);

  h.page.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
  assert.equal(win.visible, false);

  h.publish(feed({ agents: [agent("Maya")] }));
  h.advance(NOTCH_APPEAR_MS);
  assert.equal(win.visible, true);
  h.page.emit("destroyed");
  assert.equal(win.visible, false);
});

test("a workspace switch clears the notch when the new page commits, whatever the old page published in between", () => {
  const h = harness();
  h.notch.start();
  h.publish(feed({ agents: [agent("Maya")], approvals: [approval("Maya")] }));
  const win = h.shownWindow();
  assert.equal(win.visible, true);

  h.page.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
  assert.equal(win.visible, false);

  h.publish(feed({ agents: [agent("Maya")], approvals: [approval("Maya")] }));
  h.advance(NOTCH_APPEAR_MS);
  assert.equal(win.visible, true, "the old page is still the one that is loaded");

  h.page.emit("did-navigate", {}, "https://remote.example/", 200, "OK");
  assert.equal(win.visible, false);
  h.advance(NOTCH_APPEAR_MS * 6);
  assert.equal(win.visible, false, "nothing of the old workspace comes back");
  h.listeners.get("notch:decide")(h.fromNotch(win), { id: MAYA, decision: "approve" });
  assert.deepEqual(h.decisions, []);
});

test("a full-screen app takes the menu bar away and the notch steps aside", () => {
  const built = display(1, { internal: true });
  const h = harness({ displays: [built] });
  h.notch.start();
  h.publish(feed({ agents: [agent("Maya")] }));
  const win = h.shownWindow();
  assert.equal(win.visible, true);

  h.screen.displays = [display(1, { internal: true, bar: 0 })];
  h.advance(2000);
  assert.equal(win.visible, false);

  h.screen.displays = [built];
  h.advance(2000);
  assert.equal(win.visible, true);
});

test("closing removes every handler and the window", () => {
  const h = harness();
  h.notch.start();
  h.publish(feed({ agents: [agent("Maya")] }));
  const win = h.shownWindow();

  h.notch.close();
  assert.equal(win.destroyed, true);
  assert.equal(h.handlers.size, 0);
  assert.equal(h.listeners.size, 0);
  assert.equal(h.screen.listenerCount("display-added"), 0);
});
