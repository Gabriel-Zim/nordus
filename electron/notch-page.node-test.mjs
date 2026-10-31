import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

import { NOTCH_ARM_MS } from "./notch-ipc.mjs";

const SOURCE = readFileSync(new URL("./notch-page.js", import.meta.url), "utf8");
const MARKUP = readFileSync(new URL("./notch.html", import.meta.url), "utf8");
const IDS = ["shape", "avatars", "text", "header", "sentence", "approve", "decline", "open", "left", "right"];
const LAYOUT = { kind: "notch", left: 100, gap: 200, right: 100, strip: 36, panel: 128 };
const LOCKED_MS = 4000;

const startsDisabled = (id) => new RegExp(`<button id="${id}"[^>]*\\sdisabled[\\s>]`).test(MARKUP);

function element(id) {
  const listeners = [];
  const self = {
    id,
    disabled: startsDisabled(id),
    hidden: false,
    textContent: "",
    className: "",
    dataset: {},
    children: [],
    vars: {},
    classes: new Set(),
    classList: { toggle: (name, on) => (on ? self.classes.add(name) : self.classes.delete(name)) },
    style: { setProperty: (name, value) => { self.vars[name] = value; } },
    addEventListener: (type, fn) => { if (type === "click") listeners.push(fn); },
    replaceChildren: (...children) => { self.children = children; },
    click() { if (!self.disabled) for (const fn of listeners) fn(); },
  };
  return self;
}

function loadPage() {
  let clock = 5_000;
  const queue = [];
  let nextId = 1;
  const elements = new Map(IDS.map((id) => [id, element(id)]));
  const calls = { decide: [], open: 0 };
  let paint = null;
  const sandbox = {
    window: {
      notchWindow: {
        onView: (callback) => { paint = callback; },
        decide: (id, decision) => calls.decide.push({ id, decision }),
        open: () => { calls.open += 1; },
      },
    },
    document: { getElementById: (id) => elements.get(id), createElement: () => element("created") },
    Date: { now: () => clock },
    setTimeout: (fn, ms) => { const id = nextId++; queue.push({ id, at: clock + ms, fn }); return id; },
    clearTimeout: (id) => { const at = queue.findIndex((job) => job.id === id); if (at >= 0) queue.splice(at, 1); },
  };
  vm.runInNewContext(SOURCE, sandbox);
  assert.equal(typeof paint, "function", "the page asks to be drawn");
  const advance = (ms) => {
    const end = clock + ms;
    for (;;) {
      queue.sort((a, b) => a.at - b.at);
      const job = queue[0];
      if (!job || job.at > end) break;
      clock = job.at;
      queue.shift();
      job.fn();
    }
    clock = end;
  };
  const view = (id, { decidable = true, text = "" } = {}) => ({
    phase: "approval",
    expanded: true,
    avatars: [{ initial: "M", color: "#d94b52" }],
    text,
    approval: { id, header: "Maya pede sua aprovação", text: "Quero publicar a página do artigo.", decidable },
    buttons: { approve: "Aprovar", decline: "Recusar", open: "Abrir no app" },
    layout: LAYOUT,
  });
  const working = () => ({ phase: "working", expanded: false, avatars: [], text: "Gerando imagem", approval: null, buttons: null, layout: LAYOUT });
  const get = (id) => elements.get(id);
  return { paint: (value) => paint(value), advance, view, working, get, calls, click: (id) => get(id).click() };
}

test("the answer buttons start disabled, before anything has been drawn", () => {
  const page = loadPage();
  for (const id of ["approve", "decline", "open"]) assert.equal(page.get(id).disabled, true, id);
  for (const id of ["left", "right"]) assert.equal(page.get(id).disabled, false, id);
});

test("a request that appears cannot be answered until it has been on screen a moment", () => {
  const page = loadPage();
  page.paint(page.view("a"));

  assert.equal(page.get("approve").disabled, true);
  assert.equal(page.get("decline").disabled, true);
  page.click("approve");
  page.click("decline");
  page.advance(NOTCH_ARM_MS - 1);
  page.click("approve");
  assert.deepEqual(page.calls.decide, []);

  page.advance(1);
  assert.equal(page.get("approve").disabled, false);
  assert.equal(page.get("decline").disabled, false);
  page.click("approve");
  assert.deepEqual(page.calls.decide, [{ id: "a", decision: "approve" }]);
});

