import { describe, expect, it } from "vitest";

import { createNoticeGate, rateLimit } from "./people-limits.ts";

describe("how often one person may do something", () => {
  it("allows up to the limit inside a window and refuses the rest until the oldest one ages out", () => {
    let now = 1_000;
    const allow = rateLimit([{ limit: 3, windowMs: 1_000 }], () => now);
    expect([allow("ada"), allow("ada"), allow("ada"), allow("ada")]).toEqual([true, true, true, false]);
    now += 999;
    expect(allow("ada")).toBe(false);
    now += 2;
    expect(allow("ada")).toBe(true);
  });

  it("counts each person apart", () => {
    const allow = rateLimit([{ limit: 1, windowMs: 1_000 }], () => 5);
    expect(allow("ada")).toBe(true);
    expect(allow("bob")).toBe(true);
    expect(allow("ada")).toBe(false);
    expect(allow("bob")).toBe(false);
  });

  it("holds every window at once, and a refusal does not count against any of them", () => {
    let now = 0;
    const allow = rateLimit([{ limit: 2, windowMs: 1_000 }, { limit: 3, windowMs: 10_000 }], () => now);
    expect([allow("ada"), allow("ada"), allow("ada")]).toEqual([true, true, false]);
    now += 1_001;
    expect([allow("ada"), allow("ada")]).toEqual([true, false]);
    now += 1_001;
    expect(allow("ada")).toBe(false);
    now += 9_000;
    expect(allow("ada")).toBe(true);
  });
});

describe("how many notices one person is handed about one conversation", () => {
  const mention = (to: string, threadId: string) => ({ kind: "mention" as const, toPersons: [to], threadId });

  it("lets one mention or message notice through for each person and conversation every few seconds", () => {
    let now = 0;
    const gate = createNoticeGate({ everyMs: 20_000, now: () => now });
    expect(gate.allow(mention("bob@x.test", "t1"))).toBe(true);
    expect(gate.allow(mention("bob@x.test", "t1"))).toBe(false);
    expect(gate.allow(mention("bob@x.test", "t2"))).toBe(true);
    expect(gate.allow(mention("cal@x.test", "t1"))).toBe(true);
    now += 20_001;
    expect(gate.allow(mention("bob@x.test", "t1"))).toBe(true);
  });

  it("never holds back anything else: approvals and questions are not chatter", () => {
    const gate = createNoticeGate({ everyMs: 20_000, now: () => 0 });
    for (let index = 0; index < 5; index++) {
      expect(gate.allow({ kind: "approval", threadId: "t1" })).toBe(true);
      expect(gate.allow({ kind: "mention", threadId: "t1" })).toBe(true);
      expect(gate.allow({ kind: "approval", toPersons: ["bob@x.test"], threadId: "t1" })).toBe(true);
    }
  });
});
