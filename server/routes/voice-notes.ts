import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeFileAtomic } from "../atomic.ts";
import { ATTACHMENTS_DIR, saveAudio } from "../attachments.ts";
import { VOICE_NOTE_MAX_BYTES } from "../../shared/voice-note-limits.ts";
import { PASS, type RouteContext, type RouteHandler } from "./table.ts";

const DEFAULT_WAIT_MS = 25_000;
const MAX_WAIT_MS = 60_000;
const VOICE_NOTE_PATH = /^\/api\/voice-notes\/([^/]+)$/;
const VOICE_NOTE_ID = /^[A-Za-z0-9_-]{16,80}$/;

export interface Transcriber {
  (path: string): Promise<{ text: string; language?: string; duration?: number; seconds?: number }>;
}

interface Transcript {
  durationMs?: number;
  transcript: string;
  language?: string;
  seconds?: number;
}

interface VoiceNote {
  id: string;
  path: string;
  mime: string;
  result?: Transcript;
}

export interface VoiceNoteRouteOptions {
  recordDir?: string;
  saveAudio?: (bytes: Buffer, mime: string) => { path: string; mime: string };
}

/** The local faster-whisper service; it only listens on loopback. */
export function whisperTranscriber(base = process.env.NORDUS_WHISPER_URL ?? "http://127.0.0.1:8890"): Transcriber {
  return async (path) => {
    const res = await fetch(`${base}/transcribe`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path }),
      signal: AbortSignal.timeout(180_000),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    // A clip whisper refuses (cannot decode it) will be refused again; anything else may pass on a later try.
    const status = res.status >= 400 && res.status < 500 ? 422 : 502;
    if (!res.ok) throw Object.assign(new Error(typeof body.error === "string" ? body.error : "transcription failed"), { status });
    return {
      text: typeof body.text === "string" ? body.text : "",
      language: typeof body.language === "string" ? body.language : undefined,
      duration: typeof body.duration === "number" ? body.duration : undefined,
      seconds: typeof body.seconds === "number" ? body.seconds : undefined,
    };
  };
}

