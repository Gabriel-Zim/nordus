import assert from "node:assert/strict";
import test from "node:test";

import { chatLinkFromCommandLine, chatLinkFrom } from "./chat-link.mjs";
import { chatLinkFor, cleanText, fromNotchWindow, NOTCH_LIMITS, parseDecision, parseNotchFeed } from "./notch-ipc.mjs";

const labels = { done: "Pronto", approve: "Aprovar", decline: "Recusar", open: "Abrir no app", several: "{count} agentes" };
const agent = (extra = {}) => ({ id: "bot-1", name: "Maya", color: "#377FE6", status: "Gerando imagem", botId: "bot-1", threadId: "thread-1", ...extra });
const approval = (extra = {}) => ({
  id: "thread-1:request-1",
  name: "Maya",
  color: "#d94b52",
  header: "Maya pede sua aprovação",
  text: "Quero publicar a página do artigo.",
  decidable: true,
  botId: "bot-1",
  threadId: "thread-1",
  ...extra,
});
const feed = (extra = {}) => ({ agents: [agent()], approvals: [approval()], labels, ...extra });

test("a good snapshot passes and keeps only what the notch draws", () => {
  const parsed = parseNotchFeed(feed({ secret: "x", agents: [agent({ token: "abc", url: "https://example.com" })] }));

  assert.deepEqual(parsed.agents, [{ id: "bot-1", name: "Maya", color: "#377fe6", botId: "bot-1", threadId: "thread-1", status: "Gerando imagem" }]);
  assert.deepEqual(parsed.approvals[0], { ...approval(), color: "#d94b52" });
  assert.deepEqual(parsed.labels, labels);
  assert.equal("secret" in parsed, false);
});

test("an empty snapshot is valid", () => {
  assert.deepEqual(parseNotchFeed({ agents: [], approvals: [], labels }), { agents: [], approvals: [], labels });
});

test("anything that is not the expected shape is refused", () => {
  const bad = [
    undefined,
    null,
    "text",
    42,
    [],
    {},
    { agents: [], approvals: [] },
    { agents: {}, approvals: [], labels },
    { agents: [], approvals: "x", labels },
    { agents: [], approvals: [], labels: { ...labels, done: "" } },
    { agents: [], approvals: [], labels: { ...labels, open: 7 } },
    { agents: [], approvals: [], labels: { done: "Pronto" } },
    feed({ agents: [null] }),
    feed({ agents: [agent({ id: "" })] }),
    feed({ agents: [agent({ id: 12 })] }),
    feed({ agents: [agent({ id: "bad\nid" })] }),
    feed({ agents: [agent({ name: undefined })] }),
    feed({ agents: [agent({ status: {} })] }),
    feed({ approvals: [approval({ decidable: "yes" })] }),
    feed({ approvals: [approval({ text: undefined })] }),
    feed({ approvals: [approval({ header: 3 })] }),
  ];
  for (const value of bad) assert.equal(parseNotchFeed(value), null, JSON.stringify(value));
});

test("text is flattened, stripped of invisible and direction-changing characters, and cut", () => {
  assert.equal(cleanText("  a\n\tb   c  ", 20), "a b c");
  assert.equal(cleanText("pay\u202Etxt.exe", 40), "pay txt.exe");
  assert.equal(cleanText("a\u200Bb\u0007c", 40), "a b c");
  assert.equal(cleanText("x".repeat(100), 10), `${"x".repeat(9)}…`);
  assert.equal(cleanText("😀😀😀😀😀", 3), "😀😀…");
  assert.equal(cleanText(5, 10), null);

  const parsed = parseNotchFeed(feed({ approvals: [approval({ text: `${"palavra ".repeat(60)}` })] }));
  assert.ok([...parsed.approvals[0].text].length <= NOTCH_LIMITS.text);
  assert.ok(parsed.approvals[0].text.endsWith("…"));
});

test("colors must be six hex digits, else a neutral one is used", () => {
  const parsed = parseNotchFeed(feed({ agents: [agent({ color: "url(javascript:alert(1))" }), agent({ id: "b", color: "#FFF" }), agent({ id: "c", color: undefined })] }));
  assert.deepEqual(parsed.agents.map((entry) => entry.color), ["#6b7280", "#6b7280", "#6b7280"]);
});

test("a conversation reference that is not plain is dropped, not trusted", () => {
  const parsed = parseNotchFeed(feed({ agents: [agent({ botId: "../x", threadId: "a b" }), agent({ id: "n", botId: 5, threadId: undefined })] }));
  assert.deepEqual(parsed.agents.map((entry) => [entry.botId, entry.threadId]), [[null, null], [null, null]]);
});

test("lists are capped and repeated ids are folded", () => {
  const many = Array.from({ length: 40 }, (_, index) => agent({ id: `bot-${index}` }));
  assert.equal(parseNotchFeed(feed({ agents: many, approvals: [] })).agents.length, NOTCH_LIMITS.agents);

  const repeated = parseNotchFeed(feed({ agents: [agent(), agent({ status: "Outra coisa" })], approvals: [] }));
  assert.equal(repeated.agents.length, 1);
  assert.equal(repeated.agents[0].status, "Gerando imagem");
});

test("a decision is exactly an id and approve or decline", () => {
  assert.deepEqual(parseDecision({ id: "thread-1:request-1", decision: "approve" }), { id: "thread-1:request-1", decision: "approve" });
  assert.deepEqual(parseDecision({ id: "x", decision: "decline", extra: true }), { id: "x", decision: "decline" });
  for (const value of [
    null,
    undefined,
    "approve",
    {},
    { id: "x" },
    { decision: "approve" },
    { id: "x", decision: "allow" },
    { id: "x", decision: "APPROVE" },
    { id: "", decision: "approve" },
    { id: 1, decision: "approve" },
    { id: "a\u0000b", decision: "approve" },
    { id: "x".repeat(201), decision: "approve" },
    [{ id: "x", decision: "approve" }],
  ]) assert.equal(parseDecision(value), null, JSON.stringify(value));
});

test("only the notch window's own top frame is believed", () => {
  const frame = {};
  const webContents = { mainFrame: frame, isDestroyed: () => false };
  assert.equal(fromNotchWindow({ sender: webContents, senderFrame: frame }, webContents), true);
  assert.equal(fromNotchWindow({ sender: webContents, senderFrame: {} }, webContents), false, "a child frame");
  assert.equal(fromNotchWindow({ sender: webContents, senderFrame: null }, webContents), false);
  assert.equal(fromNotchWindow({ sender: {}, senderFrame: frame }, webContents), false, "another window");
  assert.equal(fromNotchWindow({ sender: webContents, senderFrame: frame }, null), false);
  assert.equal(fromNotchWindow({ sender: webContents, senderFrame: frame }, { ...webContents, isDestroyed: () => true }), false);
  assert.equal(fromNotchWindow(undefined, webContents), false);
});

test("the open action builds the link the app already understands", () => {
  const link = chatLinkFor({ botId: "1f72ec75-821b", threadId: "2633ea27-cc9d" });
  assert.equal(link, "nordus://thread/2633ea27-cc9d?bot=1f72ec75-821b");
  assert.equal(chatLinkFrom(link), link);
  assert.equal(chatLinkFromCommandLine([link]), link);
  assert.equal(chatLinkFor({ botId: "x", threadId: null }), null);
  assert.equal(chatLinkFor({ botId: "a/b", threadId: "t" }), null);
  assert.equal(chatLinkFor(null), null);
});
