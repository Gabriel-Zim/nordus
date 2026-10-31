import { describe, expect, it } from "vitest";

import { resolveTranscriptWindow } from "./transcript-window";

const thread = (total: number, from = 0): number[] => Array.from({ length: total }, (_, i) => from + i);

describe("resolveTranscriptWindow", () => {
  it("keeps a short thread fully visible", () => {
    const result = resolveTranscriptWindow(thread(10));
    expect(result.visible).toEqual(thread(10));
    expect(result.startIndex).toBe(0);
    expect(result.endIndex).toBe(10);
  });

  it("renders every row of a long thread instead of only its tail", () => {
    const result = resolveTranscriptWindow(thread(300));
    expect(result.visible).toHaveLength(300);
    expect(result.visible[0]).toBe(0);
    expect(result.visible.at(-1)).toBe(299);
  });

  it("keeps older rows mounted while new ones arrive", () => {
    const before = resolveTranscriptWindow(thread(300));
    const after = resolveTranscriptWindow(thread(600));
    expect(after.visible.slice(0, before.visible.length)).toEqual(before.visible);
    expect(after.visible.at(-1)).toBe(599);
  });

  it("renders an empty transcript as empty", () => {
    const result = resolveTranscriptWindow([]);
    expect(result.visible).toEqual([]);
    expect(result.startIndex).toBe(0);
    expect(result.endIndex).toBe(0);
  });

  it("hands back a copy, so callers cannot reorder the store's list", () => {
    const messages = thread(5);
    const result = resolveTranscriptWindow(messages);
    result.visible.reverse();
    expect(messages).toEqual(thread(5));
  });
});
