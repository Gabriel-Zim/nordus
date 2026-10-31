import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  return {};
});
void fixture;

const { VoiceNoteBubble } = await import("./VoiceNoteBubble");
const { configureLiveMedia, resetLiveMedia, startLiveCall } = await import("@/lib/live-call-media");
afterAll(() => vi.unstubAllGlobals());

const note = {
  kind: "audio" as const,
  path: "/attachments/123e4567-e89b-12d3-a456-426614174000.mp3",
  mime: "audio/mpeg",
  durationMs: 4200,
};

describe("VoiceNoteBubble", () => {
  it("renders a paused player with the metadata duration estimate and no autoplay", () => {
    const markup = renderToStaticMarkup(createElement(VoiceNoteBubble, { attachment: note }));
    expect(markup).toContain('aria-label="Play voice note"');
    expect(markup).toContain('role="slider"');
    expect(markup).toContain('aria-label="Seek voice note"');
    expect(markup).toContain('aria-valuemax="4"');
    expect(markup).toContain("0:04");
    expect(markup).toContain(">1x<");
    expect(markup).not.toContain("autoplay");
    expect(markup).toContain('src="/api/attachments/123e4567-e89b-12d3-a456-426614174000.mp3"');
    expect(markup).toContain('preload="metadata"');
  });

  it("plays a WAV note from the built-in Mac voices", () => {
    const markup = renderToStaticMarkup(
      createElement(VoiceNoteBubble, { attachment: { ...note, path: "/attachments/note.wav", mime: "audio/wav" } }),
    );
    expect(markup).toContain('src="/api/attachments/note.wav"');
  });

  it("renders no player for a path that is not a saved audio clip", () => {
    const markup = renderToStaticMarkup(
      createElement(VoiceNoteBubble, { attachment: { ...note, path: "/attachments/note.flac" } }),
    );
    expect(markup).toBe("");
  });

  it("cannot be played while this window is on a Live call, and says why", () => {
    configureLiveMedia({ getUserMedia: () => new Promise<MediaStream>(() => {}) });
    void startLiveCall({ botId: "b1", threadId: "t1" });
    try {
      const markup = renderToStaticMarkup(createElement(VoiceNoteBubble, { attachment: note }));
      expect(markup).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Voice notes can&#x27;t play during a Live call."/);
    } finally {
      resetLiveMedia();
    }
    expect(renderToStaticMarkup(createElement(VoiceNoteBubble, { attachment: note }))).toContain('aria-label="Play voice note"');
  });
});

describe("the waveform of a long file", () => {
  it("is never decoded past the size a phone can hold, and falls back to the drawn bars", async () => {
    const { peaksFor } = await import("./VoiceNoteBubble");
    const decode = vi.fn();
    vi.stubGlobal("OfflineAudioContext", class { decodeAudioData = decode; });
    vi.stubGlobal("AudioContext", class { decodeAudioData = decode; close() {} });
    vi.stubGlobal("fetch", async () => new Response(new Uint8Array(9 * 1024 * 1024)));
    const peaks = await peaksFor("blob:long", "long-file");
    expect(decode).not.toHaveBeenCalled();
    expect(peaks).toHaveLength(52);
  });
});
