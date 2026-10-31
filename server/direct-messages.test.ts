import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DirectMessages, MAX_DIRECT_MESSAGE_CHARS, type DirectLimits } from "./direct-messages.ts";

const ADA = "ada@x.test";
const BOB = "bob@x.test";
const CAL = "cal@x.test";
const DAN = "dan@x.test";
const EVE = "eve@x.test";
const names: Record<string, string> = { [ADA]: "Ada Lima", [BOB]: "Bob" };

let dir: string;
let file: string;
const make = () => new DirectMessages({ file, nameOf: (email) => names[email] ?? email });
const later = () => new Promise((done) => setTimeout(done, 6));

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nordus-dms-"));
  file = join(dir, "dms.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("opening a conversation", () => {
  it("is one conversation for two people, the same from either side", () => {
    const dms = make();
    const mine = dms.open(ADA, BOB)!;
    const theirs = dms.open(BOB, ADA)!;
    expect(theirs.id).toBe(mine.id);
    expect(mine).toMatchObject({ peer: BOB, peerName: "Bob", unread: false, threadId: `dm:${mine.id}` });
    expect(theirs).toMatchObject({ peer: ADA, peerName: "Ada Lima" });
    expect(dms.open(ADA, " BOB@x.test ")!.id).toBe(mine.id);
    expect(dms.list(ADA)).toHaveLength(1);
  });

  it("never opens one with yourself, or with something that is not an address", () => {
    const dms = make();
    expect(dms.open(ADA, ADA)).toBeNull();
    expect(dms.open(ADA, "ADA@x.test")).toBeNull();
    expect(dms.open(ADA, "not an address")).toBeNull();
    expect(dms.list(ADA)).toEqual([]);
  });
});

describe("who may read or write", () => {
  it("keeps a third person out of every read and write", () => {
    const dms = make();
    const dm = dms.open(ADA, BOB)!;
    expect(dms.post(dm.id, ADA, "segredo")).not.toBeNull();
    expect(dms.get(dm.id, CAL)).toBeUndefined();
    expect(dms.page(dm.id, CAL)).toBeNull();
    expect(dms.post(dm.id, CAL, "oi")).toBeNull();
    expect(dms.markRead(dm.id, CAL)).toBeNull();
    expect(dms.list(CAL)).toEqual([]);
    expect(dms.takesPart(dm.id, CAL)).toBe(false);
    expect(dms.takesPart(dm.id, undefined)).toBe(false);
    expect(dms.takesPart(dm.id, ADA)).toBe(true);
    expect(JSON.stringify(dms.list(CAL))).not.toContain("segredo");
  });

  it("answers an id nobody holds as nothing", () => {
    const dms = make();
    expect(dms.get("nope", ADA)).toBeUndefined();
    expect(dms.page("nope", ADA)).toBeNull();
    expect(dms.post("nope", ADA, "oi")).toBeNull();
    expect(dms.markRead("nope", ADA)).toBeNull();
    expect(dms.participants("nope")).toEqual([]);
  });
});

describe("lines and reading state", () => {
  it("stamps the sender's address and name, trims the text and refuses an empty line", () => {
    const dms = make();
    const dm = dms.open(ADA, BOB)!;
    expect(dms.post(dm.id, ADA, "   ")).toBeNull();
    const posted = dms.post(dm.id, ADA, "  oi, Bob  ")!;
    expect(posted.message).toMatchObject({ from: ADA, name: "Ada Lima", text: "oi, Bob" });
    expect(posted.record.people).toEqual([ADA, BOB]);
    const long = dms.post(dm.id, BOB, "x".repeat(MAX_DIRECT_MESSAGE_CHARS + 50))!;
    expect(long.message.text).toHaveLength(MAX_DIRECT_MESSAGE_CHARS);
  });

  it("tells each side what it has not read yet", async () => {
    const dms = make();
    const dm = dms.open(ADA, BOB)!;
    await later();
    dms.post(dm.id, ADA, "oi");
    expect(dms.get(dm.id, BOB)).toMatchObject({ unread: true, last: { text: "oi" } });
    expect(dms.get(dm.id, ADA)!.unread).toBe(false);
    await later();
    expect(dms.markRead(dm.id, BOB)!.unread).toBe(false);
    await later();
    dms.post(dm.id, ADA, "e então?");
    expect(dms.get(dm.id, BOB)!.unread).toBe(true);
    await later();
    dms.post(dm.id, BOB, "vi sim");
    expect(dms.get(dm.id, BOB)!.unread).toBe(false);
    expect(dms.get(dm.id, ADA)!.unread).toBe(true);
  });

  it("lists the newest conversation first", async () => {
    const dms = make();
    const withBob = dms.open(ADA, BOB)!;
    const withCal = dms.open(ADA, CAL)!;
    await later();
    dms.post(withBob.id, ADA, "primeiro");
    await later();
    dms.post(withCal.id, ADA, "depois");
    expect(dms.list(ADA).map((dm) => dm.id)).toEqual([withCal.id, withBob.id]);
    await later();
    dms.post(withBob.id, BOB, "de novo");
    expect(dms.list(ADA).map((dm) => dm.id)).toEqual([withBob.id, withCal.id]);
  });

  it("pages older lines with the id of the oldest one already shown", () => {
    const dms = make();
    const dm = dms.open(ADA, BOB)!;
    const ids = ["um", "dois", "três", "quatro", "cinco"].map((text) => dms.post(dm.id, ADA, text)!.message.id);
    const first = dms.page(dm.id, BOB, { limit: 2 })!;
    expect(first.messages.map((m) => m.text)).toEqual(["quatro", "cinco"]);
    expect(first.hasMore).toBe(true);
    const second = dms.page(dm.id, BOB, { limit: 2, before: ids[3] })!;
    expect(second.messages.map((m) => m.text)).toEqual(["dois", "três"]);
    expect(second.hasMore).toBe(true);
    const last = dms.page(dm.id, BOB, { limit: 2, before: ids[1] })!;
    expect(last.messages.map((m) => m.text)).toEqual(["um"]);
    expect(last.hasMore).toBe(false);
  });
});

