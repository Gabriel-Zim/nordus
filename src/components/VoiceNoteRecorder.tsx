import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { LoaderCircle, Mic, Pause, Play, SendHorizontal, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";

type Phase = "idle" | "recording" | "paused" | "sending";

// Like the WhatsApp recorder: one thin bar per STEP_MS of recording, new bars enter on the right and the wave scrolls
// left, the empty space before the first bar is a row of dots.
const STEP_MS = 55;
const BAR = 2;
const PITCH = 3.5;

function pickMime(): string {
  const candidates = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4", "audio/webm"];
  return candidates.find((type) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type)) ?? "";
}

function clock(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function reducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Microphone loudness, 0 to 1, shaped so normal speech fills most of the height and silence stays a dot. */
export function loudness(buffer: Uint8Array): number {
  let sum = 0;
  for (const value of buffer) sum += ((value - 128) / 128) ** 2;
  const rms = Math.sqrt(sum / buffer.length);
  return rms < 0.004 ? 0 : Math.min(1, (rms * 5) ** 0.75);
}

/** The whole recording squeezed (loudest of each slice) or stretched (interpolated) to `count` bars. */
export function fitLevels(samples: number[], count: number): number[] {
  const n = samples.length;
  if (!n || count <= 0) return [];
  if (n < count) {
    return Array.from({ length: count }, (_, i) => {
      const at = n === 1 ? 0 : (i * (n - 1)) / (count - 1);
      const low = Math.floor(at);
      const high = Math.min(n - 1, low + 1);
      return samples[low]! + (samples[high]! - samples[low]!) * (at - low);
    });
  }
  return Array.from({ length: count }, (_, i) => {
    const from = Math.floor((i * n) / count);
    const to = Math.max(from + 1, Math.floor(((i + 1) * n) / count));
    let peak = 0;
    for (let j = from; j < to; j++) peak = Math.max(peak, samples[j]!);
    return peak;
  });
}

export interface VoiceRecording {
  blob: Blob;
  mime: string;
  durationMs: number;
}

/** Tap the microphone to record a voice note; pause to listen back, the trash drops it, the plane hands it to the outbox. */
export function VoiceNoteRecorder({ onRecorded, onError, disabled }: {
  onRecorded: (recording: VoiceRecording) => Promise<void>;
  onError: (message: string) => void;
  disabled?: boolean;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [shownMs, setShownMs] = useState(0);
  const [listening, setListening] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const waiters = useRef<(() => void)[]>([]);
  const stream = useRef<MediaStream | null>(null);
  const context = useRef<AudioContext | null>(null);
  const analyser = useRef<AnalyserNode | null>(null);
  const buffer = useRef<Uint8Array<ArrayBuffer>>(new Uint8Array(512));
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const dot = useRef<HTMLSpanElement | null>(null);
  const frame = useRef(0);
  const keep = useRef(false);
  const still = useRef(false);
  // Recording time without the pauses: what came before the current stretch, and when the current stretch began.
  const before = useRef(0);
  const since = useRef(0);
  const active = useRef(0);
  const samples = useRef<number[]>([]);
  const pending = useRef(0);
  const lastBar = useRef(0);
  const second = useRef(-1);
  const mode = useRef<"live" | "review">("live");
  const preview = useRef<HTMLAudioElement | null>(null);
  const previewUrl = useRef<{ url: string; parts: number } | null>(null);
  const previewMs = useRef(0);
  const hearing = useRef(false);
  const hear = (on: boolean) => {
    hearing.current = on;
    setListening(on);
  };

  const draw = () => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    const ratio = globalThis.devicePixelRatio || 1;
    const width = el.clientWidth;
    const height = el.clientHeight;
    if (!width || !height) return;
    if (el.width !== Math.round(width * ratio) || el.height !== Math.round(height * ratio)) {
      el.width = Math.round(width * ratio);
      el.height = Math.round(height * ratio);
    }
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const style = getComputedStyle(el);
    const ink = style.color;
    const bar = (x: number, level: number, alpha: number, color = ink) => {
      const h = Math.max(2, Math.min(1, level) * height);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      ctx.beginPath();
      if (typeof ctx.roundRect === "function") ctx.roundRect(x, (height - h) / 2, BAR, h, 1);
      else ctx.rect(x, (height - h) / 2, BAR, h);
      ctx.fill();
    };
    const levels = samples.current;
    if (mode.current === "live") {
      const n = levels.length;
      const shift = still.current ? 0 : Math.min(1, (active.current - lastBar.current) / STEP_MS) * PITCH;
      if (!still.current) bar(width - shift, pending.current, 0.95);
      let x = width;
      for (let i = n - 1; i >= 0; i--) {
        const age = n - i;
        x = width - age * PITCH - shift;
        if (x < -BAR) break;
        bar(x, levels[i]!, age < 16 ? 0.95 - age * 0.022 : 0.6);
      }
      for (x -= PITCH; x > -BAR; x -= PITCH) bar(x, 0, 0.32);
    } else {
      const fitted = fitLevels(levels, Math.max(1, Math.floor((width + PITCH - BAR) / PITCH)));
      const total = active.current || 1;
      const progress = Math.min(1, previewMs.current / total);
      const accent = style.getPropertyValue("--color-accent").trim() || "#FF6633";
      fitted.forEach((level, i) => {
        const played = (i + 0.5) / fitted.length <= progress && progress > 0;
        bar(i * PITCH, level, played ? 1 : 0.38, played && hearing.current ? accent : ink);
      });
    }
    ctx.globalAlpha = 1;
  };

  const tick = (now: number) => {
    if (mode.current === "live") {
      const elapsed = before.current + now - since.current;
      active.current = elapsed;
      if (analyser.current) {
        analyser.current.getByteTimeDomainData(buffer.current);
        pending.current = Math.max(pending.current, loudness(buffer.current));
      }
      while (elapsed - lastBar.current >= STEP_MS) {
        samples.current.push(pending.current);
        pending.current = 0;
        lastBar.current += STEP_MS;
      }
      const whole = Math.floor(elapsed / 1000);
      if (whole !== second.current) {
        second.current = whole;
        setShownMs(whole * 1000);
      }
    } else if (preview.current) {
      previewMs.current = preview.current.currentTime * 1000;
      const whole = Math.floor(previewMs.current / 1000);
      if (whole !== second.current) {
        second.current = whole;
        setShownMs(whole * 1000);
      }
    }
    draw();
    frame.current = requestAnimationFrame(tick);
  };

  const loop = (on: boolean) => {
    cancelAnimationFrame(frame.current);
    if (on) frame.current = requestAnimationFrame(tick);
  };

  const dropPreview = () => {
    preview.current?.pause();
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current.url);
    previewUrl.current = null;
    preview.current = null;
    previewMs.current = 0;
    hear(false);
  };

  const stopMeters = () => {
    loop(false);
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    analyser.current = null;
    void context.current?.close().catch(() => undefined);
    context.current = null;
  };

  useEffect(() => () => {
    keep.current = false;
    if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop();
    stopMeters();
    dropPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Slow blink of the red dot while recording, none with reduced motion.
  useEffect(() => {
    const el = dot.current;
    if (phase !== "recording" || !el || still.current || typeof el.animate !== "function") return;
    const blink = el.animate([{ opacity: 1 }, { opacity: 0.2 }, { opacity: 1 }], { duration: 1600, iterations: Infinity, easing: "ease-in-out" });
    return () => blink.cancel();
  }, [phase]);

  // Redraw when the canvas changes size or the view changes (paused, listening).
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    draw();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => draw());
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, listening]);

  const start = async () => {
    if (phase !== "idle" || disabled) return;
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      stream.current = media;
      const mime = pickMime();
      const rec = new MediaRecorder(media, mime ? { mimeType: mime } : undefined);
      chunks.current = [];
      rec.ondataavailable = (event) => {
        if (event.data.size) chunks.current.push(event.data);
        const ready = waiters.current.splice(0);
        ready.forEach((resolve) => resolve());
      };
      rec.onstop = () => { void finish(rec.mimeType || mime || "audio/webm"); };
      recorder.current = rec;
      rec.start(250);
      still.current = reducedMotion();
      samples.current = [];
      pending.current = 0;
      lastBar.current = 0;
      before.current = 0;
      active.current = 0;
      second.current = -1;
      since.current = performance.now();
      mode.current = "live";
      setShownMs(0);
      setPhase("recording");
      const AudioContextClass = globalThis.AudioContext;
      if (AudioContextClass) {
        const audio = new AudioContextClass();
        context.current = audio;
        const node = audio.createAnalyser();
        node.fftSize = 512;
        audio.createMediaStreamSource(media).connect(node);
        analyser.current = node;
      }
      loop(true);
    } catch {
      stopMeters();
      onError(t("composer.voiceNote.micBlocked"));
    }
  };

  const finish = async (mime: string) => {
    const durationMs = active.current;
    stopMeters();
    dropPreview();
    if (!keep.current) {
      setPhase("idle");
      return;
    }
    keep.current = false;
    const blob = new Blob(chunks.current, { type: mime });
    if (blob.size === 0 || durationMs < 600) {
      setPhase("idle");
      return;
    }
    setPhase("sending");
    try {
      await onRecorded({ blob, mime, durationMs: Math.round(durationMs) });
    } finally {
      setPhase("idle");
    }
  };

  const stop = (send: boolean) => {
    keep.current = send;
    const rec = recorder.current;
    if (mode.current === "live" && phase === "recording") active.current = before.current + performance.now() - since.current;
    if (rec && rec.state !== "inactive") rec.stop();
    else setPhase("idle");
  };

  const pause = () => {
    const rec = recorder.current;
    if (phase !== "recording" || !rec || rec.state !== "recording") return;
    rec.pause();
    before.current += performance.now() - since.current;
    active.current = before.current;
    loop(false);
    mode.current = "review";
    previewMs.current = 0;
    second.current = Math.floor(active.current / 1000);
    setShownMs(active.current);
    setPhase("paused");
  };

  const resume = () => {
    const rec = recorder.current;
    if (phase !== "paused" || !rec || rec.state !== "paused") return;
    dropPreview();
    rec.resume();
    since.current = performance.now();
    mode.current = "live";
    second.current = -1;
    setPhase("recording");
    loop(true);
  };

  /** Everything recorded so far, as a playable clip. */
  const snapshot = async (): Promise<string> => {
    const rec = recorder.current;
    if (rec && rec.state === "paused") {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 500);
        waiters.current.push(() => { clearTimeout(timer); resolve(); });
        rec.requestData();
      });
    }
    if (previewUrl.current?.parts === chunks.current.length) return previewUrl.current.url;
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current.url);
    const url = URL.createObjectURL(new Blob(chunks.current, { type: rec?.mimeType || "audio/webm" }));
    previewUrl.current = { url, parts: chunks.current.length };
    return url;
  };

  const listen = async () => {
    if (phase !== "paused") return;
    const playing = preview.current;
    if (playing && !playing.paused) {
      playing.pause();
      return;
    }
    const url = await snapshot();
    let audio = preview.current;
    if (!audio || audio.src !== url) {
      audio?.pause();
      audio = new Audio(url);
      audio.onplay = () => { hear(true); loop(true); };
      audio.onpause = () => {
        hear(false);
        loop(false);
        draw();
      };
      audio.onended = () => {
        previewMs.current = 0;
        second.current = Math.floor(active.current / 1000);
        setShownMs(active.current);
        hear(false);
        loop(false);
        draw();
      };
      preview.current = audio;
      if (previewMs.current > 0) audio.currentTime = previewMs.current / 1000;
    }
    second.current = -1;
    void audio.play().catch(() => hear(false));
  };

  const seek = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (phase !== "paused" || !active.current) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const at = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * active.current;
    previewMs.current = at;
    if (preview.current) preview.current.currentTime = at / 1000;
    second.current = Math.floor(at / 1000);
    setShownMs(at);
    draw();
  };

  if (phase === "idle") {
    return (
      <button
        type="button"
        onClick={() => void start()}
        disabled={disabled}
        aria-label={t("composer.voiceNote.record")}
        title={t("composer.voiceNote.record")}
        data-voice-note-record=""
        className="flex size-8 shrink-0 items-center justify-center rounded-full text-ink-secondary hover:bg-raised hover:text-ink disabled:opacity-40"
      >
        <Mic size={18} />
      </button>
    );
  }

  const sending = phase === "sending";
  const paused = phase === "paused";

  return (
    <div
      role="group"
      aria-label={t("composer.voiceNote.recording")}
      data-voice-note-recorder={phase}
      className="absolute inset-0 z-10 flex items-center gap-1 rounded-3xl bg-composer px-1.5"
    >
      <button
        type="button"
        onClick={() => stop(false)}
        disabled={sending}
        aria-label={t("composer.voiceNote.discard")}
        title={t("composer.voiceNote.discard")}
        className="flex size-8 shrink-0 items-center justify-center rounded-full text-ink-secondary transition-colors hover:bg-raised hover:text-danger disabled:opacity-40"
      >
        <Trash2 size={18} />
      </button>
      <div
        data-voice-note-pill=""
        className="flex h-8 min-w-0 flex-1 items-center gap-2.5 rounded-full bg-white/[0.06] pl-3 pr-3.5"
      >
        {paused ? (
          <button
            type="button"
            onClick={() => void listen()}
            aria-label={listening ? t("composer.voiceNote.previewPause") : t("composer.voiceNote.preview")}
            title={listening ? t("composer.voiceNote.previewPause") : t("composer.voiceNote.preview")}
            className="-ml-1.5 flex size-6 shrink-0 items-center justify-center rounded-full text-ink transition-colors hover:bg-white/10"
          >
            {listening ? <Pause size={15} className="fill-current" /> : <Play size={15} className="translate-x-px fill-current" />}
          </button>
        ) : (
          <span ref={dot} className="size-2.5 shrink-0 rounded-full bg-danger" aria-hidden="true" />
        )}
        <span className="min-w-[2.25rem] shrink-0 text-[13px] font-medium tabular-nums text-ink/90" aria-live="off">
          {clock(shownMs)}
        </span>
        <canvas
          ref={canvas}
          onPointerDown={paused ? seek : undefined}
          aria-hidden="true"
          className={cn("h-6 min-w-0 flex-1 text-ink", paused && "cursor-pointer")}
        />
      </div>
      {sending ? (
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-white" aria-label={t("composer.voiceNote.sending")} role="status">
          <LoaderCircle size={16} className="animate-spin motion-reduce:animate-none" />
        </span>
      ) : (
        <>
          <button
            type="button"
            onClick={paused ? resume : pause}
            aria-label={paused ? t("composer.voiceNote.resume") : t("composer.voiceNote.pause")}
            title={paused ? t("composer.voiceNote.resume") : t("composer.voiceNote.pause")}
            data-voice-note-pause={paused ? "resume" : "pause"}
            className="flex size-8 shrink-0 items-center justify-center rounded-full text-danger transition-colors hover:bg-raised"
          >
            {paused ? <Mic size={18} /> : <Pause size={17} className="fill-current" />}
          </button>
          <button
            type="button"
            onClick={() => stop(true)}
            aria-label={t("composer.voiceNote.send")}
            title={t("composer.voiceNote.send")}
            data-voice-note-send=""
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-white transition-[filter] hover:brightness-110"
          >
            <SendHorizontal size={16} className="translate-x-px" />
          </button>
        </>
      )}
    </div>
  );
}
