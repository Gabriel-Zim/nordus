// The app records, not the page: a sandboxed frame has an opaque origin and cannot ask for the microphone.
import { AUDIO_MAX_BYTES, AUDIO_MIMES } from "./html-bridge";

export const RECORD_MAX_MS = 3 * 60 * 1000;

export type RecordFailure = "blocked" | "missing" | "unsupported" | "failed";
export class RecordError extends Error {
  constructor(readonly reason: RecordFailure) { super(reason); }
}

export interface Recording {
  mime: string;
  /** Resolves with the clip once the recorder has flushed; the microphone is released either way. */
  stop(): Promise<{ blob: Blob; tooLarge: boolean }>;
  cancel(): void;
}

const CANDIDATES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];

function pickMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  if (typeof MediaRecorder.isTypeSupported !== "function") return "";
  return CANDIDATES.find((candidate) => MediaRecorder.isTypeSupported(candidate));
}

function failure(error: unknown): RecordError {
  const name = (error as { name?: string } | null)?.name;
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") return new RecordError("blocked");
  if (name === "NotFoundError" || name === "OverconstrainedError") return new RecordError("missing");
  return new RecordError("failed");
}

/** `onLimit` fires when the 3 minutes or 10 MB ceiling is reached; the caller then stops the recording as usual. */
export async function startRecording(onLimit: () => void): Promise<Recording> {
  const mimeType = pickMime();
  if (mimeType === undefined || !navigator.mediaDevices?.getUserMedia) throw new RecordError("unsupported");
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (error) {
    throw failure(error);
  }
  const release = () => stream.getTracks().forEach((track) => track.stop());
  let recorder: MediaRecorder;
  try {
    recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
  } catch {
    release();
    throw new RecordError("unsupported");
  }
  const mime = (recorder.mimeType || mimeType || "audio/webm").split(";")[0]!.toLowerCase();
  if (!(AUDIO_MIMES as readonly string[]).includes(mime)) {
    release();
    throw new RecordError("unsupported");
  }
  const chunks: Blob[] = [];
  let bytes = 0;
  let tooLarge = false;
  let limitFired = false;
  const limit = () => { if (!limitFired) { limitFired = true; onLimit(); } };
  const timer = setTimeout(limit, RECORD_MAX_MS);
  recorder.ondataavailable = (event) => {
    if (!event.data?.size) return;
    chunks.push(event.data);
    bytes += event.data.size;
    if (bytes > AUDIO_MAX_BYTES) { tooLarge = true; limit(); }
  };
  const finished = new Promise<void>((resolve) => {
    recorder.onstop = () => { clearTimeout(timer); release(); resolve(); };
    recorder.onerror = () => { clearTimeout(timer); release(); resolve(); };
  });
  recorder.start(1000);
  const halt = () => { if (recorder.state !== "inactive") recorder.stop(); else { clearTimeout(timer); release(); } };
  return {
    mime,
    async stop() {
      halt();
      await finished;
      return { blob: new Blob(chunks, { type: mime }), tooLarge: tooLarge || bytes > AUDIO_MAX_BYTES };
    },
    cancel() { chunks.length = 0; halt(); },
  };
}
