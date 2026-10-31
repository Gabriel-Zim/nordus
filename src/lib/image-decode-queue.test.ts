import { describe, expect, it, vi } from "vitest";

import { DECODE_LIMIT, DECODE_SLOT_TIMEOUT_MS, decodeSlotsInUse, requestDecodeSlot } from "./image-decode-queue";

describe("image decode queue", () => {
  it("lets three images load at once and starts the next as each finishes", () => {
    const started: number[] = [];
    const releases = Array.from({ length: 5 }, (_, index) => requestDecodeSlot(() => started.push(index)));
    expect(started).toEqual([0, 1, 2]);
    expect(decodeSlotsInUse()).toEqual({ active: DECODE_LIMIT, waiting: 2 });

    releases[1]!();
    expect(started).toEqual([0, 1, 2, 3]);
    releases[1]!();
    expect(decodeSlotsInUse()).toEqual({ active: 3, waiting: 1 });

    releases[4]!();
    expect(decodeSlotsInUse()).toEqual({ active: 3, waiting: 0 });
    for (const release of releases) release();
    expect(started).toEqual([0, 1, 2, 3]);
    expect(decodeSlotsInUse()).toEqual({ active: 0, waiting: 0 });
  });

  it("frees a slot held by a picture that never finishes", () => {
    vi.useFakeTimers();
    try {
      const started: number[] = [];
      const releases = Array.from({ length: 4 }, (_, index) => requestDecodeSlot(() => started.push(index)));
      expect(started).toEqual([0, 1, 2]);
      vi.advanceTimersByTime(DECODE_SLOT_TIMEOUT_MS);
      expect(started).toEqual([0, 1, 2, 3]);
      for (const release of releases) release();
      vi.advanceTimersByTime(DECODE_SLOT_TIMEOUT_MS);
      expect(decodeSlotsInUse()).toEqual({ active: 0, waiting: 0 });
    } finally {
      vi.useRealTimers();
    }
  });
});
