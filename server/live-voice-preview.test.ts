import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LiveSocket } from "./live-call-controller.ts";
import { LIVE_NEEDS_KEY, LiveSessionError } from "./live-call.ts";
import { createVoicePreviews, VOICE_PREVIEW_TEXT } from "./live-voice-preview.ts";

const dirs: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

class FakeSocket implements LiveSocket {
  readyState = 1;
  onopen: LiveSocket["onopen"] = null;
  onmessage: LiveSocket["onmessage"] = null;
  onclose: LiveSocket["onclose"] = null;
  onerror: LiveSocket["onerror"] = null;
  sent: Array<Record<string, unknown>> = [];
  closed = false;
  send(data: string) { this.sent.push(JSON.parse(data) as Record<string, unknown>); }
  close() { this.closed = true; }
}

async function setup(overrides: Partial<Parameters<typeof createVoicePreviews>[0]> = {}) {
  const dir = await mkdtemp(join(tmpdir(), "voice-preview-"));
  dirs.push(dir);
  const socket = new FakeSocket();
  const urls: string[] = [];
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ session: { id: "sess_1" }, transport: { sdp: "answer-sdp" } }), { status: 200 })) as unknown as typeof fetch;
  const previews = createVoicePreviews({
    dir, key: () => "sk-test", fetchImpl,
    openSocket: (url) => { urls.push(url); return socket; },
    ...overrides,
  });
  return { dir, socket, urls, fetchImpl, previews };
}

describe("voice previews", () => {
  it("creates a webrtc session with the chosen voice and makes it speak the sample", async () => {
    const { socket, urls, fetchImpl, previews } = await setup();
    const result = await previews.start("cedar", "v=0\r\n");
    expect(result).toEqual({ sdp: "answer-sdp" });
    const [url, init] = vi.mocked(fetchImpl).mock.calls[0]!;
    expect(String(url)).toMatch(/\/v1\/live\/sessions$/);
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.transport).toEqual({ type: "webrtc", sdp: "v=0\r\n" });
    expect(body.session.audio.output.voice).toBe("cedar");
    expect(body.session.model).toBe("gpt-live-1");
    expect(body.session.instructions).toMatch(/word for word/);
    expect(JSON.stringify(result)).not.toContain("sk-test");
    expect(urls).toEqual([expect.stringContaining("/v1/live/sessions/sess_1/attach")]);

    expect(socket.sent).toEqual([]);
    socket.onmessage?.({ data: JSON.stringify({ type: "session.started" }) });
    socket.onmessage?.({ data: JSON.stringify({ type: "session.started" }) });
    expect(socket.sent).toEqual([expect.objectContaining({ type: "session.commentary.append", delegation_id: null, content: VOICE_PREVIEW_TEXT })]);
    socket.onmessage?.({ data: JSON.stringify({ type: "session.closed" }) });
    expect(socket.closed).toBe(true);
  });

  it("speaks anyway when the session never reports it started, and closes at the cap", async () => {
    vi.useFakeTimers();
    const { socket, previews } = await setup({ speakFallbackMs: 100, sessionCapMs: 500 });
    await previews.start("marin", "v=0\r\n");
    socket.readyState = 1;
    socket.onopen?.({});
    await vi.advanceTimersByTimeAsync(150);
    expect(socket.sent.map((event) => event.type)).toEqual(["session.commentary.append"]);
    await vi.advanceTimersByTimeAsync(500);
    expect(socket.sent.at(-1)).toMatchObject({ type: "session.close" });
    expect(socket.closed).toBe(true);
  });

  it("allows one session per voice at a time", async () => {
    const { socket, previews } = await setup();
    await previews.start("cedar", "v=0\r\n");
    const closeCedar = socket.onclose;
    await expect(previews.start("cedar", "v=0\r\n")).rejects.toMatchObject({ status: 429 });
    await expect(previews.start("marin", "v=0\r\n")).resolves.toBeTruthy();
    closeCedar?.({});
    await expect(previews.start("cedar", "v=0\r\n")).resolves.toBeTruthy();
  });

  it("409s without a key and frees the voice when OpenAI refuses", async () => {
    const noKey = await setup({ key: () => null });
    await expect(noKey.previews.start("cedar", "v=0")).rejects.toMatchObject({ status: 409, message: LIVE_NEEDS_KEY });
    const refused = await setup({ fetchImpl: vi.fn(async () => new Response(JSON.stringify({ error: { param: "transport.type" } }), { status: 400 })) as unknown as typeof fetch });
    await expect(refused.previews.start("cedar", "v=0")).rejects.toBeInstanceOf(LiveSessionError);
    await expect(refused.previews.start("cedar", "v=0")).rejects.toMatchObject({ status: 502 });
  });

  it("stores a recording atomically and reads it back, keeping one format per voice", async () => {
    const { dir, previews } = await setup();
    expect(await previews.read("cedar")).toBeNull();
    await previews.save("cedar", Buffer.from("ogg-bytes"), "audio/ogg");
    await previews.save("cedar", Buffer.from("webm-bytes"), "audio/webm");
    const saved = await previews.read("cedar");
    expect(saved?.mime).toBe("audio/webm");
    expect(saved?.data.toString()).toBe("webm-bytes");
    expect(await readdir(dir)).toEqual(["cedar.webm"]);
    await expect(previews.save("cedar", Buffer.from("x"), "audio/wav")).rejects.toMatchObject({ status: 415 });
    expect((await readFile(join(dir, "cedar.webm"))).toString()).toBe("webm-bytes");
    await writeFile(join(dir, "x.tmp"), "");
  });
});
