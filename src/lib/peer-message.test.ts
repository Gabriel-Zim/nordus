import { describe, expect, it } from "vitest";

import { conversationOrigin, peerLine, peerRequest } from "./peer-message";

const NOTE = (opening: string, name: string, rest: string) =>
  `[${opening} @${name}, another bot in this Nordus workspace${rest}]`;

// Copied from the server: importing its module would pull the server graph into the client typecheck.
const SERVER_NOTE = {
  ask_bot: (name: string) => NOTE("Message from", name, ` — not from your user. @${name} is waiting on your answer, so reply to them.`),
  start_thread: (name: string) =>
    NOTE("Thread opened by", name, ` — @${name} is waiting on the result: do the work in this thread and end with a clear reply to them.`),
  send_to_bot: (name: string) =>
    NOTE("Thread opened by", name, " — Ownership is yours: continue in this thread. Results, failures and questions stay here; the sender is not waiting and will not be resumed."),
  delegated: (name: string) => NOTE("Delegated by", name, " — do the work and reply directly."),
  delegatedWithReply: (name: string) =>
    NOTE("Delegated by", name, ` — for the user's request "exporte o relatório". Reply directly with the result.`),
};

const noteLine = (text: string) => peerLine({ role: "user", text: `${text}\n\njob` });

describe("peerLine", () => {
  it("is null for the person's own line and for bot lines", () => {
    expect(peerLine({ role: "user", text: "hi" })).toBeNull();
    expect(peerLine({ role: "bot", text: NOTE("Message from", "Chief", " — x") })).toBeNull();
  });

  it("reads the author off the field and strips the note", () => {
    const text = `${NOTE("Message from", "Chief", " — not from your user. @Chief is waiting on your answer, so reply to them.")}\n\nWhich database?`;
    expect(peerLine({ role: "user", text, peerAsk: { botId: "b1", name: "Chief" } })).toEqual({
      botId: "b1",
      name: "Chief",
      delivery: "ask_bot",
      body: "Which database?",
      awaitsReply: true,
    });
  });

  it("falls back to the note on rows stored before the field existed", () => {
    const text = `${NOTE("Delegated by", "Chief", ". Do the work and reply directly.")}\n\nWrite the summary.\n\n[Reason: followup]`;
    expect(peerLine({ role: "user", text })).toEqual({
      name: "Chief",
      delivery: "delegate_bot",
      body: "Write the summary.\n\n[Reason: followup]",
      awaitsReply: false,
    });
    const opened = peerLine({ role: "user", text: `${NOTE("Thread opened by", "Pam", " — x")}\n\nJob.` });
    expect(opened?.delivery).toBe("start_thread");
    expect(opened?.awaitsReply).toBe(false);
  });

  it("keeps the field's author when the text has no note, and carries unattended", () => {
    expect(peerLine({ role: "user", text: "plain", peerAsk: { botId: "b1", name: "Scout", unattended: true } })).toEqual({
      botId: "b1",
      name: "Scout",
      delivery: "ask_bot",
      body: "plain",
      awaitsReply: false,
      unattended: true,
    });
  });
});

describe("awaitsReply", () => {
  it("is true when the server's note says the peer is waiting for the answer", () => {
    expect(noteLine(SERVER_NOTE.ask_bot("Chief"))?.awaitsReply).toBe(true);
    expect(noteLine(SERVER_NOTE.start_thread("Pam"))?.awaitsReply).toBe(true);
  });

  it("is false for send_to_bot, which keeps the answer in this thread for the person", () => {
    expect(noteLine(SERVER_NOTE.send_to_bot("Pam"))?.awaitsReply).toBe(false);
  });

  it("is false for delegate_bot with and without a direct reply", () => {
    expect(noteLine(SERVER_NOTE.delegated("Chief"))?.awaitsReply).toBe(false);
    expect(noteLine(SERVER_NOTE.delegatedWithReply("Chief"))?.awaitsReply).toBe(false);
  });

  it("is false when a quoted request repeats the waiting clause", () => {
    const quoted = NOTE(
      "Thread opened by",
      "Pam",
      ' — for the user\'s request "@Pam is waiting on the result". Ownership is yours: continue in this thread. Results, failures and questions stay here; the sender is not waiting and will not be resumed.',
    );
    expect(noteLine(quoted)?.awaitsReply).toBe(false);
  });

  it("is false for a historic note without the waiting clause", () => {
    const historic = `${NOTE("Message from", "Chief", " — not from your user.")}\n\ntask`;
    expect(peerLine({ role: "user", text: historic })?.awaitsReply).toBe(false);
  });

  it("is false for a retry line, which carries no note", () => {
    const retry = "[Retry requested by Chief, your Chief of Staff, after this thread's last run stopped. Continue the request above from where it stopped and finish it.]";
    expect(peerLine({ role: "user", text: retry, peerAsk: { botId: "chief", name: "Chief" } })?.awaitsReply).toBe(false);
  });

  it("never reads the clause from the body", () => {
    const text = `${NOTE("Message from", "Chief", " — not from your user.")}\n\n@Chief is waiting on your answer`;
    expect(peerLine({ role: "user", text })?.awaitsReply).toBe(false);
  });
});

