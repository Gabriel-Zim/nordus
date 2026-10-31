import { describe, expect, it } from "vitest";

import { openLiveStream, SEQ_BLOCK, type LiveStreamStorage, type ReplayEntry } from "./live-stream.ts";

function disk(initial: { id: string; reserved: number } | null = null) {
  let row = initial;
  let writes = 0;
  const storage: LiveStreamStorage = {
    load: () => row,
    save: (next) => {
      row = next;
      writes += 1;
    },
  };
  return { storage, row: () => row, writes: () => writes };
}

const entry = (seq: number, frame = "x".repeat(10)): ReplayEntry => ({ seq, kind: "bot", frame, clientFrame: frame, payload: {} });

describe("live stream identity", () => {
  it("keeps its id across a restart and never hands out a seq twice", () => {
    const store = disk();
    const first = openLiveStream(store.storage, { now: () => 1_000, newId: () => "aaaa1111" });
    const issued = Array.from({ length: SEQ_BLOCK + 5 }, () => first.next());

    const second = openLiveStream(store.storage, { now: () => 1_000, newId: () => "bbbb2222" });
    expect(second.id).toBe("aaaa1111");
    expect(second.boot).toBeGreaterThan(Math.max(...issued));
    expect(second.next()).toBeGreaterThan(second.boot);
  });

  it("writes the reservation once per block, not once per frame", () => {
    const store = disk();
    const stream = openLiveStream(store.storage, { now: () => 0 });
    for (let index = 0; index < SEQ_BLOCK * 3; index += 1) stream.next();
    expect(store.writes()).toBe(3);
    expect(store.row()!.reserved).toBeGreaterThanOrEqual(stream.last());
  });

  it("keeps rising after a restored backup brings back an older reservation", () => {
    const stream = openLiveStream(disk({ id: "aaaa1111", reserved: 50 }).storage, { now: () => 9_000_000 });
    expect(stream.boot).toBe(9_000_001);
  });

  it("reads only its own cursors, and none from the future", () => {
    const stream = openLiveStream(disk().storage, { now: () => 100, newId: () => "aaaa1111" });
    const seq = stream.next();
    expect(stream.parse(stream.cursor(seq))).toBe(seq);
    expect(stream.parse([stream.cursor(seq)])).toBe(seq);
    expect(stream.parse(`aaaa1111:${seq + 1}`)).toBeNull();
    expect(stream.parse(`bbbb2222:${seq}`)).toBeNull();
    expect(stream.parse("aaaa1111:-1")).toBeNull();
    expect(stream.parse("not-a-cursor")).toBeNull();
    expect(stream.parse(undefined)).toBeNull();
  });
});

describe("live stream replay ring", () => {
  it("replays everything after a cursor from this run, and nothing from before it", () => {
    const stream = openLiveStream(disk().storage, { now: () => 100 });
    const seqs = [stream.next(), stream.next(), stream.next()];
    for (const seq of seqs) stream.remember(entry(seq));

    expect(stream.replayAfter(seqs[0]!)?.map((item) => item.seq)).toEqual(seqs.slice(1));
    expect(stream.replayAfter(stream.boot)?.map((item) => item.seq)).toEqual(seqs);
    expect(stream.replayAfter(seqs[2]!)).toEqual([]);
    expect(stream.replayAfter(stream.boot - 1)).toBeNull();
  });

  it("refuses a cursor whose frames it has already let go, by count or by size", () => {
    const byCount = openLiveStream(disk().storage, { now: () => 100, maxFrames: 3 });
    const counted = Array.from({ length: 5 }, () => byCount.next());
    for (const seq of counted) byCount.remember(entry(seq));
    expect(byCount.replayAfter(counted[0]!)).toBeNull();
    expect(byCount.replayAfter(counted[1]!)?.map((item) => item.seq)).toEqual(counted.slice(2));

    const bySize = openLiveStream(disk().storage, { now: () => 100, maxChars: 25 });
    const sized = Array.from({ length: 4 }, () => bySize.next());
    for (const seq of sized) bySize.remember(entry(seq));
    expect(bySize.replayAfter(sized[1]!)?.map((item) => item.seq)).toEqual(sized.slice(2));
    expect(bySize.replayAfter(sized[0]!)).toBeNull();
  });

  it("stays correct after the ring compacts its dead head", () => {
    const stream = openLiveStream(disk().storage, { now: () => 100, maxFrames: 10 });
    const seqs = Array.from({ length: 5_000 }, () => stream.next());
    for (const seq of seqs) stream.remember(entry(seq));
    expect(stream.replayAfter(seqs.at(-11)!)?.map((item) => item.seq)).toEqual(seqs.slice(-10));
    expect(stream.replayAfter(seqs.at(-12)!)).toBeNull();
  });
});
