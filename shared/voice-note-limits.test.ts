import { describe, expect, it } from "vitest";
import { VOICE_NOTE_MAX_BYTES, voiceNoteFits } from "./voice-note-limits.ts";

describe("voiceNoteFits", () => {
  it("takes a recording up to the route's limit and refuses one past it", () => {
    expect(voiceNoteFits(VOICE_NOTE_MAX_BYTES)).toBe(true);
    expect(voiceNoteFits(VOICE_NOTE_MAX_BYTES + 1)).toBe(false);
  });
});