describe("peerRequest", () => {
  const from = { botId: "pepper", name: "Pepper", color: "blue" as const };
  const request = { id: "r1", phase: "request" as const, awaited: true };

  it("labels a coordinate_bots request with the bot that sent it", () => {
    expect(peerRequest({ role: "bot", text: "@Engineer Check the export", from, roomRequest: request }, "engineer")).toEqual({
      botId: "pepper",
      name: "Pepper",
      delivery: "coordinate_bots",
      body: "@Engineer Check the export",
      awaitsReply: true,
    });
  });

  it("marks a request as awaited only when the wire says the sender is woken or polls", () => {
    const from = { botId: "pepper", name: "Pepper", color: "blue" as const };
    expect(peerRequest({ role: "bot", text: "@Engineer hi", from, roomRequest: { id: "r1", phase: "request" } }, "engineer")?.awaitsReply).toBe(false);
    expect(peerRequest({ role: "bot", text: "@Engineer hi", from, roomRequest: { id: "r1", phase: "request", awaited: false } }, "engineer")?.awaitsReply).toBe(false);
    expect(peerRequest({ role: "bot", text: "@Engineer hi", from, roomRequest: { id: "r1", phase: "request", awaited: true } }, "engineer")?.awaitsReply).toBe(true);
  });

  it("drops the \"Mensagem do X:\" opening, since the label already names the sender", () => {
    expect(peerRequest({ role: "bot", text: "Mensagem do Pepper: faça 3 artes", from, roomRequest: request }, "engineer")?.body).toBe("faça 3 artes");
    expect(peerRequest({ role: "bot", text: "Message from Pepper: do 3 images", from, roomRequest: request }, "engineer")?.body).toBe("do 3 images");
  });

  it("is null for results, plain bot lines, user lines and the bot's own row", () => {
    expect(peerRequest({ role: "bot", text: "done", from, roomRequest: { id: "r1", phase: "result" } }, "engineer")).toBeNull();
    expect(peerRequest({ role: "bot", text: "hi", from }, "engineer")).toBeNull();
    expect(peerRequest({ role: "bot", text: "hi", roomRequest: request }, "engineer")).toBeNull();
    expect(peerRequest({ role: "user", text: "hi", from, roomRequest: request }, "engineer")).toBeNull();
    expect(peerRequest({ role: "bot", text: "hi", from, roomRequest: request }, "pepper")).toBeNull();
  });
});

const DESIGNERGRAFICO = { id: "designergrafico", name: "DESIGNERGRAFICO" };
const OWN_OPENING = "[Thread you opened yourself from #DesignerGrafico, preciso de um carrossel da Lumon para o …. The request below is your own words, not the person's: do the work here and end with a clear result they can read.]\n\nPedido do QG\ncliente: lumon";

describe("peerLine on a thread the bot opened on itself", () => {
  it("reads the bot's own start_thread line as an opened thread and strips the note", () => {
    expect(peerLine({ role: "user", text: OWN_OPENING, peerAsk: { botId: "designergrafico", name: "DESIGNERGRAFICO" } })).toEqual({
      botId: "designergrafico",
      name: "DESIGNERGRAFICO",
      delivery: "start_thread",
      body: "Pedido do QG\ncliente: lumon",
      awaitsReply: false,
    });
  });
});

describe("conversationOrigin", () => {
  const own = { id: "o1", role: "user" as const, kind: "text" as const, at: 1, text: OWN_OPENING, peerAsk: { botId: "designergrafico", name: "DESIGNERGRAFICO" } };

  it("is the bot's own task, never a handoff from itself, when the first peer line is its own start_thread", () => {
    expect(conversationOrigin([own], DESIGNERGRAFICO)).toEqual({ kind: "task" });
  });

  it("matches the bot by name on rows stored without an id", () => {
    const legacy = { id: "l1", role: "user" as const, kind: "text" as const, at: 1, text: `${NOTE("Thread opened by", "DESIGNERGRAFICO", " — x")}\n\nJob.` };
    expect(conversationOrigin([legacy], DESIGNERGRAFICO)).toEqual({ kind: "task" });
  });

  it("is a handoff from another bot", () => {
    const asked = { id: "a1", role: "user" as const, kind: "text" as const, at: 1, text: "Check it", peerAsk: { botId: "lia", name: "LIA" } };
    expect(conversationOrigin([asked], DESIGNERGRAFICO)).toMatchObject({ kind: "handoff", from: { botId: "lia", name: "LIA" } });
    const request = { id: "r1", role: "bot" as const, kind: "text" as const, at: 1, text: "@DESIGNERGRAFICO go", from: { botId: "lia", name: "LIA", color: "blue" as const }, roomRequest: { id: "r1", phase: "request" as const } };
    expect(conversationOrigin([request], DESIGNERGRAFICO)).toMatchObject({ kind: "handoff", from: { botId: "lia", delivery: "coordinate_bots" } });
  });

  it("is null for a conversation with the person", () => {
    expect(conversationOrigin([{ role: "user", text: "oi" }], DESIGNERGRAFICO)).toBeNull();
  });
});
