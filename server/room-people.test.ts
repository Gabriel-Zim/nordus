import { describe, expect, it } from "vitest";

import { checkedRoomPeople, MAX_ROOM_PEOPLE } from "./room-people.ts";

const known = new Set(["ada@x.test", "bob@x.test", "boss@x.test"]);
const isKnown = (email: string) => known.has(email);

describe("the people a room is limited to", () => {
  it("leaves the room open when no list is given", () => {
    expect(checkedRoomPeople(undefined, "ada@x.test", isKnown)).toEqual({ ok: true, people: undefined });
    expect(checkedRoomPeople(null, undefined, isKnown)).toEqual({ ok: true, people: undefined });
  });

  it("lowercases, trims and de-duplicates, and keeps whoever opened the room in", () => {
    expect(checkedRoomPeople([" ADA@x.test", "ada@x.test", "bob@x.test"], "boss@x.test", isKnown))
      .toEqual({ ok: true, people: ["ada@x.test", "bob@x.test", "boss@x.test"] });
    expect(checkedRoomPeople(["ada@x.test", "boss@x.test"], "boss@x.test", isKnown))
      .toEqual({ ok: true, people: ["ada@x.test", "boss@x.test"] });
  });

  it("keeps the creator in even from an empty list, but refuses an empty room", () => {
    expect(checkedRoomPeople([], "ada@x.test", isKnown)).toEqual({ ok: true, people: ["ada@x.test"] });
    expect(checkedRoomPeople([], undefined, isKnown)).toMatchObject({ ok: false });
  });

  it("refuses anything that is not a list of known addresses", () => {
    expect(checkedRoomPeople("ada@x.test", undefined, isKnown)).toMatchObject({ ok: false });
    expect(checkedRoomPeople([42], undefined, isKnown)).toMatchObject({ ok: false });
    expect(checkedRoomPeople(["nonsense"], undefined, isKnown)).toMatchObject({ ok: false, error: expect.stringContaining("nonsense") });
    const stranger = checkedRoomPeople(["ada@x.test", "stranger@x.test"], undefined, isKnown);
    expect(stranger).toMatchObject({ ok: false, error: expect.stringContaining("stranger@x.test") });
    expect(checkedRoomPeople(Array.from({ length: MAX_ROOM_PEOPLE + 1 }, (_, i) => `p${i}@x.test`), undefined, () => true)).toMatchObject({ ok: false });
  });
});
