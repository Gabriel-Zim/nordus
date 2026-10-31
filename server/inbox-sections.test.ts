import { describe, expect, it } from "vitest";

import type { ApprovalItem } from "../shared/approvals.ts";
import type { NotificationLogEntry } from "../shared/notification.ts";
import { inboxSections, type InboxViewer } from "./inbox-sections.ts";

const everything = { bot: () => true, thread: () => true, group: () => true };
const viewer = (extra: Partial<InboxViewer> = {}): InboxViewer => ({ admin: false, email: "marina@example.test", visible: everything, ...extra });

const entry = (id: string, extra: Partial<NotificationLogEntry> = {}): NotificationLogEntry => ({
  id,
  at: 1_000 + Number(id.replace(/\D/g, "") || 0),
  kind: "finished",
  botId: "atlas",
  botName: "Atlas",
  threadId: "t-atlas",
  title: `Title ${id}`,
  body: `Body ${id}`,
  read: false,
  ...extra,
} as NotificationLogEntry);

const waiting = (requestId: string): ApprovalItem => ({
  id: `t-atlas.${requestId}`, kind: "permission", botId: "atlas", botName: "Atlas", threadId: "t-atlas", messageId: requestId, requestId,
  title: "Atlas quer rodar", summary: "", fields: [], risk: "normal", requestedAt: 1, decider: "Administradores", canDecide: true, action: "decide",
});

describe("what was sent to a person", () => {
  it("puts a notification addressed to them under 'Para você', and keeps it out of everyone else's list", () => {
    const sent = entry("n1", { toPersons: ["Marina@Example.test"] });
    const log = [sent, entry("n2")];
    const mine = inboxSections({ waiting: [], log, viewer: viewer() });
    expect(mine.forYou.map((note) => note.id)).toEqual(["n1"]);
    expect(mine.before.map((note) => note.id)).toEqual(["n2"]);
    const theirs = inboxSections({ waiting: [], log, viewer: viewer({ email: "ada@example.test" }) });
    expect(theirs.forYou).toEqual([]);
    expect(theirs.before.map((note) => note.id)).toEqual(["n2"]);
  });
});

describe("what came before", () => {
  it("lists the newest first and never what a person is not shown", () => {
    const log = [
      entry("n1"),
      entry("n2", { botId: "hidden" }),
      entry("n3", { threadId: "t-hidden" }),
      entry("n4", { groupId: "room-hidden" }),
      entry("n5"),
    ];
    const sections = inboxSections({
      waiting: [],
      log,
      viewer: viewer({ visible: { bot: (id) => id !== "hidden", thread: (id) => id !== "t-hidden", group: (id) => id !== "room-hidden" } }),
    });
    expect(sections.before.map((note) => note.id)).toEqual(["n5", "n1"]);
  });

  it("leaves what was spent to the administrators", () => {
    const log = [entry("n1", { kind: "spend" })];
    expect(inboxSections({ waiting: [], log, viewer: viewer() }).before).toEqual([]);
    expect(inboxSections({ waiting: [], log, viewer: viewer({ admin: true }) }).before.map((note) => note.id)).toEqual(["n1"]);
  });

  it("leaves the day's summary to the administrators: it names the bots and rooms of every client, and is filed under the last one", () => {
    const summary = entry("n1", {
      kind: "daily-digest", botId: "cliente-b", botName: "Cliente B", threadId: "t-cliente-b",
      title: "Resumo do dia: 4 novidades", body: "Cliente A: Cliente A terminou · Cliente B: Cliente B terminou · Vendas: Vendas em Sala X terminou",
    });
    const onlyTheLastBot = { bot: (id: string) => id === "cliente-b", thread: (id: string) => id === "t-cliente-b", group: () => true };
    const member = inboxSections({ waiting: [], log: [summary], viewer: viewer({ visible: onlyTheLastBot }) });
    expect(member.before).toEqual([]);
    expect(member.forYou).toEqual([]);
    expect(inboxSections({ waiting: [], log: [summary], viewer: viewer({ admin: true }) }).before.map((note) => note.id)).toEqual(["n1"]);
  });

  it("does not repeat a notification whose request is still waiting in the top list", () => {
    const log = [entry("n1", { requestId: "req-1" }), entry("n2", { requestId: "req-2" })];
    const sections = inboxSections({ waiting: [waiting("req-1")], log, viewer: viewer() });
    expect(sections.waiting.map((item) => item.requestId)).toEqual(["req-1"]);
    expect(sections.before.map((note) => note.id)).toEqual(["n2"]);
  });

  it("carries the fields the page needs to open the card and mark it resolved", () => {
    const log = [entry("n1", { requestId: "req-1", groupId: "room-1", resolvedAt: 5_000, read: true })];
    const [note] = inboxSections({ waiting: [], log, viewer: viewer() }).before;
    expect(note).toEqual({
      id: "n1", at: 1_001, kind: "finished", botId: "atlas", botName: "Atlas", threadId: "t-atlas", groupId: "room-1",
      title: "Title n1", body: "Body n1", requestId: "req-1", read: true, resolvedAt: 5_000,
    });
  });

  it("keeps the lists short", () => {
    const log = Array.from({ length: 120 }, (_, index) => entry(`n${index + 1}`, index < 60 ? { toPersons: ["marina@example.test"] } : {}));
    const sections = inboxSections({ waiting: [], log, viewer: viewer() });
    expect(sections.forYou).toHaveLength(30);
    expect(sections.before).toHaveLength(50);
  });
});
