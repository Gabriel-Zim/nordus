// A short sample of each GPT-Live voice. Several voices exist only on the live model, and the live API takes only WebRTC,
// so the first listen of a voice runs through the browser: this opens a session the browser connects to and makes the
// voice speak the sample over the sideband, exactly as a call does. The browser records it and PUTs the recording back,
// and every later listen is served from disk without calling OpenAI. The key never leaves here.
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { LIVE_VOICE_OPTIONS } from "../shared/live-call.ts";
import { LIVE_DATA_CHANNEL, LIVE_MODEL, LIVE_NEEDS_KEY, LiveSessionError, MAX_SDP_BYTES, liveAttachUrl, liveErrorMessage, liveSessionsUrl } from "./live-call.ts";
import type { LiveSocket } from "./live-call-controller.ts";

export const VOICE_PREVIEW_TEXT = "Oi! Essa é a minha voz. Posso falar com você assim nas chamadas.";
export const MAX_PREVIEW_BYTES = 2 * 1024 * 1024;
const CREATE_TIMEOUT_MS = 20_000;
const SESSION_CAP_MS = 15_000;
const SPEAK_FALLBACK_MS = 5_000;
const SOCKET_OPEN = 1;

const TYPES: Array<{ mime: string; ext: string }> = [
  { mime: "audio/webm", ext: "webm" },
  { mime: "audio/ogg", ext: "ogg" },
  { mime: "audio/mp4", ext: "m4a" },
];

export function isLiveVoice(voice: string): boolean {
  return LIVE_VOICE_OPTIONS.some((option) => option.id === voice);
}

