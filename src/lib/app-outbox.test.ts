import { describe, expect, it, vi } from "vitest";
import { dropOrphanRecordings, followsNetwork, OUTBOX_OWNER_KEY, settleOutboxOwner, voiceNoteTransport } from "./app-outbox";
import { createSendOutbox, type OutboxTransport } from "./send-outbox";
import { memoryVoiceBlobs } from "./voice-note-blobs";

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const notFound = () => Object.assign(new Error("voice note not found"), { status: 404 });
const SEND = "voice-aaaaaaaaaaaaaaaa";

async function settle() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

/** The voice-note routes as the phone sees them: PUT keeps the clip, GET answers with its transcript. */
function fakeServer() {
  const saved = new Map<string, Blob>();
  const calls: string[] = [];
  const request = vi.fn(async (path: string, init?: RequestInit) => {
    const id = path.split("/").pop()!.split("?")[0]!;
    calls.push(`${init?.method ?? "GET"} ${id}`);
    if (init?.method === "PUT") {
      saved.set(id, init.body as Blob);
      return { id, path: `/data/${id}.webm`, mime: "audio/webm" };
    }
    if (!saved.has(id)) throw notFound();
    return { id, path: `/data/${id}.webm`, mime: "audio/webm", durationMs: 3_000, transcript: "liga para o cliente amanhã" };
  });
  return { request: request as never, saved, calls };
}

describe("voice notes in the outbox", () => {
  it("keeps the recording across a reload and uploads it once when the connection comes back", async () => {
    const storage = new MemoryStorage();
    const blobs = memoryVoiceBlobs();
    const recording = new Blob(["opus bytes"], { type: "audio/webm;codecs=opus" });
    await blobs.put(SEND, recording);
    const beforeReload = createSendOutbox({ storage, blobs, online: false });
    beforeReload.enqueue({
      sendId: SEND, draftId: "bot:designergrafico:t1", target: { kind: "bot", botId: "designergrafico" }, threadId: "t1", text: "",
      voice: { mime: "audio/webm;codecs=opus", durationMs: 3_000 },
    });
    beforeReload.stop();

    const server = fakeServer();
    const deliver = vi.fn<OutboxTransport["deliver"]>().mockResolvedValue(undefined);
    const afterReload = createSendOutbox({ storage, blobs });
    afterReload.attach({ ready: () => true, voiceNote: voiceNoteTransport(server.request, blobs), deliver });
    await settle();

    expect(server.calls).toEqual([`GET ${SEND}`, `PUT ${SEND}`, `GET ${SEND}`]);
    expect(server.saved.get(SEND)).toBe(recording);
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver.mock.calls[0]?.[0]).toMatchObject({ sendId: SEND, requestText: expect.stringContaining("liga para o cliente amanhã") });
    expect(await blobs.get(SEND)).toBeUndefined();
  });

  it("does not upload again when an earlier try already reached the server", async () => {
    const blobs = memoryVoiceBlobs();
    await blobs.put(SEND, new Blob(["opus bytes"]));
    const server = fakeServer();
    server.saved.set(SEND, new Blob(["opus bytes"]));
    const note = await voiceNoteTransport(server.request, blobs)({
      sendId: SEND, draftId: "d", target: { kind: "bot", botId: "designergrafico" }, threadId: "t1", text: "",
      voice: { mime: "audio/webm", durationMs: 3_000 }, createdAt: 0, expiresAt: 1, status: "sending",
    });
    expect(server.calls).toEqual([`GET ${SEND}`]);
    expect(note.transcript).toBe("liga para o cliente amanhã");
  });

  it("waits for the network only when the server is on another machine", () => {
    expect(followsNetwork("app.nordus.ai")).toBe(true);
    expect(followsNetwork("192.168.0.12")).toBe(true);
    expect(followsNetwork("localhost")).toBe(false);
    expect(followsNetwork("127.0.0.1")).toBe(false);
    expect(followsNetwork("[::1]")).toBe(false);
  });

  it("lets go of recordings whose send is no longer in the queue", async () => {
    const blobs = memoryVoiceBlobs();
    await blobs.put("voice-waiting-0000001", new Blob(["a"]));
    await blobs.put("voice-orphan-00000001", new Blob(["b"]));
    await dropOrphanRecordings(blobs, () => ["voice-waiting-0000001"]);
    expect(await blobs.keys()).toEqual(["voice-waiting-0000001"]);
  });

  it("keeps a recording another tab queued while this one was listing them", async () => {
    const blobs = memoryVoiceBlobs();
    await blobs.put("voice-just-queued-001", new Blob(["a"]));
    const queue: string[] = [];
    const listing = { ...blobs, keys: async () => { const keys = await blobs.keys(); queue.push("voice-just-queued-001"); return keys; } };
    await dropOrphanRecordings(listing, () => queue);
    expect(await blobs.keys()).toEqual(["voice-just-queued-001"]);
  });
});

describe("the queue's owner", () => {
  it("lets a queue left by a lost session go out only for the person who wrote it", () => {
    const storage = new MemoryStorage();
    const outbox = { clear: vi.fn() };
    settleOutboxOwner("avery@example.com", outbox, storage);
    settleOutboxOwner("avery@example.com", outbox, storage);
    settleOutboxOwner(undefined, outbox, storage);
    expect(outbox.clear).not.toHaveBeenCalled();
    settleOutboxOwner("outra@example.com", outbox, storage);
    expect(outbox.clear).toHaveBeenCalledTimes(1);
    expect(storage.getItem(OUTBOX_OWNER_KEY)).toBe("outra@example.com");
  });
});
