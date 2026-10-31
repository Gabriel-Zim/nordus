import assert from "node:assert/strict";
import test from "node:test";

import { createNotchMachine, NOTCH_APPEAR_MS, NOTCH_DONE_MS } from "./notch-state.mjs";

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

test("nothing is shown while nobody works", () => {
  const machine = createNotchMachine();
  assert.equal(machine.view().visible, false);
  assert.equal(machine.phase(), "idle");
  assert.equal(machine.wakeAt(), null);
  machine.feed(feed(), 1000);
  assert.equal(machine.view().visible, false);
  assert.equal(machine.phase(), "idle");
});

test("an agent that starts shows its avatar on the left and a short status on the right", () => {
  const machine = createNotchMachine();
  machine.feed(feed({ agents: [agent("Maya")] }), 1000);

  assert.equal(machine.phase(), "working");
  assert.equal(machine.view().visible, false, "held back for a moment so a quick reply does not flash");
  assert.equal(machine.wakeAt(), 1000 + NOTCH_APPEAR_MS);

  machine.advance(1000 + NOTCH_APPEAR_MS);
  const view = machine.view();
  assert.equal(view.visible, true);
  assert.equal(view.phase, "working");
  assert.equal(view.expanded, false);
  assert.deepEqual(view.avatars, [{ initial: "M", color: "#377fe6" }]);
  assert.equal(view.text, "Gerando imagem");
  assert.deepEqual(view.target, { botId: "bot-Maya", threadId: "thread-Maya" });
  assert.equal(machine.wakeAt(), null);
});

test("work that ends before it was shown never appears and says nothing", () => {
  const machine = createNotchMachine();
  machine.feed(feed({ agents: [agent("Maya")] }), 1000);
  machine.feed(feed(), 1000 + NOTCH_APPEAR_MS - 1);

  assert.equal(machine.phase(), "idle");
  assert.equal(machine.view().visible, false);
  assert.equal(machine.wakeAt(), null);
});

test("when the work ends it says Pronto for a moment, then goes away", () => {
  const machine = createNotchMachine();
  machine.feed(feed({ agents: [agent("Maya")] }), 0);
  machine.advance(NOTCH_APPEAR_MS);
  machine.feed(feed(), 5000);

  const done = machine.view();
  assert.equal(machine.phase(), "done");
  assert.equal(done.visible, true);
  assert.equal(done.text, "Pronto");
  assert.deepEqual(done.avatars, [{ initial: "M", color: "#377fe6" }]);
  assert.deepEqual(done.target, { botId: "bot-Maya", threadId: "thread-Maya" });
  assert.equal(machine.wakeAt(), 5000 + NOTCH_DONE_MS);

  machine.advance(5000 + NOTCH_DONE_MS - 1);
  assert.equal(machine.view().visible, true);
  machine.advance(5000 + NOTCH_DONE_MS);
  assert.equal(machine.phase(), "idle");
  assert.equal(machine.view().visible, false);
  assert.equal(machine.wakeAt(), null);
});

test("an approval opens at once below the notch with the sentence and both answers", () => {
  const machine = createNotchMachine();
  machine.feed(feed({ approvals: [approval("Maya")] }), 2000);

  const view = machine.view();
  assert.equal(machine.phase(), "approval");
  assert.equal(view.visible, true);
  assert.equal(view.expanded, true);
  assert.deepEqual(view.approval, { id: "thread-Maya:request-Maya", header: "Maya pede sua aprovação", text: "Quero publicar a página do artigo.", decidable: true });
  assert.deepEqual(view.buttons, { approve: "Aprovar", decline: "Recusar", open: "Abrir no app" });
  assert.equal(view.text, "");
  assert.deepEqual(view.target, { botId: "bot-Maya", threadId: "thread-Maya" });
});

test("an action that must be decided in the app is marked so the notch cannot answer it", () => {
  const machine = createNotchMachine();
  machine.feed(feed({ approvals: [approval("Maya", { decidable: false })] }), 0);
  assert.equal(machine.view().approval.decidable, false);
});