test("after a tap the buttons stay locked, and the next request does not inherit the lock", () => {
  const page = loadPage();
  page.paint(page.view("a"));
  page.advance(NOTCH_ARM_MS);
  page.click("approve");
  assert.equal(page.get("approve").disabled, true);
  assert.equal(page.get("decline").disabled, true);

  page.advance(LOCKED_MS - 1);
  page.click("decline");
  assert.equal(page.calls.decide.length, 1);
  page.advance(1);
  assert.equal(page.get("approve").disabled, false);
  page.click("decline");
  assert.deepEqual(page.calls.decide.map((call) => call.decision), ["approve", "decline"]);
});

test("a different request replacing the one just answered waits its own moment before a tap counts", () => {
  const page = loadPage();
  page.paint(page.view("a"));
  page.advance(NOTCH_ARM_MS);
  page.click("approve");
  page.advance(150);

  page.paint(page.view("b", { text: "+1" }));
  assert.equal(page.get("approve").disabled, true, "the second tap meant for the first request lands on a disabled button");
  page.click("approve");
  page.advance(NOTCH_ARM_MS - 1);
  page.click("approve");
  assert.deepEqual(page.calls.decide, [{ id: "a", decision: "approve" }]);

  page.advance(1);
  page.click("approve");
  assert.deepEqual(page.calls.decide, [{ id: "a", decision: "approve" }, { id: "b", decision: "approve" }]);
});

test("drawing the same request again neither restarts its wait nor frees its lock", () => {
  const page = loadPage();
  page.paint(page.view("a"));
  page.advance(NOTCH_ARM_MS - 300);
  page.paint(page.view("a", { text: "+1" }));
  page.advance(300);
  page.click("approve");
  assert.equal(page.calls.decide.length, 1, "the wait ran from the first time it was drawn");

  page.advance(500);
  page.paint(page.view("a", { text: "+2" }));
  assert.equal(page.get("approve").disabled, true);
  page.click("decline");
  assert.equal(page.calls.decide.length, 1, "still locked after its tap");
});

test("the button that opens the app also waits while the request fades in", () => {
  const page = loadPage();
  page.paint(page.view("a", { decidable: false }));
  assert.equal(page.get("open").hidden, false);
  assert.equal(page.get("approve").hidden, true);

  page.click("open");
  assert.equal(page.calls.open, 0);
  page.advance(NOTCH_ARM_MS);
  page.click("open");
  assert.equal(page.calls.open, 1);
});

test("the wings of the strip open the app at any time", () => {
  const page = loadPage();
  page.paint(page.working());
  page.click("left");
  page.click("right");
  assert.equal(page.calls.open, 2);
});

test("a request that goes away and comes back is a new appearance", () => {
  const page = loadPage();
  page.paint(page.view("a"));
  page.advance(NOTCH_ARM_MS);
  assert.equal(page.get("approve").disabled, false);

  page.paint(page.working());
  page.paint(page.view("a"));
  assert.equal(page.get("approve").disabled, true);
  page.advance(NOTCH_ARM_MS);
  assert.equal(page.get("approve").disabled, false);
});

test("a window that comes back on screen with the same request waits again", () => {
  const page = loadPage();
  page.paint(page.view("a"));
  page.advance(NOTCH_ARM_MS);
  assert.equal(page.get("approve").disabled, false);

  page.paint({ ...page.view("a"), appearing: true });
  assert.equal(page.get("approve").disabled, true);
  page.click("approve");
  page.advance(NOTCH_ARM_MS - 1);
  page.click("approve");
  assert.deepEqual(page.calls.decide, []);
  page.advance(1);
  page.click("approve");
  assert.deepEqual(page.calls.decide, [{ id: "a", decision: "approve" }]);
});

test("coming back on screen with no request to answer changes nothing", () => {
  const page = loadPage();
  page.paint({ ...page.working(), appearing: true });
  assert.equal(page.get("approve").disabled, true);
  page.paint(page.view("a"));
  page.advance(NOTCH_ARM_MS);
  assert.equal(page.get("approve").disabled, false);
});
