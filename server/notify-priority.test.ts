import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createDailyDigest, digestText, JEV_ALWAYS_URGENT, localDay } from "./notify-priority.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const dir = () => { const made = mkdtempSync(join(tmpdir(), "digest-")); dirs.push(made); return made; };
const at = (iso: string) => new Date(iso).getTime();
const news = { kind: "done" as const, botId: "b", botName: "DESIGNERDEIA", threadId: "t", title: "DESIGNERDEIA finished", body: "x" };

describe("daily digest", () => {
  it("what waits on the person is never asked", () => {
    for (const kind of ["approval", "question", "sign-in", "spend", "incident"] as const) expect(JEV_ALWAYS_URGENT.has(kind)).toBe(true);
    expect(JEV_ALWAYS_URGENT.has("done")).toBe(false);
  });

  it("reads the local day and hour", () => {
    expect(localDay(at("2026-10-16T21:30:00Z"), "America/Sao_Paulo")).toEqual({ day: "2026-10-16", hour: 18 });
  });

  it("sends one summary after 18h with what was held, once a day, and survives a restart", () => {
    let clock = at("2026-10-16T15:00:00Z");
    const send = vi.fn();
    const data = dir();
    const digest = createDailyDigest({ dataDir: data, timeZone: () => "America/Sao_Paulo", send, now: () => clock });
    digest.hold(news);
    digest.hold({ ...news, title: "Social finished", botName: "Social" });
    expect(digest.tick()).toBe(false);
    clock = at("2026-10-16T21:10:00Z");
    const again = createDailyDigest({ dataDir: data, timeZone: () => "America/Sao_Paulo", send, now: () => clock });
    expect(again.tick()).toBe(true);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ kind: "daily-digest", title: "Resumo do dia: 2 novidades" }), { adminOnly: true });
    again.hold(news);
    expect(again.tick()).toBe(false);
  });

  it("goes to the administrators only: its lines name the bots of every client and it is filed under the last one", () => {
    const send = vi.fn();
    const digest = createDailyDigest({ dataDir: dir(), timeZone: () => "UTC", send, now: () => at("2026-10-16T19:00:00Z") });
    digest.hold(news);
    digest.hold({ ...news, botId: "other", botName: "Cliente B", threadId: "t-other", title: "Cliente B finished" });
    expect(digest.tick()).toBe(true);
    const [summary, audience] = send.mock.calls[0]!;
    expect(summary).toMatchObject({ kind: "daily-digest", botId: "other", threadId: "t-other" });
    expect(summary.body).toContain("DESIGNERDEIA");
    expect(audience).toEqual({ adminOnly: true });
  });

  it("never merges a notice that was for named people into the summary, which is not addressed to them", () => {
    const send = vi.fn();
    const digest = createDailyDigest({ dataDir: dir(), timeZone: () => "UTC", send, now: () => at("2026-10-16T10:00:00Z") });
    digest.hold({ ...news, kind: "turn-failed", botId: "mine", botName: "Otter", threadId: "t-mine", title: "Otter failed", toPersons: ["ada@x.test"] });
    digest.hold(news);
    expect(digest.held().map((item) => item.title)).toEqual(["DESIGNERDEIA finished"]);
    const later = createDailyDigest({ dataDir: dir(), timeZone: () => "UTC", send, now: () => at("2026-10-16T19:00:00Z") });
    later.hold({ ...news, botId: "mine", botName: "Otter", threadId: "t-mine", title: "Only for Ada", toPersons: ["ada@x.test"] });
    expect(later.tick()).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("says nothing on a quiet day", () => {
    const send = vi.fn();
    const digest = createDailyDigest({ dataDir: dir(), timeZone: () => "UTC", send, now: () => at("2026-10-16T19:00:00Z") });
    expect(digest.tick()).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(digestText([{ at: 0, botId: "b", botName: "Plum", threadId: "t", title: "Plum finished" }]).title).toBe("Resumo do dia: 1 novidade");
  });

  it("saves notify-digest.json whole and owner-only even over a looser file", () => {
    const data = dir();
    const path = join(data, "notify-digest.json");
    const digest = createDailyDigest({ dataDir: data, timeZone: () => "UTC", send: vi.fn(), now: () => at("2026-10-16T10:00:00Z") });
    digest.hold(news);
    chmodSync(path, 0o644);
    const before = statSync(path).ino;
    digest.hold(news);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(path).ino).not.toBe(before);
  });

  it("logs an unreadable notify-digest.json and keeps a copy of the held news", () => {
    const data = dir();
    const torn = '{"day":"2026-10-16","held":[{"title":"DESIGNERDEIA finished"';
    writeFileSync(join(data, "notify-digest.json"), torn);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const digest = createDailyDigest({ dataDir: data, timeZone: () => "UTC", send: vi.fn(), now: () => at("2026-10-16T10:00:00Z") });
      expect(digest.held()).toEqual([]);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]![0])).toContain("notify-digest.json");
      expect(String(warn.mock.calls[0]![0])).not.toContain("DESIGNERDEIA");
      const copy = readdirSync(data).find((name) => name.startsWith("notify-digest.json.corrompido-"));
      expect(readFileSync(join(data, copy!), "utf8")).toBe(torn);
    } finally {
      warn.mockRestore();
    }
  });
});
