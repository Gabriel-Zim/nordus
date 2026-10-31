import { describe, expect, it } from "vitest";
import type { WireMessage as Message } from "../../shared/wire.ts";
import { peerReplyGroups } from "./peer-turns";

const NOTE = (name: string) =>
  `[Message from @${name}, another bot in this Nordus workspace — not from your user. @${name} is waiting on your answer, so reply to them.]`;

const OPENED_NOTE = (name: string) =>
  `[Thread opened by @${name}, another bot in this Nordus workspace — @${name} is waiting on the result: do the work in this thread and end with a clear reply to them.]`;

const SENT_NOTE = (name: string) =>
  `[Thread opened by @${name}, another bot in this Nordus workspace — Ownership is yours: continue in this thread. Results, failures and questions stay here; the sender is not waiting and will not be resumed.]`;

const DELEGATED_NOTE = (name: string) =>
  `[Delegated by @${name}, another bot in this Nordus workspace — do the work and reply directly.]`;

const message = (id: string, extra: Partial<Message> = {}): Message =>
  ({ id, role: "bot", kind: "text", text: id, at: 1, ...extra });

const peerAsk = (id: string, at: number): Message =>
  message(id, { role: "user", at, text: `${NOTE("editordevideo")}\n\nFAÇA O EXPORT` });

const peerRequest = (id: string, at: number): Message =>
  message(id, { at, text: "@bluth FAÇA O EXPORT", from: { botId: "editordevideo", name: "editordevideo", color: "blue" }, roomRequest: { id: "q1", phase: "request", awaited: true } });

const person = (id: string, at: number): Message => message(id, { role: "user", at, text: "e para mim?" });

const ids = (groups: ReadonlyMap<string, readonly Message[]>, key: string) =>
  (groups.get(key) ?? []).map((reply) => reply.id);

