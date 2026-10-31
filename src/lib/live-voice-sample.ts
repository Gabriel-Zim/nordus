// The sample of a GPT-Live voice. The first listen goes through the browser: the live API takes only WebRTC, so this
// connects receive-only (no microphone), plays the voice live, records it and hands the recording to the server, which
// keeps it. Every later listen is a plain download.
import { iceGathered } from "./live-call-media";
import { t } from "./i18n";

const MAX_RECORD_MS = 12_000;
const SILENCE_MS = 1_500;
const SPEECH_LEVEL = 0.015;
const POLL_MS = 50;
const ICE_TIMEOUT_MS = 10_000;
const ACCEPTED = ["audio/webm", "audio/ogg", "audio/mp4"];
const RECORDER_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];

export interface VoiceSampleHooks {
  signal: AbortSignal;
  /** Called when sound starts, so the button can leave its loading state. */
  onPlaying(): void;
}

function failure(body: unknown): Error {
  const message = (body as { error?: unknown } | null)?.error;
  return new Error(typeof message === "string" ? message : t("call.live.voiceSampleFailed"));
}

const base = (voice: string) => `/api/live/voice-preview/${encodeURIComponent(voice)}`;

/** Resolves when the sample has played (or `signal` aborted); rejects with a message fit for the user. */
export async function playVoiceSample(voice: string, hooks: VoiceSampleHooks): Promise<void> {
  const response = await fetch(base(voice), { signal: hooks.signal });
  if (response.ok) return playBlob(await response.blob(), hooks);
  const body = await response.json().catch(() => null) as { missing?: unknown } | null;
  if (response.status === 404 && body?.missing === true) return recordLive(voice, hooks);
  throw failure(body);
}

async function playBlob(blob: Blob, hooks: VoiceSampleHooks): Promise<void> {
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  try {
    await new Promise<void>((resolve, reject) => {
      const stop = () => resolve();
      hooks.signal.addEventListener("abort", stop, { once: true });
      audio.onended = stop;
      audio.onerror = () => reject(new Error(t("call.live.voiceSampleFailed")));
      audio.play().then(() => { if (!hooks.signal.aborted) hooks.onPlaying(); }, reject);
    });
  } finally {
    audio.pause();
    URL.revokeObjectURL(url);
  }
}

async function recordLive(voice: string, hooks: VoiceSampleHooks): Promise<void> {
  if (typeof RTCPeerConnection === "undefined" || typeof MediaRecorder === "undefined") throw new Error(t("call.live.unsupported"));
  const connection = new RTCPeerConnection();
  const audio = Object.assign(document.createElement("audio"), { autoplay: true });
  let context: AudioContext | null = null;
  let poll: ReturnType<typeof setInterval> | null = null;
  let cap: ReturnType<typeof setTimeout> | null = null;
  try {
    // Receive only: nothing asks for the microphone. The channel exists because the session expects the client's.
    connection.addTransceiver("audio", { direction: "recvonly" });
    connection.createDataChannel("oai-events");
    const stream = new Promise<MediaStream>((resolve) => {
      connection.ontrack = (event) => resolve(event.streams[0] ?? new MediaStream([event.track]));
    });
    await connection.setLocalDescription(await connection.createOffer());
    await iceGathered(connection, ICE_TIMEOUT_MS);
    const sdp = connection.localDescription?.sdp;
    if (!sdp) throw new Error(t("call.live.noOffer"));
    if (hooks.signal.aborted) return;

    const answer = await fetch(`${base(voice)}/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sdp }),
      signal: AbortSignal.any([hooks.signal, AbortSignal.timeout(35_000)]),
    });
    const payload = await answer.json().catch(() => null) as { transport?: { sdp?: unknown } } | null;
    if (!answer.ok || typeof payload?.transport?.sdp !== "string") throw failure(payload);
    await connection.setRemoteDescription({ type: "answer", sdp: payload.transport.sdp });

    let waitTimer: ReturnType<typeof setTimeout> | undefined;
    const remote = await Promise.race([
      stream,
      new Promise<never>((_, reject) => {
        waitTimer = setTimeout(() => reject(new Error(t("call.live.droppedNoAudio"))), 20_000);
        hooks.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      }),
    ]).finally(() => clearTimeout(waitTimer));
    if (hooks.signal.aborted) return;
    audio.srcObject = remote;
    await audio.play().catch(() => undefined);

    const mimeType = RECORDER_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
    const recorder = new MediaRecorder(remote, mimeType ? { mimeType } : undefined);
    const parts: Blob[] = [];
    recorder.ondataavailable = (event) => { if (event.data.size) parts.push(event.data); };
    const stopped = new Promise<void>((resolve) => { recorder.onstop = () => resolve(); });

    context = new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    context.createMediaStreamSource(remote).connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    let spoke = false;
    let quietSince = 0;
    const finished = new Promise<void>((resolve) => {
      hooks.signal.addEventListener("abort", () => resolve(), { once: true });
      cap = setTimeout(resolve, MAX_RECORD_MS);
      poll = setInterval(() => {
        analyser.getFloatTimeDomainData(samples);
        let sum = 0;
        for (const value of samples) sum += value * value;
        const now = Date.now();
        if (Math.sqrt(sum / samples.length) > SPEECH_LEVEL) {
          if (!spoke) hooks.onPlaying();
          spoke = true;
          quietSince = 0;
        } else if (spoke) {
          quietSince ||= now;
          if (now - quietSince >= SILENCE_MS) resolve();
        }
      }, POLL_MS);
    });
    recorder.start();
    await finished;
    if (poll) clearInterval(poll);
    if (recorder.state !== "inactive") recorder.stop();
    await stopped;
    if (hooks.signal.aborted) return;
    if (!spoke) throw new Error(t("call.live.voiceSampleFailed"));
    const type = (recorder.mimeType || mimeType || "").split(";")[0]!.toLowerCase();
    if (!ACCEPTED.includes(type)) return;
    // Playing it live was the listen; failing to keep it only means the next listen records again.
    await fetch(base(voice), { method: "PUT", headers: { "content-type": type }, body: new Blob(parts, { type }) }).catch(() => undefined);
  } catch (error) {
    if (hooks.signal.aborted) return;
    throw error;
  } finally {
    if (poll) clearInterval(poll);
    if (cap) clearTimeout(cap);
    audio.srcObject = null;
    void context?.close().catch(() => undefined);
    connection.close();
  }
}
