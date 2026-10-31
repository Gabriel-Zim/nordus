import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";

import type { NotificationLogEntry } from "../shared/notification.ts";
import { DATA_DIR } from "./config.ts";
import { closeMessageDb, insertNotificationLog, logNotification, recentNotificationLog } from "./message-db.ts";

beforeEach(() => {
  closeMessageDb();
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
});

const entry = (id: string, extra: Partial<NotificationLogEntry> = {}): NotificationLogEntry => ({
  id, at: 1000, kind: "approval", botId: "b1", botName: "Otter", threadId: "t1", title: "t", body: "", read: false, ...extra,
});

describe("who a logged notification was for", () => {
  it("keeps the people it was addressed to, in order", () => {
    insertNotificationLog(entry("n1", { toPersons: ["ada@x.test", "bob@x.test"] }));
    insertNotificationLog(entry("n2", { at: 2000 }));
    const rows = recentNotificationLog();
    expect(rows.find((row) => row.id === "n1")?.toPersons).toEqual(["ada@x.test", "bob@x.test"]);
    expect(rows.find((row) => row.id === "n2")).not.toHaveProperty("toPersons");
  });

  it("stamps an addressed notification once and returns it with the people", () => {
    const logged = logNotification({ kind: "mention", botId: "", botName: "Bob", threadId: "t-room", title: "Bob mencionou você", body: "oi", toPersons: ["ada@x.test"] });
    expect(logged.toPersons).toEqual(["ada@x.test"]);
    expect(recentNotificationLog()).toEqual([logged]);
  });

  it("adds the column to a feed saved before it existed, and the old rows stay for everyone", () => {
    closeMessageDb();
    const old = new DatabaseSync(join(DATA_DIR, "messages.db"));
    old.exec(`CREATE TABLE notification_log (id TEXT PRIMARY KEY, at INTEGER NOT NULL, kind TEXT NOT NULL, bot_id TEXT NOT NULL,
      bot_name TEXT NOT NULL, thread_id TEXT NOT NULL, group_id TEXT, title TEXT NOT NULL, body TEXT NOT NULL, avatar_url TEXT,
      read INTEGER NOT NULL DEFAULT 0)`);
    old.prepare("INSERT INTO notification_log(id, at, kind, bot_id, bot_name, thread_id, title, body) VALUES ('old', 1, 'question', 'b', 'B', 'thread-1', 't', 'x')").run();
    old.close();
    expect(recentNotificationLog()[0]).toMatchObject({ id: "old" });
    expect(recentNotificationLog()[0]).not.toHaveProperty("toPersons");
    insertNotificationLog(entry("new", { at: 5000, toPersons: ["ada@x.test"] }));
    expect(recentNotificationLog().map((row) => [row.id, row.toPersons])).toEqual([["new", ["ada@x.test"]], ["old", undefined]]);
  });
});

describe("what the feed keeps of chatter", () => {
  it("keeps only the newest hundred mentions, so approvals always keep the rest of the feed", () => {
    for (let index = 0; index < 450; index++) insertNotificationLog(entry(`approval-${index}`, { at: 1_000 + index }));
    for (let index = 0; index < 300; index++) insertNotificationLog(entry(`mention-${index}`, { at: 10_000 + index, kind: "mention", botId: "", toPersons: ["ada@x.test"] }));
    const rows = recentNotificationLog();
    const mentions = rows.filter((row) => row.kind === "mention");
    expect(mentions).toHaveLength(100);
    expect(mentions.map((row) => row.id)).toEqual(Array.from({ length: 100 }, (_, index) => `mention-${299 - index}`));
    expect(rows.filter((row) => row.kind === "approval")).toHaveLength(400);
    expect(rows.find((row) => row.id === "approval-449")).toBeDefined();
    expect(rows).toHaveLength(500);
  });

  it("does not keep a direct message notice, which would leave its first words in the database and its backups, but hands it back for the live frame", () => {
    const logged = logNotification({ kind: "mention", botId: "", botName: "Bob", threadId: "dm:abc", title: "Bob", body: "segredo", toPersons: ["ada@x.test"] });
    expect(logged).toMatchObject({ threadId: "dm:abc", body: "segredo", read: false, toPersons: ["ada@x.test"] });
    expect(logged.id).toBeTruthy();
    expect(recentNotificationLog()).toEqual([]);
  });
});