describe("peerReplyGroups", () => {
  it("groups the replies the server proved answer a peer line", () => {
    const messages = [
      peerAsk("p1", 1),
      message("b1", { at: 2, requestMessageId: "p1", turnId: "t1" }),
      message("a1", { at: 3, kind: "activity", tool: { name: "Read", ok: true }, requestMessageId: "p1", turnId: "t1" }),
      message("b2", { at: 4, requestMessageId: "p1", turnId: "t1", turnTerminal: true }),
      message("mine", { role: "user", at: 5, text: "obrigado" }),
    ];
    expect(ids(peerReplyGroups(messages, "bluth"), "p1")).toEqual(["b1", "a1", "b2"]);
  });

  it("groups only the replies the rendered rows carry", () => {
    const messages = [
      peerAsk("p1", 1),
      message("b1", { at: 2, requestMessageId: "p1", turnId: "t1" }),
      message("b2", { at: 3, requestMessageId: "p1", turnId: "t1" }),
    ];
    expect(ids(peerReplyGroups(messages.slice(0, 2), "bluth"), "p1")).toEqual(["b1"]);
    expect(ids(peerReplyGroups(messages, "bluth"), "p1")).toEqual(["b1", "b2"]);
  });

  it("groups a thread a peer opened and is waiting on", () => {
    const messages = [
      message("p1", { role: "user", at: 1, text: `${OPENED_NOTE("editordevideo")}\n\nFAÇA O EXPORT` }),
      message("b1", { at: 2, requestMessageId: "p1", turnId: "t1" }),
      message("b2", { at: 3, requestMessageId: "p1", turnId: "t1", turnTerminal: true }),
    ];
    expect(ids(peerReplyGroups(messages, "bluth"), "p1")).toEqual(["b1", "b2"]);
  });

  it("keeps a question to the person out of the card, even inside the request's turn", () => {
    const messages = [
      peerAsk("p1", 1),
      message("q1", { at: 2, text: "Essas são as artes.\nNEEDS INPUT: Aprova?", requestMessageId: "p1", turnId: "t1" }),
      message("b2", { at: 3, requestMessageId: "p1", turnId: "t1", turnTerminal: true }),
    ];
    expect(ids(peerReplyGroups(messages, "bluth"), "p1")).toEqual(["b2"]);
  });

  it("keeps a reply carrying a file out of the card", () => {
    const messages = [
      peerAsk("p1", 1),
      message("f1", { at: 2, requestMessageId: "p1", turnId: "t1", attachments: [{ kind: "file", path: "/tmp/a.png", mime: "image/png", name: "a.png" }] }),
      message("b2", { at: 3, requestMessageId: "p1", turnId: "t1", turnTerminal: true }),
    ];
    expect(ids(peerReplyGroups(messages, "bluth"), "p1")).toEqual(["b2"]);
  });

  it("keeps the answer to a one-way request visible, with or without the wire stamp", () => {
    for (const roomRequest of [
      { id: "q1", phase: "request" as const },
      { id: "q1", phase: "request" as const, awaited: false },
    ]) {
      const messages = [
        message("p2", { at: 1, text: "@bluth FAÇA O EXPORT", from: { botId: "editordevideo", name: "editordevideo", color: "blue" }, roomRequest }),
        message("b1", { at: 2, turnId: "t9" }),
        message("b2", { at: 3, turnId: "t9", turnTerminal: true }),
      ];
      expect(peerReplyGroups(messages, "bluth").size).toBe(0);
    }
  });

  it("leaves a thread the bot opened on itself out of a card", () => {
    const own = message("o1", {
      role: "user",
      at: 1,
      text: "[Thread you opened yourself from #Principal. The request below is your own words, not the person's: do the work here and end with a clear result they can read.]\n\nFAÇA O EXPORT",
      peerAsk: { botId: "bluth", name: "bluth" },
    });
    const messages = [own, message("b1", { at: 2, requestMessageId: "o1", turnId: "t1", turnTerminal: true })];
    expect(peerReplyGroups(messages, "bluth").size).toBe(0);
    expect(peerReplyGroups(messages, "bluth", "bluth").size).toBe(0);
  });

  it("does not group the delivery of a peer that is not waiting for an answer", () => {
    for (const text of [SENT_NOTE("editordevideo"), DELEGATED_NOTE("editordevideo")]) {
      const messages = [
        message("p1", { role: "user", at: 1, text: `${text}\n\nFAÇA O EXPORT` }),
        message("b1", { at: 2, requestMessageId: "p1", turnId: "t1", turnTerminal: true }),
      ];
      expect(peerReplyGroups(messages, "bluth").size).toBe(0);
    }
  });

  it("groups a coordinate_bots request by the turn it started", () => {
    const messages = [
      message("u0", { role: "user", at: 1, text: "pedido antigo" }),
      peerRequest("p2", 2),
      message("a1", { at: 3, kind: "activity", tool: { name: "Bash", ok: true }, turnId: "t9" }),
      message("b1", { at: 4, turnId: "t9" }),
      message("b2", { at: 5, turnId: "t9", turnTerminal: true }),
    ];
    expect(ids(peerReplyGroups(messages, "bluth"), "p2")).toEqual(["a1", "b1", "b2"]);
  });

  it("never hides a card, a result, another peer's line or the person's own words", () => {
    const messages = [
      peerAsk("p1", 1),
      message("card", { at: 2, kind: "options", requestMessageId: "p1", turnId: "t1", card: { title: "Aprovar", subtitle: "", options: ["Sim"] } }),
      message("b1", { at: 3, requestMessageId: "p1", turnId: "t1" }),
      message("result", { at: 4, text: "entrega", from: { botId: "editordevideo", name: "editordevideo", color: "blue" }, roomRequest: { id: "q1", phase: "result" } }),
      peerRequest("p2", 5),
      message("b2", { at: 6, requestMessageId: "p1", turnId: "t2" }),
    ];
    const groups = peerReplyGroups(messages, "bluth");
    expect(ids(groups, "p1")).toEqual(["b1"]);
    expect(ids(groups, "p2")).toEqual([]);
    expect(groups.has("card")).toBe(false);
    expect(groups.has("result")).toBe(false);
  });

  it("ends the group on a person's line in the middle", () => {
    const messages = [
      peerAsk("p1", 1),
      message("b1", { at: 2, requestMessageId: "p1", turnId: "t1" }),
      person("u1", 3),
      message("b2", { at: 4, requestMessageId: "p1", turnId: "t1" }),
      message("b3", { at: 5, requestMessageId: "p1", turnId: "t1" }),
    ];
    expect(ids(peerReplyGroups(messages, "bluth"), "p1")).toEqual(["b1"]);
    const turn = [
      peerRequest("p2", 1),
      message("b1", { at: 2, turnId: "t1" }),
      person("u1", 3),
      message("b2", { at: 4, turnId: "t1" }),
    ];
    expect(ids(peerReplyGroups(turn, "bluth"), "p2")).toEqual(["b1"]);
  });

  it("ends the group on the next peer line", () => {
    const messages = [
      peerRequest("p1", 1),
      message("b1", { at: 2, turnId: "t1" }),
      peerAsk("p2", 3),
      message("b2", { at: 4, turnId: "t1" }),
      message("b3", { at: 5, requestMessageId: "p2", turnId: "t2" }),
    ];
    const groups = peerReplyGroups(messages, "bluth");
    expect(ids(groups, "p1")).toEqual(["b1"]);
    expect(ids(groups, "p2")).toEqual(["b3"]);
  });

  it("leaves out replies with no proven link", () => {
    const messages = [
      peerAsk("p1", 1),
      message("b1", { at: 2, turnId: "t1" }),
      peerRequest("p2", 3),
      message("b2", { at: 4, text: "sem turno nem pedido" }),
      message("b3", { at: 5, turnId: "t1" }),
      message("b4", { at: 6, requestMessageId: "outro", turnId: "t2" }),
    ];
    const groups = peerReplyGroups(messages, "bluth");
    expect(ids(groups, "p1")).toEqual([]);
    expect(ids(groups, "p2")).toEqual([]);
  });

  it("never hides a reply to a harness line that has no provenance note", () => {
    const retry = message("p1", {
      role: "user",
      at: 1,
      text: "[Retry requested by Chief, your Chief of Staff, after this thread's last run stopped. Continue the request above from where it stopped and finish it.]",
      peerAsk: { botId: "chief", name: "Chief" },
    });
    const messages = [retry, message("b1", { at: 2, requestMessageId: "p1", turnId: "t1", turnTerminal: true })];
    expect(peerReplyGroups(messages, "bluth").size).toBe(0);
  });

  it("takes the first turn after the request, never one already in the transcript", () => {
    const messages = [
      message("old", { at: 1, turnId: "t1", turnTerminal: true }),
      peerRequest("p1", 2),
      message("card", { at: 3, kind: "options", turnId: "t2", card: { title: "Aprovar", subtitle: "", options: ["Sim"] } }),
      message("b1", { at: 4, turnId: "t2" }),
      message("b2", { at: 5, turnId: "t2", turnTerminal: true }),
    ];
    expect(ids(peerReplyGroups(messages, "bluth"), "p1")).toEqual(["b1", "b2"]);
  });

  it("ignores a bot's own request line in a room and a result line", () => {
    const own = message("p3", { text: "@editordevideo faça", from: { botId: "bluth", name: "bluth", color: "green" }, roomRequest: { id: "q2", phase: "request" } });
    const result = message("p4", { text: "feito", from: { botId: "editordevideo", name: "editordevideo", color: "blue" }, roomRequest: { id: "q3", phase: "result" } });
    expect(peerReplyGroups([own, message("b1", { turnId: "t1" }), result], "bluth").size).toBe(0);
  });

  it("keeps an incident report's answer out of a card that never draws it", () => {
    const report = message("p1", { role: "user", peerAsk: { botId: "ada", name: "Ada", incident: { threadId: "ada-task" } }, text: `${NOTE("ada")}\n\nIncident report` });
    const messages = [report, message("b1", { requestMessageId: "p1", turnId: "t1" })];
    expect(peerReplyGroups(messages, "clive").size).toBe(0);
  });
});
