import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PASS } from "./table.ts";
import { createVoiceNoteRoutes, whisperTranscriber, type Transcriber } from "./voice-notes.ts";

const ID = "note_0123456789abcdef";

let recordDir: string;
beforeEach(() => {
  recordDir = mkdtempSync(join(tmpdir(), "voice-notes-"));
});
afterEach(() => {
  rmSync(recordDir, { recursive: true, force: true });
});

function fakeSave() {
  let n = 0;
  return vi.fn((bytes: Buffer, mime: string) => {
    n += 1;
    return { path: `/data/attachments/clip-${n}.webm`, mime, bytes: bytes.byteLength };
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function request(type: string, body: Buffer) {
  const req = Object.assign(new EventEmitter(), { headers: { "content-type": type }, resume: vi.fn(), destroy: () => {} });
  queueMicrotask(() => {
    req.emit("data", body);
    req.emit("end");
  });
  return req;
}

async function call(route: ReturnType<typeof createVoiceNoteRoutes>, method: string, target: string, req = request("audio/webm", Buffer.alloc(0))) {
  const url = new URL(target, "http://localhost");
  const json = vi.fn();
  const out = await route({ req, res: {}, url, path: url.pathname, method, json } as never);
  if (out === PASS) return PASS;
  const [, status, body] = json.mock.calls.at(-1)!;
  return { status: status as number, body: body as Record<string, unknown> };
}

const put = (route: ReturnType<typeof createVoiceNoteRoutes>, id = ID, type = "audio/webm;codecs=opus") =>
  call(route, "PUT", `/api/voice-notes/${id}`, request(type, Buffer.from("abc")));
const get = (route: ReturnType<typeof createVoiceNoteRoutes>, query = "", id = ID) => call(route, "GET", `/api/voice-notes/${id}${query}`);
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const WHISPER = { text: " Oi, Social. ", language: "pt", duration: 3.2, seconds: 0.8 };
const DONE = { id: ID, path: "/data/attachments/clip-1.webm", mime: "audio/webm", durationMs: 3200, transcript: "Oi, Social.", language: "pt", seconds: 0.8 };

describe("voice note routes", () => {
  it("saves and transcribes once when the same id is uploaded concurrently and again later", async () => {
    const save = fakeSave();
    const transcribe = vi.fn<Transcriber>(async () => WHISPER);
    const route = createVoiceNoteRoutes(transcribe, { recordDir, saveAudio: save });
    const [first, second] = await Promise.all([put(route), put(route)]);
    await settle();
    const retry = await put(route);
    const clip = { id: ID, path: "/data/attachments/clip-1.webm", mime: "audio/webm" };
    expect(first).toEqual({ status: 202, body: clip });
    expect(second).toEqual({ status: 202, body: clip });
    expect(retry).toEqual({ status: 202, body: clip });
    expect(save).toHaveBeenCalledTimes(1);
    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(transcribe).toHaveBeenCalledWith("/data/attachments/clip-1.webm");
  });

  it("answers the upload before the transcription finishes and does not start a second one while it runs", async () => {
    const pending = deferred<Awaited<ReturnType<Transcriber>>>();
    const transcribe = vi.fn<Transcriber>(() => pending.promise);
    const route = createVoiceNoteRoutes(transcribe, { recordDir, saveAudio: fakeSave() });
    expect(await put(route)).toEqual({ status: 202, body: { id: ID, path: "/data/attachments/clip-1.webm", mime: "audio/webm" } });
    expect(await put(route)).toMatchObject({ status: 202 });
    expect(transcribe).toHaveBeenCalledTimes(1);
  });

  it("GET waits for the running transcription and returns the transcript", async () => {
    const pending = deferred<Awaited<ReturnType<Transcriber>>>();
    const transcribe = vi.fn<Transcriber>(() => pending.promise);
    const route = createVoiceNoteRoutes(transcribe, { recordDir, saveAudio: fakeSave() });
    await put(route);
    const waiting = get(route, "?waitMs=5000");
    pending.resolve(WHISPER);
    expect(await waiting).toEqual({ status: 200, body: DONE });
    expect(transcribe).toHaveBeenCalledTimes(1);
  });

  it("GET reports the note as still transcribing when the wait runs out", async () => {
    const transcribe = vi.fn<Transcriber>(() => new Promise(() => {}));
    const route = createVoiceNoteRoutes(transcribe, { recordDir, saveAudio: fakeSave() });
    await put(route);
    expect(await get(route, "?waitMs=10")).toEqual({
      status: 202,
      body: { id: ID, path: "/data/attachments/clip-1.webm", mime: "audio/webm", status: "transcribing" },
    });
    expect(transcribe).toHaveBeenCalledTimes(1);
  });

  it("GET for an id that was never uploaded is 404", async () => {
    const route = createVoiceNoteRoutes(vi.fn<Transcriber>(), { recordDir, saveAudio: fakeSave() });
    expect(await get(route)).toMatchObject({ status: 404, body: { error: expect.any(String) } });
  });

  it("a restarted server returns the stored transcript without transcribing or saving again", async () => {
    const before = createVoiceNoteRoutes(vi.fn<Transcriber>(async () => WHISPER), { recordDir, saveAudio: fakeSave() });
    await put(before);
    expect(await get(before)).toEqual({ status: 200, body: DONE });

    const transcribe = vi.fn<Transcriber>(async () => WHISPER);
    const save = fakeSave();
    const after = createVoiceNoteRoutes(transcribe, { recordDir, saveAudio: save });
    expect(await get(after)).toEqual({ status: 200, body: DONE });
    expect(await put(after)).toMatchObject({ status: 202, body: { path: "/data/attachments/clip-1.webm" } });
    await settle();
    expect(transcribe).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("a restart in the middle of a transcription transcribes the saved clip on the next GET", async () => {
    const before = createVoiceNoteRoutes(vi.fn<Transcriber>(() => new Promise(() => {})), { recordDir, saveAudio: fakeSave() });
    await put(before);

    const transcribe = vi.fn<Transcriber>(async () => WHISPER);
    const after = createVoiceNoteRoutes(transcribe, { recordDir, saveAudio: fakeSave() });
    expect(await get(after)).toEqual({ status: 200, body: DONE });
    expect(transcribe).toHaveBeenCalledWith("/data/attachments/clip-1.webm");
  });

  it("after a failed transcription the next GET transcribes again and succeeds", async () => {
    let attempts = 0;
    const transcribe = vi.fn<Transcriber>(async () => {
      attempts += 1;
      if (attempts <= 2) throw new Error("whisper is down");
      return WHISPER;
    });
    const route = createVoiceNoteRoutes(transcribe, { recordDir, saveAudio: fakeSave() });
    await put(route);
    await settle();
    expect(await get(route)).toEqual({ status: 502, body: { error: "whisper is down" } });
    expect(await get(route)).toEqual({ status: 200, body: DONE });
    expect(transcribe).toHaveBeenCalledTimes(3);
  });

  it("passes on a clip whisper refuses as a refusal the phone will not retry", async () => {
    const transcribe = vi.fn<Transcriber>(async () => { throw Object.assign(new Error("cannot decode audio"), { status: 422 }); });
    const route = createVoiceNoteRoutes(transcribe, { recordDir, saveAudio: fakeSave() });
    await put(route);
    await settle();
    expect(await get(route)).toEqual({ status: 422, body: { error: "cannot decode audio" } });
  });

  it("still answers a page loaded before the switch, saving the clip and returning its transcript", async () => {
    const save = fakeSave();
    const route = createVoiceNoteRoutes(vi.fn<Transcriber>(async () => WHISPER), { recordDir, saveAudio: save });
    expect(await call(route, "POST", "/api/voice-notes", request("audio/webm;codecs=opus", Buffer.from("abc")))).toEqual({
      status: 201,
      body: { path: "/data/attachments/clip-1.webm", mime: "audio/webm", durationMs: 3200, transcript: "Oi, Social.", language: "pt", seconds: 0.8 },
    });
    expect(await call(route, "POST", "/api/voice-notes", request("image/png", Buffer.from("x")))).toMatchObject({ status: 400 });
  });

  it("refuses an id that is not a client-generated id", async () => {
    const save = fakeSave();
    const route = createVoiceNoteRoutes(vi.fn<Transcriber>(), { recordDir, saveAudio: save });
    expect(await put(route, "short")).toMatchObject({ status: 400 });
    expect(await put(route, "has.a.dot.0123456789abcdef")).toMatchObject({ status: 400 });
    expect(await get(route, "", "short")).toMatchObject({ status: 400 });
    expect(save).not.toHaveBeenCalled();
  });

  it("refuses an upload that is not audio", async () => {
    const save = fakeSave();
    const route = createVoiceNoteRoutes(vi.fn<Transcriber>(), { recordDir, saveAudio: save });
    expect(await put(route, ID, "image/png")).toMatchObject({ status: 400 });
    expect(save).not.toHaveBeenCalled();
    expect(await get(route)).toMatchObject({ status: 404 });
  });

  it("leaves other paths and methods alone", async () => {
    const route = createVoiceNoteRoutes(vi.fn<Transcriber>(), { recordDir, saveAudio: fakeSave() });
    expect(await call(route, "POST", "/api/voice-notes/other")).toBe(PASS);
    expect(await call(route, "DELETE", `/api/voice-notes/${ID}`)).toBe(PASS);
    expect(await call(route, "GET", "/api/other")).toBe(PASS);
    expect(await call(route, "PUT", `/api/voice-notes/${ID}/extra`)).toBe(PASS);
  });
});

describe("whisperTranscriber", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("tells a clip whisper cannot read apart from whisper being unavailable", async () => {
    const answer = (status: number) => vi.fn(async () => new Response(JSON.stringify({ error: `whisper ${status}` }), { status }));
    vi.stubGlobal("fetch", answer(400));
    await expect(whisperTranscriber("http://whisper.test")("/a.webm")).rejects.toMatchObject({ status: 422, message: "whisper 400" });
    vi.stubGlobal("fetch", answer(500));
    await expect(whisperTranscriber("http://whisper.test")("/a.webm")).rejects.toMatchObject({ status: 502, message: "whisper 500" });
  });
});