test("approval beats working, and working returns once the approval is answered", () => {
  const machine = createNotchMachine();
  machine.feed(feed({ agents: [agent("Maya")] }), 0);
  machine.advance(NOTCH_APPEAR_MS);
  machine.feed(feed({ agents: [agent("Maya")], approvals: [approval("Maya")] }), 1000);
  assert.equal(machine.phase(), "approval");
  assert.equal(machine.view().expanded, true);

  machine.feed(feed({ agents: [agent("Maya")] }), 3000);
  assert.equal(machine.phase(), "working");
  assert.equal(machine.view().visible, true, "already on screen, so no second wait");
  assert.equal(machine.view().expanded, false);

  machine.feed(feed(), 4000);
  assert.equal(machine.phase(), "done");
});

test("the approval on screen stays put while others queue behind it", () => {
  const machine = createNotchMachine();
  machine.feed(feed({ approvals: [approval("Maya")] }), 0);
  machine.feed(feed({ approvals: [approval("Caio"), approval("Maya")] }), 100);

  const view = machine.view();
  assert.equal(view.approval.id, "thread-Maya:request-Maya");
  assert.equal(view.text, "+1");

  machine.feed(feed({ approvals: [approval("Caio")] }), 200);
  assert.equal(machine.view().approval.id, "thread-Caio:request-Caio");
  assert.equal(machine.view().text, "");
});

test("several agents show stacked avatars and a count", () => {
  const machine = createNotchMachine();
  const agents = [agent("Maya"), agent("Caio"), agent("Rita"), agent("Davi")];
  machine.feed(feed({ agents }), 0);
  machine.advance(NOTCH_APPEAR_MS);

  const view = machine.view();
  assert.equal(view.avatars.length, 3);
  assert.deepEqual(view.avatars.map((avatar) => avatar.initial), ["M", "C", "R"]);
  assert.equal(view.text, "4 agentes");
  assert.deepEqual(view.target, { botId: "bot-Maya", threadId: "thread-Maya" });

  machine.feed(feed({ agents: agents.slice(0, 2) }), 500);
  assert.equal(machine.view().text, "2 agentes");
  machine.feed(feed({ agents: agents.slice(0, 1) }), 600);
  assert.equal(machine.view().text, "Gerando imagem");
});

test("new work during Pronto replaces it without waiting", () => {
  const machine = createNotchMachine();
  machine.feed(feed({ agents: [agent("Maya")] }), 0);
  machine.advance(NOTCH_APPEAR_MS);
  machine.feed(feed(), 3000);
  assert.equal(machine.phase(), "done");

  machine.feed(feed({ agents: [agent("Caio")] }), 3500);
  assert.equal(machine.phase(), "working");
  assert.equal(machine.view().visible, true);
  assert.equal(machine.view().avatars[0].initial, "C");
  assert.equal(machine.wakeAt(), null);
});

test("the stretch after Pronto starts over from nothing", () => {
  const machine = createNotchMachine();
  machine.feed(feed({ agents: [agent("Maya")] }), 0);
  machine.advance(NOTCH_APPEAR_MS);
  machine.feed(feed(), 1000);
  machine.advance(1000 + NOTCH_DONE_MS);

  machine.feed(feed({ agents: [agent("Maya")] }), 10_000);
  assert.equal(machine.view().visible, false);
  assert.equal(machine.wakeAt(), 10_000 + NOTCH_APPEAR_MS);
});

test("an approval that vanishes with the agent also ends in Pronto", () => {
  const machine = createNotchMachine();
  machine.feed(feed({ approvals: [approval("Maya")] }), 0);
  machine.feed(feed(), 1500);

  assert.equal(machine.phase(), "done");
  assert.deepEqual(machine.view().avatars, [{ initial: "M", color: "#d94b52" }]);
});

test("reset clears everything", () => {
  const machine = createNotchMachine();
  machine.feed(feed({ approvals: [approval("Maya")] }), 0);
  machine.reset();

  assert.equal(machine.phase(), "idle");
  assert.equal(machine.view().visible, false);
  assert.equal(machine.wakeAt(), null);
});

test("a name without letters still gets an avatar", () => {
  const machine = createNotchMachine();
  machine.feed(feed({ approvals: [approval("", { id: "x" })] }), 0);
  assert.equal(machine.view().avatars[0].initial, "?");
});