/** The base audio type of a Content-Type header ("audio/webm;codecs=opus" is audio/webm), or null when not accepted. */
export function previewMime(header: string | undefined): string | null {
  const base = (header ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  return TYPES.some((type) => type.mime === base) ? base : null;
}

export interface VoicePreviewDeps {
  dir: string;
  /** The OpenAI key, resolved at call time; null when none is set. */
  key(): string | null;
  fetchImpl?: typeof fetch;
  openSocket?: (url: string, key: string) => LiveSocket;
  sessionCapMs?: number;
  speakFallbackMs?: number;
}

export interface VoicePreviews {
  /** The saved recording, or null when this voice has not been heard yet. */
  read(voice: string): Promise<{ data: Buffer; mime: string } | null>;
  save(voice: string, data: Buffer, mime: string): Promise<void>;
  /** Answers the browser's SDP offer and makes the voice speak the sample; throws LiveSessionError (409 without a key, 429 when one is already running). */
  start(voice: string, sdp: string): Promise<{ sdp: string }>;
}

export function createVoicePreviews(deps: VoicePreviewDeps): VoicePreviews {
  const running = new Set<string>();
  const fileFor = (voice: string, ext: string) => join(deps.dir, `${voice}.${ext}`);

  function speakOver(sessionId: string, key: string, release: () => void): void {
    const open = deps.openSocket ?? ((url: string, k: string) => new WebSocket(url, { headers: { authorization: `Bearer ${k}` } } as unknown as string[]) as unknown as LiveSocket);
    let socket: LiveSocket | undefined;
    let done = false;
    let spoke = false;
    const timers: Array<ReturnType<typeof setTimeout>> = [];
    const finish = () => {
      if (done) return;
      done = true;
      for (const timer of timers) clearTimeout(timer);
      try { socket?.send(JSON.stringify({ type: "session.close", event_id: "nordus_preview_close" })); } catch {}
      try { socket?.close(); } catch {}
      release();
    };
    const later = (fn: () => void, ms: number) => {
      const timer = setTimeout(fn, ms);
      timer.unref?.();
      timers.push(timer);
    };
    // The same event the call controller uses to make the voice say something: a commentary append with no delegation.
    const speak = () => {
      if (spoke || done) return;
      spoke = true;
      try {
        socket?.send(JSON.stringify({ type: "session.commentary.append", delegation_id: null, content: VOICE_PREVIEW_TEXT, event_id: "nordus_preview_1" }));
      } catch {
        finish();
      }
    };
    later(finish, deps.sessionCapMs ?? SESSION_CAP_MS);
    try {
      socket = open(liveAttachUrl(sessionId), key);
    } catch {
      finish();
      return;
    }
    socket.onopen = () => {
      // session.started is the browser's media coming up; if it never shows, speak anyway.
      later(speak, deps.speakFallbackMs ?? SPEAK_FALLBACK_MS);
    };
    socket.onerror = finish;
    socket.onclose = finish;
    socket.onmessage = (message) => {
      const raw = message.data;
      const text = typeof raw === "string" ? raw : Buffer.isBuffer(raw) ? raw.toString("utf8") : raw instanceof ArrayBuffer ? Buffer.from(raw).toString("utf8") : "";
      let event: { type?: unknown };
      try { event = JSON.parse(text); } catch { return; }
      if (event.type === "session.started") speak();
      else if (event.type === "session.closed" || event.type === "error") finish();
    };
    if (socket.readyState === SOCKET_OPEN) socket.onopen(undefined);
  }

  return {
    async read(voice) {
      for (const { mime, ext } of TYPES) {
        try {
          return { data: await readFile(fileFor(voice, ext)), mime };
        } catch {}
      }
      return null;
    },

    async save(voice, data, mime) {
      const type = TYPES.find((entry) => entry.mime === mime);
      if (!type) throw new LiveSessionError("That audio type is not accepted.", 415);
      await mkdir(deps.dir, { recursive: true });
      const temp = `${fileFor(voice, type.ext)}.${process.pid}.tmp`;
      await writeFile(temp, data);
      await rename(temp, fileFor(voice, type.ext));
      // One recording per voice: an older one in another format must not win on read.
      await Promise.all(TYPES.filter((entry) => entry.ext !== type.ext).map((entry) => rm(fileFor(voice, entry.ext), { force: true })));
    },

    async start(voice, sdp) {
      const key = deps.key()?.trim();
      if (!key) throw new LiveSessionError(LIVE_NEEDS_KEY, 409);
      if (!sdp.trim() || Buffer.byteLength(sdp) > MAX_SDP_BYTES) throw new LiveSessionError("The connection offer was invalid.", 400);
      if (running.has(voice)) throw new LiveSessionError("This voice sample is already being prepared.", 429);
      running.add(voice);
      let handedOff = false;
      try {
        let response: Response;
        try {
          response = await (deps.fetchImpl ?? fetch)(liveSessionsUrl(), {
            method: "POST",
            headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
            body: JSON.stringify({
              session: {
                model: LIVE_MODEL,
                instructions: "You only read aloud, word for word, the text you are given, in Brazilian Portuguese. You add nothing and you never answer.",
                // Same as a call, whose commentary appends are what the voice reads out.
                delegation: { type: "client" },
                audio: { output: { voice } },
                client: { data_channel: LIVE_DATA_CHANNEL },
              },
              transport: { type: "webrtc", sdp },
            }),
            signal: AbortSignal.timeout(CREATE_TIMEOUT_MS),
          });
        } catch {
          throw new LiveSessionError("Could not reach OpenAI to play the voice sample.", 502);
        }
        if (!response.ok) {
          const failure = await response.json().catch(() => null) as { error?: { param?: unknown } } | null;
          const param = typeof failure?.error?.param === "string" ? failure.error.param : undefined;
          throw new LiveSessionError(liveErrorMessage(response.status, param), response.status === 429 ? 429 : 502);
        }
        const payload = await response.json().catch(() => null) as { session?: { id?: unknown }; transport?: { sdp?: unknown } } | null;
        const sessionId = payload?.session?.id;
        const answer = payload?.transport?.sdp;
        if (typeof sessionId !== "string" || typeof answer !== "string" || !answer.trim()) {
          throw new LiveSessionError("OpenAI returned an unexpected answer for the voice sample.", 502);
        }
        handedOff = true;
        speakOver(sessionId, key, () => running.delete(voice));
        return { sdp: answer };
      } finally {
        if (!handedOff) running.delete(voice);
      }
    },
  };
}