describe("what is kept on disk", () => {
  it("survives a restart, in a file only its owner reads", () => {
    const dms = make();
    const dm = dms.open(ADA, BOB)!;
    dms.post(dm.id, ADA, "guardado");
    dms.flush();
    const again = make();
    expect(again.list(BOB)[0]).toMatchObject({ id: dm.id, unread: true, last: { text: "guardado" } });
    expect(again.page(dm.id, ADA)!.messages.map((m) => m.text)).toEqual(["guardado"]);
    if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it("starts empty from a damaged file instead of refusing to start", () => {
    writeFileSync(file, "{ not json");
    expect(make().list(ADA)).toEqual([]);
    writeFileSync(file, JSON.stringify({ version: 1, conversations: [{ id: 1 }, "x", { id: "ok", people: [ADA, BOB], readAt: {}, messages: [] }] }));
    expect(make().list(ADA).map((dm) => dm.id)).toEqual(["ok"]);
  });
});

describe("how much is kept", () => {
  let now = 1_000;
  const tight = (limits: Partial<DirectLimits>) => new DirectMessages({ file, nameOf: (email) => names[email] ?? email, limits, now: () => now });
  const say = (dms: DirectMessages, id: string, who: string, text: string) => {
    now += 10;
    return dms.post(id, who, text)!;
  };
  const texts = (dms: DirectMessages, id: string) => dms.page(id, ADA)!.messages.map((message) => message.text);

  it("keeps the newest lines of a conversation, up to a count", () => {
    const dms = tight({ perPair: 3 });
    const dm = dms.open(ADA, BOB)!;
    for (const text of ["um", "dois", "três", "quatro", "cinco"]) say(dms, dm.id, ADA, text);
    expect(texts(dms, dm.id)).toEqual(["três", "quatro", "cinco"]);
  });

  it("keeps the newest lines of a conversation, up to a size", () => {
    const dms = tight({ charsPerPair: 50 });
    const dm = dms.open(ADA, BOB)!;
    for (const letter of ["a", "b", "c", "d"]) say(dms, dm.id, ADA, letter.repeat(20));
    expect(texts(dms, dm.id)).toEqual(["c".repeat(20), "d".repeat(20)]);
  });

  it("keeps all conversations together to a size, dropping the oldest lines first wherever they are", () => {
    const dms = tight({ chars: 70 });
    const withBob = dms.open(ADA, BOB)!;
    const withCal = dms.open(ADA, CAL)!;
    say(dms, withBob.id, ADA, "a".repeat(30));
    say(dms, withCal.id, ADA, "b".repeat(30));
    say(dms, withBob.id, BOB, "c".repeat(30));
    expect(texts(dms, withBob.id)).toEqual(["c".repeat(30)]);
    expect(texts(dms, withCal.id)).toEqual(["b".repeat(30)]);
  });

  it("opens no more conversations for one person than their share, nor more than the workspace's", () => {
    const dms = tight({ pairsPerPerson: 2, pairs: 3 });
    expect(dms.open(ADA, BOB)).not.toBeNull();
    expect(dms.open(ADA, CAL)).not.toBeNull();
    expect(dms.canOpen(ADA, DAN)).toBe(false);
    expect(dms.open(ADA, DAN)).toBeNull();
    expect(dms.canOpen(BOB, DAN)).toBe(true);
    expect(dms.canOpen(ADA, BOB)).toBe(true);
    expect(dms.open(BOB, ADA)).not.toBeNull();
    expect(dms.open(BOB, CAL)).not.toBeNull();
    expect(dms.canOpen(DAN, EVE)).toBe(false);
    expect(dms.open(DAN, EVE)).toBeNull();
    expect(dms.list(DAN)).toEqual([]);
  });
});
