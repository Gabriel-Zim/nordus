import { describe, expect, it } from "vitest";
import { LruMap } from "./lru-map.ts";

describe("LruMap", () => {
  it("drops the least recently used key past the limit", () => {
    const map = new LruMap<string, number>(3);
    map.set("a", 1).set("b", 2).set("c", 3);
    map.get("a");
    map.set("d", 4);
    expect([...map.keys()]).toEqual(["c", "a", "d"]);
    expect(map.get("b")).toBeUndefined();
  });

  it("never grows past the limit and replaces a key in place", () => {
    const map = new LruMap<number, number>(100);
    for (let i = 0; i < 10_000; i++) map.set(i, i);
    expect(map.size).toBe(100);
    map.set(9_999, -1);
    expect(map.size).toBe(100);
    expect(map.get(9_999)).toBe(-1);
  });

  it("keeps a hot working set while a stream of one-off keys passes through", () => {
    const map = new LruMap<number, number>(1_000);
    let hits = 0;
    for (let round = 0; round < 20; round++) {
      for (let key = 0; key < 600; key++) {
        if (map.get(key) !== undefined) hits++;
        else map.set(key, key);
      }
      for (let key = 100_000 + round * 300; key < 100_000 + round * 300 + 300; key++) map.set(key, key);
    }
    expect(hits).toBe(600 * 19);
  });
});
