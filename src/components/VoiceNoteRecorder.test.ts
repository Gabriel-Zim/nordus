import { describe, expect, it } from "vitest";
import { fitLevels, loudness } from "./VoiceNoteRecorder";

describe("voice note recorder wave", () => {
  it("keeps silence flat and speech tall", () => {
    expect(loudness(new Uint8Array(512).fill(128))).toBe(0);
    const speech = Uint8Array.from({ length: 512 }, (_, i) => 128 + Math.round(40 * Math.sin(i / 4)));
    expect(loudness(speech)).toBeGreaterThan(0.6);
    expect(loudness(speech)).toBeLessThanOrEqual(1);
  });

  it("squeezes a long recording keeping the loudest of each slice", () => {
    expect(fitLevels([0.1, 0.9, 0.2, 0.3], 2)).toEqual([0.9, 0.3]);
  });

  it("stretches a short recording to fill the width", () => {
    const fitted = fitLevels([0, 1], 5);
    expect(fitted).toHaveLength(5);
    expect(fitted[0]).toBe(0);
    expect(fitted[2]).toBeCloseTo(0.5);
    expect(fitted[4]).toBe(1);
    expect(fitLevels([], 5)).toEqual([]);
  });
});
