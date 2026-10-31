// Local speech to text for a bot's HTML page: the page records, the app uploads the clip here, and nothing leaves the machine.
// The clip is decoded to 16 kHz mono wav with ffmpeg and read by the loopback transcription service already used for voice notes.
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ATTACHMENTS_DIR } from "./attachments.ts";

export const TRANSCRIBE_MAX_BYTES = 10 * 1024 * 1024;
/** The whole upload must arrive within this long. */
export const TRANSCRIBE_UPLOAD_MS = 3 * 60 * 1000;
const TRANSCRIBE_TOTAL_MS = 5 * 60 * 1000;

const AUDIO_EXTENSIONS: Readonly<Record<string, string>> = {
  "audio/webm": ".webm",
  "audio/ogg": ".ogg",
  "audio/mp4": ".m4a",
  "audio/mpeg": ".mp3",
  "audio/wav": ".wav",
};

export function transcribableAudioExtension(mime: string | undefined): string | null {
  const value = mime?.split(";")[0]?.trim().toLowerCase();
  return value ? AUDIO_EXTENSIONS[value] ?? null : null;
}

function statusError(status: number, message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

function runFfmpeg(binary: string, input: string, output: string, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(binary, ["-hide_banner", "-loglevel", "error", "-y", "-i", input, "-vn", "-ac", "1", "-ar", "16000", "-f", "wav", output],
      { signal, timeout: TRANSCRIBE_TOTAL_MS }, (error) => {
        if (!error) return resolve();
        const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
        reject(statusError(missing ? 503 : 422, missing ? "ffmpeg is not installed on the server" : "the audio could not be decoded"));
      });
  });
}

/** Always removes both temporary files, whatever happens. */
export async function transcribeLocally(bytes: Buffer, mime: string): Promise<string> {
  const extension = transcribableAudioExtension(mime);
  if (!extension) throw statusError(415, "unsupported audio type");
  if (bytes.byteLength === 0) throw statusError(400, "empty audio");
  if (bytes.byteLength > TRANSCRIBE_MAX_BYTES) throw statusError(413, "audio exceeds 10 MB");
  const dir = join(ATTACHMENTS_DIR, "transcrever");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const id = randomUUID();
  const source = join(dir, `${id}-in${extension}`);
  const wav = join(dir, `${id}.wav`);
  const signal = AbortSignal.timeout(TRANSCRIBE_TOTAL_MS);
  try {
    await writeFile(source, bytes, { mode: 0o600, flag: "wx" });
    await runFfmpeg(process.env.NORDUS_FFMPEG_PATH || "ffmpeg", source, wav, signal);
    const url = process.env.NORDUS_TRANSCRIBE_URL || "http://127.0.0.1:8890/transcribe";
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: wav }),
      signal,
    }).catch(() => { throw statusError(502, "the transcription service is unavailable"); });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw statusError(res.status >= 400 && res.status < 500 ? 422 : 502, typeof body.error === "string" ? body.error : "transcription failed");
    return typeof body.text === "string" ? body.text.trim() : "";
  } finally {
    await Promise.all([unlink(source), unlink(wav)].map((p) => p.catch(() => undefined)));
  }
}

/** Reads a raw body up to the cap, within the upload time limit. */
export function readLimitedBody(req: NodeJS.ReadableStream & { destroy(error?: Error): unknown }, max = TRANSCRIBE_MAX_BYTES, timeoutMs = TRANSCRIBE_UPLOAD_MS): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let received = 0;
    let done = false;
    const finish = (error: Error | null, value?: Buffer) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (error) reject(error); else resolve(value!);
    };
    const timer = setTimeout(() => finish(statusError(408, "upload took too long")), timeoutMs);
    req.on("data", (chunk: Buffer) => {
      received += chunk.byteLength;
      if (received > max) return finish(statusError(413, "audio exceeds 10 MB"));
      chunks.push(chunk);
    });
    req.on("end", () => finish(null, Buffer.concat(chunks)));
    req.on("error", (error) => finish(error));
  });
}
