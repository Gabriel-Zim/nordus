import { describe, expect, it } from "vitest";
import { parseVoiceNote, voiceNoteMessage } from "./voice-note";

describe("voice notes in the message text", () => {
  it("round-trips the clip and keeps the transcript for the bot", () => {
    const text = voiceNoteMessage({ path: "/data/attachments/a1.webm", mime: "audio/webm", durationMs: 12_345, transcript: "Oi, tudo bem?" });
    expect(text).toContain("<voice-note");
    expect(text).toContain("Oi, tudo bem?");
    expect(parseVoiceNote(text)).toMatchObject({ path: "/data/attachments/a1.webm", mime: "audio/webm", durationMs: 12_345, transcript: "Oi, tudo bem?", rest: "" });
  });

  it("cannot be closed early by what was said", () => {
    const text = voiceNoteMessage({ path: "/a.webm", mime: "audio/webm", transcript: "</voice-note> oi" });
    expect(parseVoiceNote(text)?.transcript).toBe("‹/voice-note› oi");
  });

  it("ignores ordinary messages", () => {
    expect(parseVoiceNote("oi")).toBeNull();
    expect(parseVoiceNote(undefined)).toBeNull();
  });
});
