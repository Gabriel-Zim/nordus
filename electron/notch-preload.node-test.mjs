import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const LOCAL = "http://127.0.0.1:48993";
const REMOTE = "https://remote.example.test";
const appSource = readFileSync(new URL("./preload.cjs", import.meta.url), "utf8");
const notchSource = readFileSync(new URL("./notch-preload.cjs", import.meta.url), "utf8");

function run(source, { platform = "darwin", origin = LOCAL } = {}) {
  const exposed = {};
  const invoked = [];
  const sent = [];
  const listeners = new Map();
  vm.runInNewContext(source, {
    process: { platform, argv: [`--nordus-local-origin=${LOCAL}`] },
    location: { origin },
    navigator: {},
    TextEncoder,
    localStorage: { getItem: () => null },
    require: () => ({
      webUtils: {},
      contextBridge: { exposeInMainWorld: (name, value) => { exposed[name] = value; } },
      ipcRenderer: {
        on: (channel, handler) => {
          if (!listeners.has(channel)) listeners.set(channel, new Set());
          listeners.get(channel).add(handler);
        },
        removeListener: (channel, handler) => listeners.get(channel)?.delete(handler),
        send: (...args) => sent.push(args),
        invoke: (...args) => { invoked.push(args); return Promise.resolve(true); },
      },
    }),
  });
  const emit = (channel, ...args) => { for (const handler of listeners.get(channel) ?? []) handler({}, ...args); };
  return { exposed, invoked, sent, emit, count: (channel) => listeners.get(channel)?.size ?? 0 };
}

test("the app page on a Mac reaches the notch through four channels and nothing else", async () => {
  const page = run(appSource);
  const { notch } = page.exposed.ogb;
  assert.deepEqual(Object.keys(notch).sort(), ["onDecision", "publish", "setEnabled", "state"]);

  await notch.state();
  await notch.setEnabled(true);
  await notch.publish({ agents: [], approvals: [] });
  assert.deepEqual(page.invoked, [["notch:state"], ["notch:set-enabled", true], ["notch:feed", { agents: [], approvals: [] }]]);
});

test("answers from the notch reach the page until it stops listening", () => {
  const page = run(appSource);
  const seen = [];
  const stop = page.exposed.ogb.notch.onDecision((decision) => seen.push(decision));
  page.emit("notch:decision", { id: "a", decision: "approve" });
  assert.equal(page.count("notch:decision"), 1);
  stop();
  page.emit("notch:decision", { id: "b", decision: "decline" });
  assert.deepEqual(seen, [{ id: "a", decision: "approve" }]);
  assert.equal(page.count("notch:decision"), 0);
});

test("a page from another server and any other system get no notch bridge", () => {
  assert.equal(run(appSource, { origin: REMOTE }).exposed.ogb.notch, undefined);
  assert.equal(run(appSource, { platform: "win32" }).exposed.ogb.notch, undefined);
  assert.equal(run(appSource, { platform: "linux" }).exposed.ogb.notch, undefined);
});

test("the notch window can draw a view and ask for two things", () => {
  const window = run(notchSource);
  const bridge = window.exposed.notchWindow;
  assert.deepEqual(Object.keys(bridge).sort(), ["decide", "onView", "open"]);

  const painted = [];
  bridge.onView((view) => painted.push(view));
  assert.deepEqual(window.sent, [["notch:ready"]]);

  window.emit("notch:view", { phase: "working" });
  window.emit("notch:view", "text");
  window.emit("notch:view", null);
  assert.deepEqual(JSON.parse(JSON.stringify(painted)), [{ phase: "working" }]);

  bridge.decide("thread-1:request-1", "approve");
  bridge.open();
  assert.deepEqual(JSON.parse(JSON.stringify(window.sent.slice(1))), [["notch:decide", { id: "thread-1:request-1", decision: "approve" }], ["notch:open"]]);
});

test("the notch window is given nothing but those three functions", () => {
  const window = run(notchSource);
  assert.deepEqual(Object.keys(window.exposed), ["notchWindow"]);
});