function readAudio(req: RouteContext["req"]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let received = 0;
    req.on("data", (chunk: Buffer) => {
      received += chunk.byteLength;
      if (received > VOICE_NOTE_MAX_BYTES) {
        reject(Object.assign(new Error("voice note is too long"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function audioType(req: RouteContext["req"]): string | null {
  const raw = Array.isArray(req.headers["content-type"]) ? req.headers["content-type"][0] : req.headers["content-type"];
  const mime = raw?.split(";")[0]?.trim().toLowerCase() ?? "";
  return mime.startsWith("audio/") ? mime : null;
}

function parseWaitMs(raw: string | null): number {
  const value = raw === null || raw === "" ? Number.NaN : Number(raw);
  if (!Number.isFinite(value)) return DEFAULT_WAIT_MS;
  return Math.min(MAX_WAIT_MS, Math.max(0, Math.round(value)));
}

function clip({ id, path, mime }: VoiceNote) {
  return { id, path, mime };
}

function errorStatus(error: unknown, fallback: number): number {
  return (error as { status?: number }).status ?? fallback;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/**
 * PUT /api/voice-notes/:id stores raw audio once per client id and transcribes it in the background.
 * GET /api/voice-notes/:id?waitMs=N waits for the transcript. The transcript goes to the bot, not the screen.
 */
export function createVoiceNoteRoutes(
  transcribe: Transcriber = whisperTranscriber(),
  options: VoiceNoteRouteOptions = {},
): RouteHandler {
  const recordDir = options.recordDir ?? join(ATTACHMENTS_DIR, "voice-notes");
  const save = options.saveAudio ?? saveAudio;
  const saving = new Map<string, Promise<VoiceNote>>();
  const transcribing = new Map<string, Promise<Transcript>>();

  const recordPath = (id: string) => join(recordDir, `${id}.json`);

  function readNote(id: string): VoiceNote | undefined {
    try {
      return JSON.parse(readFileSync(recordPath(id), "utf8")) as VoiceNote;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  function writeNote(note: VoiceNote): void {
    mkdirSync(recordDir, { recursive: true, mode: 0o700 });
    writeFileAtomic(recordPath(note.id), JSON.stringify(note), { mode: 0o600 });
  }

  function ensureTranscript(note: VoiceNote): Promise<Transcript> {
    if (note.result) return Promise.resolve(note.result);
    const running = transcribing.get(note.id);
    if (running) return running;
    const started = transcribe(note.path)
      .then((raw) => {
        const result: Transcript = {
          durationMs: raw.duration ? Math.round(raw.duration * 1000) : undefined,
          transcript: raw.text.trim(),
          language: raw.language,
          seconds: raw.seconds,
        };
        writeNote({ ...note, result });
        return result;
      })
      .finally(() => transcribing.delete(note.id));
    transcribing.set(note.id, started);
    return started;
  }

  async function storeOnce(id: string, req: RouteContext["req"], mime: string): Promise<VoiceNote> {
    for (;;) {
      const existing = readNote(id);
      if (existing) {
        req.resume();
        return existing;
      }
      const inFlight = saving.get(id);
      if (!inFlight) break;
      // A failed first upload leaves nothing saved, so this request's own body becomes the upload.
      await inFlight.catch(() => undefined);
    }
    const upload = (async () => {
      const saved = save(await readAudio(req), mime);
      const note: VoiceNote = { id, path: saved.path, mime: saved.mime };
      writeNote(note);
      return note;
    })().finally(() => saving.delete(id));
    saving.set(id, upload);
    return upload;
  }

  /**
   * The upload-and-wait route a page loaded before the switch to PUT/GET still calls; it saves and transcribes on every
   * try, as it always did. Remove it one release after the PUT/GET routes ship.
   */
  async function legacyVoiceNote(req: RouteContext["req"], res: RouteContext["res"], json: RouteContext["json"]) {
    const mime = audioType(req);
    if (!mime) {
      req.resume();
      return json(res, 400, { error: "content-type must be an audio type" });
    }
    try {
      const saved = save(await readAudio(req), mime);
      const result = await transcribe(saved.path);
      return json(res, 201, {
        path: saved.path,
        mime: saved.mime,
        durationMs: result.duration ? Math.round(result.duration * 1000) : undefined,
        transcript: result.text.trim(),
        language: result.language,
        seconds: result.seconds,
      });
    } catch (error) {
      return json(res, errorStatus(error, 500), { error: errorMessage(error, "voice note failed") });
    }
  }

  async function waitForTranscript(note: VoiceNote, waitMs: number): Promise<Transcript | "running"> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<"running">((resolve) => {
      timer = setTimeout(() => resolve("running"), waitMs);
    });
    try {
      return await Promise.race([ensureTranscript(note), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  return async ({ req, res, url, path, method, json }) => {
    if (method === "POST" && path === "/api/voice-notes") return legacyVoiceNote(req, res, json);
    if (method !== "PUT" && method !== "GET") return PASS;
    const match = VOICE_NOTE_PATH.exec(path);
    if (!match) return PASS;
    const id = match[1]!;
    if (!VOICE_NOTE_ID.test(id)) {
      req.resume();
      return json(res, 400, { error: "voice note id must be a client-generated id" });
    }

    if (method === "PUT") {
      const mime = audioType(req);
      if (!mime) {
        req.resume();
        return json(res, 400, { error: "content-type must be an audio type" });
      }
      try {
        const note = await storeOnce(id, req, mime);
        ensureTranscript(note).catch(() => undefined);
        return json(res, 202, clip(note));
      } catch (error) {
        return json(res, errorStatus(error, 500), { error: errorMessage(error, "voice note failed") });
      }
    }

    const note = readNote(id);
    if (!note) return json(res, 404, { error: "voice note not found" });
    try {
      const outcome = await waitForTranscript(note, parseWaitMs(url.searchParams.get("waitMs")));
      if (outcome === "running") return json(res, 202, { ...clip(note), status: "transcribing" });
      return json(res, 200, { ...clip(note), ...outcome });
    } catch (error) {
      return json(res, errorStatus(error, 502), { error: errorMessage(error, "transcription failed") });
    }
  };
}
