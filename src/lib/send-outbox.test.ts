import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSendOutbox, OUTBOX_KEY, OUTBOX_TTL_MS, SERVER_FAILURE_LIMIT_MS, STALE_SENDING_MS, type OutboxEntry, type OutboxTransport } from "./send-outbox";

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const offline = () => Object.assign(new TypeError("Failed to fetch"));
const refused = (status: number, message: string) => Object.assign(new Error(message), { status });

function transport(deliver: OutboxTransport["deliver"], voiceNote: OutboxTransport["voiceNote"] = vi.fn()): OutboxTransport {
  return { ready: () => true, deliver, voiceNote };
}

const text = (sendId: string, words = "oi DESIGNERGRAFICO") => ({
  sendId,
  draftId: "bot:designergrafico:t1",
  target: { kind: "bot" as const, botId: "designergrafico" },
  threadId: "t1",
  text: words,
  requestText: words,
});

async function settle() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

describe("send outbox", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("retries a send that never got an answer with the same sendId until the server takes it", async () => {
    const deliver = vi.fn<OutboxTransport["deliver"]>()
      .mockRejectedValueOnce(offline())
      .mockRejectedValueOnce(refused(503, "restarting"))
      .mockResolvedValueOnce(undefined);
    const outbox = createSendOutbox({ storage: new MemoryStorage() });
    outbox.attach(transport(deliver));
    outbox.enqueue(text("send-aaaaaaaaaaaaaaaa"));
    await settle();
    expect(outbox.entries()[0]?.status).toBe("queued");
    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(deliver.mock.calls.map(([entry]) => entry.sendId)).toEqual([
      "send-aaaaaaaaaaaaaaaa", "send-aaaaaaaaaaaaaaaa", "send-aaaaaaaaaaaaaaaa",
    ]);
    expect(outbox.entries().map((entry) => entry.status)).toEqual(["delivered"]);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(outbox.entries()).toEqual([]);
  });

  it("waits for the connection instead of trying while offline", async () => {
    const deliver = vi.fn<OutboxTransport["deliver"]>().mockResolvedValue(undefined);
    const outbox = createSendOutbox({ storage: new MemoryStorage(), online: false });
    outbox.attach(transport(deliver));
    outbox.enqueue(text("send-bbbbbbbbbbbbbbbb"));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(deliver).not.toHaveBeenCalled();
    outbox.reconnect();
    await settle();
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it("turns a send still waiting after 24 hours into a visible failure, and Tentar de novo sends it", async () => {
    const deliver = vi.fn<OutboxTransport["deliver"]>().mockResolvedValue(undefined);
    const outbox = createSendOutbox({ storage: new MemoryStorage(), online: false });
    outbox.attach(transport(deliver));
    outbox.enqueue(text("send-cccccccccccccccc"));
    await vi.advanceTimersByTimeAsync(OUTBOX_TTL_MS);
    expect(outbox.entries()[0]).toMatchObject({ status: "failed", expired: true });
    outbox.reconnect();
    await settle();
    expect(deliver).not.toHaveBeenCalled();
    outbox.retry("send-cccccccccccccccc");
    await settle();
    expect(deliver.mock.calls[0]?.[0].sendId).toBe("send-cccccccccccccccc");
  });

  it("marks a refusal as failed and goes on with the next message", async () => {
    const deliver = vi.fn<OutboxTransport["deliver"]>()
      .mockRejectedValueOnce(refused(403, "Esta conversa é de outra pessoa."))
      .mockResolvedValueOnce(undefined);
    const outbox = createSendOutbox({ storage: new MemoryStorage() });
    outbox.attach(transport(deliver));
    outbox.enqueue(text("send-dddddddddddddddd", "primeira"));
    outbox.enqueue(text("send-eeeeeeeeeeeeeeee", "segunda"));
    await settle();
    expect(outbox.entries().map((entry) => [entry.text, entry.status, entry.error])).toEqual([
      ["primeira", "failed", "Esta conversa é de outra pessoa."],
      ["segunda", "delivered", undefined],
    ]);
  });

  it("keeps a conversation in order while another conversation sends at the same time", async () => {
    let releaseFirst: () => void = () => undefined;
    const deliver = vi.fn<OutboxTransport["deliver"]>((entry) => entry.sendId === "send-iiiiiiiiiiiiiiii"
      ? new Promise<void>((resolve) => { releaseFirst = resolve; })
      : Promise.resolve());
    const outbox = createSendOutbox({ storage: new MemoryStorage() });
    outbox.attach(transport(deliver));
    outbox.enqueue(text("send-iiiiiiiiiiiiiiii", "DESIGNERGRAFICO primeira"));
    outbox.enqueue(text("send-jjjjjjjjjjjjjjjj", "DESIGNERGRAFICO segunda"));
    outbox.enqueue({ ...text("send-kkkkkkkkkkkkkkkk", "EDITORDEVIDEO"), threadId: "t2", draftId: "bot:editordevideo:t2" });
    await settle();
    expect(deliver.mock.calls.map(([entry]) => entry.text)).toEqual(["DESIGNERGRAFICO primeira", "EDITORDEVIDEO"]);
    releaseFirst();
    await settle();
    expect(deliver.mock.calls.map(([entry]) => entry.text)).toEqual(["DESIGNERGRAFICO primeira", "EDITORDEVIDEO", "DESIGNERGRAFICO segunda"]);
  });

  it("keeps the queue across a reload and resumes a send cut off mid-flight with the same sendId", async () => {
    const storage = new MemoryStorage();
    const before = createSendOutbox({ storage, online: false });
    before.enqueue(text("send-ffffffffffffffff"));
    const saved = JSON.parse(storage.getItem(OUTBOX_KEY)!) as OutboxEntry[];
    storage.setItem(OUTBOX_KEY, JSON.stringify(saved.map((entry) => ({ ...entry, status: "sending" }))));
    before.stop();

    const deliver = vi.fn<OutboxTransport["deliver"]>().mockResolvedValue(undefined);
    const after = createSendOutbox({ storage });
    expect(after.entries()[0]).toMatchObject({ sendId: "send-ffffffffffffffff", status: "queued" });
    after.attach(transport(deliver));
    await settle();
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver.mock.calls[0]?.[0]).toMatchObject({ sendId: "send-ffffffffffffffff", requestText: "oi DESIGNERGRAFICO" });
    expect(JSON.parse(storage.getItem(OUTBOX_KEY)!)).toEqual([]);
  });

  it("sends nothing the person cancelled", async () => {
    const deliver = vi.fn<OutboxTransport["deliver"]>().mockResolvedValue(undefined);
    const blobs = { delete: vi.fn(async () => undefined) };
    const outbox = createSendOutbox({ storage: new MemoryStorage(), blobs, online: false });
    outbox.attach(transport(deliver));
    outbox.enqueue({ ...text("send-gggggggggggggggg"), requestText: undefined, voice: { mime: "audio/webm", durationMs: 4_000 } });
    expect(outbox.cancel("send-gggggggggggggggg")).toBe(true);
    outbox.reconnect();
    await settle();
    expect(deliver).not.toHaveBeenCalled();
    expect(blobs.delete).toHaveBeenCalledWith("send-gggggggggggggggg");
  });

  it("sends a voice note as its transcript once the server has it, then lets the recording go", async () => {
    const deliver = vi.fn<OutboxTransport["deliver"]>().mockResolvedValue(undefined);
    const voiceNote = vi.fn<OutboxTransport["voiceNote"]>()
      .mockRejectedValueOnce(offline())
      .mockResolvedValueOnce({ path: "/data/a.webm", mime: "audio/webm", durationMs: 4_000, transcript: "manda o relatório" });
    const blobs = { delete: vi.fn(async () => undefined) };
    const outbox = createSendOutbox({ storage: new MemoryStorage(), blobs });
    outbox.attach(transport(deliver, voiceNote));
    outbox.enqueue({ ...text("send-hhhhhhhhhhhhhhhh", ""), requestText: undefined, voice: { mime: "audio/webm", durationMs: 4_000 } });
    await settle();
    expect(blobs.delete).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    expect(voiceNote).toHaveBeenCalledTimes(2);
    expect(deliver.mock.calls[0]?.[0].requestText).toBe('<voice-note path="/data/a.webm" mime="audio/webm" duration-ms="4000">\nmanda o relatório\n</voice-note>');
    expect(blobs.delete).toHaveBeenCalledWith("send-hhhhhhhhhhhhhhhh");
  });

  it("stops retrying a send the server keeps failing, shows it, and lets the conversation move on", async () => {
    const deliver = vi.fn<OutboxTransport["deliver"]>((entry) => entry.sendId === "send-llllllllllllllll"
      ? Promise.reject(refused(502, "transcription failed"))
      : Promise.resolve());
    const outbox = createSendOutbox({ storage: new MemoryStorage() });
    outbox.attach(transport(deliver));
    outbox.enqueue(text("send-llllllllllllllll", "primeira"));
    outbox.enqueue(text("send-mmmmmmmmmmmmmmmm", "segunda"));
    await vi.advanceTimersByTimeAsync(SERVER_FAILURE_LIMIT_MS - 10_000);
    expect(outbox.entries().map((entry) => entry.status)).toEqual(["queued", "queued"]);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(outbox.entries().map((entry) => [entry.text, entry.status, entry.error])).toEqual([
      ["primeira", "failed", "transcription failed"],
    ]);
    expect(deliver.mock.calls.at(-1)?.[0].text).toBe("segunda");
  });

  it("keeps waiting through a network that never answers until the 24 hours run out", async () => {
    const deliver = vi.fn<OutboxTransport["deliver"]>().mockRejectedValue(offline());
    const outbox = createSendOutbox({ storage: new MemoryStorage() });
    outbox.attach(transport(deliver));
    outbox.enqueue(text("send-nnnnnnnnnnnnnnnn"));
    await vi.advanceTimersByTimeAsync(SERVER_FAILURE_LIMIT_MS * 3);
    expect(outbox.entries()[0]?.status).toBe("queued");
    outbox.stop();
  });

  it("never drops a send another tab of the app queued, and sees its cancel", async () => {
    const storage = new MemoryStorage();
    const tabA = createSendOutbox({ storage, online: false });
    const tabB = createSendOutbox({ storage });
    tabA.enqueue(text("send-oooooooooooooooo", "da aba A"));
    tabB.attach(transport(vi.fn<OutboxTransport["deliver"]>((entry) => entry.sendId === "send-pppppppppppppppp" ? Promise.resolve() : new Promise<void>(() => undefined))));
    tabB.enqueue({ ...text("send-pppppppppppppppp", "da aba B"), threadId: "t2" });
    await settle();
    expect((JSON.parse(storage.getItem(OUTBOX_KEY)!) as OutboxEntry[]).map((entry) => entry.requestText)).toEqual(["da aba A"]);
    const tabC = createSendOutbox({ storage, online: false });
    expect(tabC.cancel("send-oooooooooooooooo")).toBe(true);
    tabA.refresh();
    expect(tabA.entries()).toEqual([]);
  });

  it("forgets everything queued on sign-out, recordings included", () => {
    const storage = new MemoryStorage();
    const blobs = { delete: vi.fn(async () => undefined) };
    const outbox = createSendOutbox({ storage, blobs, online: false });
    outbox.enqueue(text("send-qqqqqqqqqqqqqqqq"));
    outbox.enqueue({ ...text("send-rrrrrrrrrrrrrrrr"), requestText: undefined, voice: { mime: "audio/webm", durationMs: 1_000 } });
    outbox.clear();
    expect(outbox.entries()).toEqual([]);
    expect(JSON.parse(storage.getItem(OUTBOX_KEY)!)).toEqual([]);
    expect(blobs.delete).toHaveBeenCalledWith("send-rrrrrrrrrrrrrrrr");
  });

  it("lets a failure the person never looked at go after a week", async () => {
    const storage = new MemoryStorage();
    const before = createSendOutbox({ storage, online: false });
    before.enqueue(text("send-ssssssssssssssss"));
    await vi.advanceTimersByTimeAsync(OUTBOX_TTL_MS);
    expect(before.entries()[0]?.status).toBe("failed");
    before.stop();
    expect(createSendOutbox({ storage, online: false }).entries()).toHaveLength(1);
    vi.setSystemTime(Date.now() + 7 * OUTBOX_TTL_MS);
    expect(createSendOutbox({ storage, online: false }).entries()).toEqual([]);
  });

  it("keeps a send in memory when the device storage is full, and still delivers it", async () => {
    const full = { getItem: () => "[]", setItem: () => { throw new DOMException("quota", "QuotaExceededError"); } };
    const deliver = vi.fn<OutboxTransport["deliver"]>().mockRejectedValueOnce(offline()).mockResolvedValueOnce(undefined);
    const outbox = createSendOutbox({ storage: full });
    outbox.attach(transport(deliver));
    outbox.enqueue(text("send-tttttttttttttttt"));
    await settle();
    expect(outbox.entries().map((entry) => [entry.sendId, entry.status])).toEqual([["send-tttttttttttttttt", "queued"]]);
    await vi.advanceTimersByTimeAsync(500);
    expect(deliver.mock.calls.map(([entry]) => entry.sendId)).toEqual(["send-tttttttttttttttt", "send-tttttttttttttttt"]);
  });

  it("stores a typed message once, not as both its text and its request", () => {
    const storage = new MemoryStorage();
    createSendOutbox({ storage, online: false }).enqueue(text("send-uuuuuuuuuuuuuuuu", "um texto bem comprido"));
    expect(storage.getItem(OUTBOX_KEY)!.split("um texto bem comprido")).toHaveLength(2);
    expect(createSendOutbox({ storage, online: false }).entries()[0]?.text).toBe("um texto bem comprido");
  });

  it("takes back a send another tab left on its way when it closed", async () => {
    const storage = new MemoryStorage();
    const at = Date.now();
    const left = { ...text("send-vvvvvvvvvvvvvvvv"), createdAt: at, expiresAt: at + OUTBOX_TTL_MS, status: "sending", sendingSince: at };
    const deliver = vi.fn<OutboxTransport["deliver"]>().mockResolvedValue(undefined);
    const outbox = createSendOutbox({ storage, online: false });
    outbox.attach(transport(deliver));
    storage.setItem(OUTBOX_KEY, JSON.stringify([left]));
    outbox.refresh();
    outbox.reconnect();
    await settle();
    expect(deliver).not.toHaveBeenCalled();
    expect(outbox.entries()[0]?.status).toBe("sending");
    vi.setSystemTime(at + STALE_SENDING_MS + 1);
    outbox.drain();
    await settle();
    expect(deliver.mock.calls[0]?.[0].sendId).toBe("send-vvvvvvvvvvvvvvvv");
  });

  it("does not send what another tab cancelled after this tab last looked", async () => {
    const storage = new MemoryStorage();
    const deliver = vi.fn<OutboxTransport["deliver"]>().mockResolvedValue(undefined);
    const tabA = createSendOutbox({ storage, online: false });
    tabA.attach(transport(deliver));
    tabA.enqueue(text("send-wwwwwwwwwwwwwwww"));
    createSendOutbox({ storage, online: false }).cancel("send-wwwwwwwwwwwwwwww");
    tabA.reconnect();
    await settle();
    expect(deliver).not.toHaveBeenCalled();
    expect(tabA.entries()).toEqual([]);
  });

  it("offers a refused sendId a new one, and only then sends it again", async () => {
    const deliver = vi.fn<OutboxTransport["deliver"]>()
      .mockRejectedValueOnce(refused(409, "sendId already belongs to another message"))
      .mockResolvedValueOnce(undefined);
    const outbox = createSendOutbox({ storage: new MemoryStorage() });
    outbox.attach(transport(deliver));
    outbox.enqueue(text("send-xxxxxxxxxxxxxxxx"));
    await settle();
    expect(outbox.entries()[0]).toMatchObject({ status: "failed", errorStatus: 409 });
    outbox.resendAsNew("send-xxxxxxxxxxxxxxxx", "send-yyyyyyyyyyyyyyyy");
    await settle();
    expect(deliver.mock.calls.map(([entry]) => entry.sendId)).toEqual(["send-xxxxxxxxxxxxxxxx", "send-yyyyyyyyyyyyyyyy"]);
  });

  it("marks a send that never reached Nordus because the sign-in expired, asking once per run", async () => {
    const signInExpired = vi.fn(async () => true);
    const deliver = vi.fn<OutboxTransport["deliver"]>().mockRejectedValue(offline());
    const outbox = createSendOutbox({ storage: new MemoryStorage(), signInExpired });
    outbox.attach(transport(deliver));
    outbox.enqueue(text("send-zzzzzzzzzzzzzzzz"));
    await settle();
    expect(outbox.entries()[0]).toMatchObject({ status: "queued", signInExpired: true });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(deliver.mock.calls.length).toBeGreaterThan(1);
    expect(signInExpired).toHaveBeenCalledTimes(1);
    outbox.stop();
  });

  it("keeps a send Nordus refused for a lost session in the queue, holds the rest, and delivers them after signing in", async () => {
    const storage = new MemoryStorage();
    const lostCookie = Object.assign(new Error("forbidden: this request came through a proxy (pair this device to use the server remotely)"), {
      status: 403, body: { error: "forbidden", code: "signed-out" },
    });
    const deliver = vi.fn<OutboxTransport["deliver"]>().mockRejectedValue(lostCookie);
    const onSignedOut = vi.fn();
    const outbox = createSendOutbox({ storage, onSignedOut });
    outbox.attach(transport(deliver));
    outbox.enqueue(text("send-s1s1s1s1s1s1s1s1", "primeira"));
    outbox.enqueue({ ...text("send-s2s2s2s2s2s2s2s2", "outra conversa"), threadId: "t2" });
    await settle();
    expect(outbox.entries().map((entry) => [entry.status, entry.signedOut])).toEqual([["queued", true], ["queued", true]]);
    expect(onSignedOut).toHaveBeenCalledWith(lostCookie);
    // Held, not failed and not hammering: no retry timer, and a new message joins the queue the same way.
    await vi.advanceTimersByTimeAsync(SERVER_FAILURE_LIMIT_MS * 2);
    outbox.enqueue(text("send-s3s3s3s3s3s3s3s3", "segunda"));
    await settle();
    // One try per conversation (they run side by side), then nothing more.
    expect(deliver).toHaveBeenCalledTimes(2);
    expect(outbox.entries().every((entry) => entry.status === "queued" && entry.signedOut)).toBe(true);
    outbox.stop();

    // Signing in reloads the page: the queue comes back from storage and goes out, oldest first, under the new session.
    const signedIn = vi.fn<OutboxTransport["deliver"]>().mockResolvedValue(undefined);
    const after = createSendOutbox({ storage });
    expect(after.entries().some((entry) => entry.signedOut)).toBe(false);
    after.attach(transport(signedIn));
    await settle();
    await settle();
    expect(signedIn.mock.calls.map(([entry]) => entry.requestText)).toEqual(["primeira", "outra conversa", "segunda"]);
    expect(after.entries().map((entry) => entry.status)).toEqual(["delivered", "delivered", "delivered"]);
  });

  it("recognises a lost session from servers that send only the words, and still fails other refusals", async () => {
    const legacy = refused(401, "unauthorized: this session has expired or was revoked; pair this device again");
    const deliver = vi.fn<OutboxTransport["deliver"]>()
      .mockRejectedValueOnce(legacy)
      .mockRejectedValueOnce(refused(403, "forbidden: this session lacks the admin scope"));
    const outbox = createSendOutbox({ storage: new MemoryStorage() });
    outbox.attach(transport(deliver));
    outbox.enqueue(text("send-l1l1l1l1l1l1l1l1"));
    await settle();
    expect(outbox.entries()[0]).toMatchObject({ status: "queued", signedOut: true });
    outbox.reconnect();
    await settle();
    expect(outbox.entries()[0]).toMatchObject({ status: "failed", errorStatus: 403 });
  });

  it("lets the recording of a week-old failure go with it", async () => {
    const storage = new MemoryStorage();
    const before = createSendOutbox({ storage, online: false });
    before.enqueue({ ...text("send-abababababababab"), requestText: undefined, voice: { mime: "audio/webm", durationMs: 1_000 } });
    await vi.advanceTimersByTimeAsync(OUTBOX_TTL_MS);
    before.stop();
    vi.setSystemTime(Date.now() + 7 * OUTBOX_TTL_MS);
    const blobs = { delete: vi.fn(async () => undefined) };
    createSendOutbox({ storage, blobs, online: false });
    expect(blobs.delete).toHaveBeenCalledWith("send-abababababababab");
  });

  it("gives Cancelar back to a send another tab left on its way, with no event to wake it", async () => {
    const storage = new MemoryStorage();
    const at = Date.now();
    storage.setItem(OUTBOX_KEY, JSON.stringify([{ ...text("send-cdcdcdcdcdcdcdcd"), createdAt: at, expiresAt: at + OUTBOX_TTL_MS, status: "queued" }]));
    const outbox = createSendOutbox({ storage, online: false });
    storage.setItem(OUTBOX_KEY, JSON.stringify([{ ...text("send-cdcdcdcdcdcdcdcd"), createdAt: at, expiresAt: at + OUTBOX_TTL_MS, status: "sending", sendingSince: at }]));
    outbox.refresh();
    expect(outbox.entries()[0]?.status).toBe("sending");
    expect(outbox.cancel("send-cdcdcdcdcdcdcdcd")).toBe(false);
    await vi.advanceTimersByTimeAsync(STALE_SENDING_MS + 1);
    expect(outbox.entries()[0]?.status).toBe("queued");
    expect(outbox.cancel("send-cdcdcdcdcdcdcdcd")).toBe(true);
  });

  it("keeps a cancel made while the device storage is full, instead of sending the stale copy on disk", async () => {
    const values = new Map<string, string>();
    let full = false;
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { if (full) throw new DOMException("quota", "QuotaExceededError"); values.set(key, value); },
    };
    const deliver = vi.fn<OutboxTransport["deliver"]>().mockResolvedValue(undefined);
    const outbox = createSendOutbox({ storage, online: false });
    outbox.attach(transport(deliver));
    outbox.enqueue(text("send-efefefefefefefef", "cancelada"));
    full = true;
    expect(outbox.cancel("send-efefefefefefefef")).toBe(true);
    outbox.refresh();
    outbox.reconnect();
    await settle();
    expect(deliver).not.toHaveBeenCalled();
    expect(outbox.entries()).toEqual([]);
  });
});

