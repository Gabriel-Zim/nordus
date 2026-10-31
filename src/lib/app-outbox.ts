import { accessSignInExpired } from "./access-session";
import { createSendOutbox, OUTBOX_KEY, type OutboxEntry, type SendOutbox } from "./send-outbox";
import { signedOutWatch } from "./signed-out";
import { fallbackVoiceBlobs, indexedDbVoiceBlobs, memoryVoiceBlobs, type VoiceBlobStore } from "./voice-note-blobs";
import type { SentVoiceNote } from "./voice-note";

type Request = <T = unknown>(path: string, init?: RequestInit & { timeoutMs?: number }) => Promise<T>;

const TRANSCRIPT_WAIT_MS = 25_000;
const TRANSCRIPT_ASKS = 20;

type VoiceNoteAnswer = { path?: string; mime?: string; durationMs?: number; transcript?: string; status?: string };

/** Ask before uploading: an earlier try may have left the clip on the server, and the server saves and transcribes it once. */
export function voiceNoteTransport(request: Request, blobs: VoiceBlobStore) {
  return async (entry: OutboxEntry): Promise<SentVoiceNote> => {
    const at = `/api/voice-notes/${encodeURIComponent(entry.sendId)}`;
    for (let ask = 0; ask < TRANSCRIPT_ASKS; ask++) {
      let answer: VoiceNoteAnswer;
      try {
        answer = await request<VoiceNoteAnswer>(`${at}?waitMs=${TRANSCRIPT_WAIT_MS}`, { timeoutMs: TRANSCRIPT_WAIT_MS + 15_000 });
      } catch (error) {
        if ((error as { status?: number }).status !== 404) throw error;
        const blob = await blobs.get(entry.sendId);
        if (!blob) throw Object.assign(new Error("recording-missing"), { status: 410 });
        await request(at, {
          method: "PUT",
          headers: { "content-type": (entry.voice?.mime ?? blob.type).split(";")[0]! },
          body: blob,
          timeoutMs: 180_000,
        });
        continue;
      }
      if (typeof answer.transcript === "string" && answer.path && answer.mime) {
        return {
          path: answer.path,
          mime: answer.mime,
          durationMs: answer.durationMs ?? entry.voice?.durationMs,
          transcript: answer.transcript,
        };
      }
    }
    throw new Error("transcription still running");
  };
}

function storage(): Pick<Storage, "getItem" | "setItem"> | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

function blobStore(): VoiceBlobStore {
  try {
    if (typeof indexedDB !== "undefined") return fallbackVoiceBlobs(indexedDbVoiceBlobs(indexedDB));
  } catch {
  }
  return memoryVoiceBlobs();
}

export const voiceBlobs = blobStore();

/** A recording whose send is gone (delivered, cancelled, or lost with a cleared queue) has no reason to stay on the phone. */
export async function dropOrphanRecordings(blobs: VoiceBlobStore, waitingSends: () => Iterable<string>): Promise<void> {
  const ids = await blobs.keys().catch(() => []);
  // Read the queue only after the keys: another tab may have just recorded and queued its note.
  const waiting = new Set(waitingSends());
  for (const id of ids) {
    if (!waiting.has(id)) await blobs.delete(id).catch(() => undefined);
  }
}

/** A server on this machine answers with the network off, so only a remote one waits for the connection. */
export function followsNetwork(hostname: string): boolean {
  return !/^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/.test(hostname);
}

function appOutbox(): SendOutbox {
  const page = (globalThis as { window?: Partial<Window> }).window;
  const network = followsNetwork(page?.location?.hostname ?? "localhost");
  const outbox = createSendOutbox({
    storage: storage(),
    blobs: voiceBlobs,
    online: !network || typeof navigator === "undefined" || navigator.onLine !== false,
    ...(network ? { signInExpired: () => accessSignInExpired() } : {}),
    onSignedOut: (error) => void signedOutWatch.noteRefusal(error),
  });
  void dropOrphanRecordings(voiceBlobs, () => {
    outbox.refresh();
    return outbox.entries().map((entry) => entry.sendId);
  });
  if (network) {
    page?.addEventListener?.("online", () => outbox.reconnect());
    page?.addEventListener?.("offline", () => outbox.disconnect());
  }
  page?.addEventListener?.("storage", (event) => {
    if ((event as StorageEvent).key === OUTBOX_KEY) outbox.refresh();
  });
  // iOS freezes the page in the background; coming back is the moment to try again.
  page?.document?.addEventListener?.("visibilitychange", () => {
    if (page.document?.visibilityState === "visible" && (!network || navigator.onLine !== false)) outbox.reconnect();
  });
  return outbox;
}

export const sendOutbox = appOutbox();

export const OUTBOX_OWNER_KEY = "nordus-send-outbox-owner";

/** Before the app starts sending: a queue left by a signed-out session goes out only for the same person who wrote it. */
export function settleOutboxOwner(
  email: string | undefined,
  outbox: Pick<SendOutbox, "clear"> = sendOutbox,
  store: Pick<Storage, "getItem" | "setItem"> | undefined = storage(),
): void {
  if (!email || !store) return;
  try {
    const previous = store.getItem(OUTBOX_OWNER_KEY);
    if (previous && previous !== email) outbox.clear();
    if (previous !== email) store.setItem(OUTBOX_OWNER_KEY, email);
  } catch {
  }
}
