// No playback during a Live call: the call's microphone would pick the note up.
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { LoaderCircle, Pause, Play } from "lucide-react";

import { attachmentAudioUrl } from "@/lib/composer-attachments";
import { t } from "@/lib/i18n";
import { isLiveCallRunning, useLiveMedia } from "@/lib/live-call-media";
import { speaker } from "@/lib/tts";
import { cn } from "@/lib/cn";

export interface VoiceNoteAttachment {
  kind: "audio";
  path: string;
  mime: string;
  durationMs?: number;
}

const BARS = 52;
const SPEEDS = [1, 1.5, 2] as const;
const peaksCache = new Map<string, Promise<number[]>>();

export function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

function flatPeaks(): number[] {
  return Array.from({ length: BARS }, (_, index) => 0.25 + 0.2 * Math.abs(Math.sin(index * 1.7)));
}

/** Past this a file is not decoded for its waveform: decoded audio is many times the file, more than a phone holds. */
const PEAKS_MAX_BYTES = 8 * 1024 * 1024;
/** Decoded at a low rate: loudness needs no more, and it keeps a long track's samples small. */
const PEAKS_SAMPLE_RATE = 22_050;

/** Loudness of BARS slices of the clip, 0 to 1, decoded once per clip. A long track reads one sample in `stride`, so
 *  three minutes of music cost no more than a short note. */
export function peaksFor(url: string, key: string): Promise<number[]> {
  const cached = peaksCache.get(key);
  if (cached) return cached;
  const job = (async () => {
    const Offline = globalThis.OfflineAudioContext as typeof OfflineAudioContext | undefined;
    const AudioContextClass = globalThis.AudioContext ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Offline && !AudioContextClass) return flatPeaks();
    const bytes = await fetch(url).then((res) => res.arrayBuffer());
    if (bytes.byteLength > PEAKS_MAX_BYTES) return flatPeaks();
    const context = Offline ? new Offline(1, 1, PEAKS_SAMPLE_RATE) : new AudioContextClass!();
    try {
      const audio = await context.decodeAudioData(bytes);
      const data = audio.getChannelData(0);
      const size = Math.max(1, Math.floor(data.length / BARS));
      const stride = Math.max(1, Math.floor(size / 2_000));
      const peaks = Array.from({ length: BARS }, (_, bar) => {
        let sum = 0;
        let count = 0;
        for (let i = bar * size; i < Math.min(data.length, (bar + 1) * size); i += stride) { sum += data[i]! * data[i]!; count += 1; }
        return Math.sqrt(sum / Math.max(1, count));
      });
      // Stretched between the 10th and 90th percentiles, not silence and the loudest slice: one pop must not flatten
      // speech into a line, and dense music, never silent, must not fill every bar to the top.
      const sorted = [...peaks].sort((x, y) => x - y);
      const quiet = sorted[Math.floor(sorted.length * 0.1)] ?? 0;
      const loud = Math.max(sorted[Math.floor(sorted.length * 0.9)] ?? 0, quiet + 0.0001);
      return peaks.map((peak) => Math.max(0.08, Math.min(1, Math.max(0, (peak - quiet) / (loud - quiet)) ** 0.7)));
    } finally {
      if (!Offline) void (context as AudioContext).close();
    }
  })().catch(() => flatPeaks());
  peaksCache.set(key, job);
  return job;
}

export interface WavePlayerLabels {
  play: string;
  pause: string;
  seek: string;
  onLiveCall: string;
}

/** The voice note's player: a waveform read from the file, seeking on it, the clock and, for a note, its speed. Without
 *  `src` yet, play asks `onNeedSource` for it and starts once it arrives. One player sounds at a time. */
export function WavePlayer({
  src,
  cacheKey,
  durationMs,
  labels,
  tone,
  showTotal = false,
  showSpeed = true,
  loading = false,
  onNeedSource,
  onError,
}: {
  src: string | null;
  cacheKey: string;
  durationMs?: number;
  labels: WavePlayerLabels;
  tone: "user" | "bot" | "plain";
  showTotal?: boolean;
  showSpeed?: boolean;
  loading?: boolean;
  onNeedSource?: () => void;
  onError?: () => void;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const releaseRef = useRef<(() => void) | null>(null);
  const wantsPlay = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [peaks, setPeaks] = useState<number[]>(flatPeaks);
  const [duration, setDuration] = useState<number | null>(
    typeof durationMs === "number" && durationMs > 0 ? durationMs / 1000 : null,
  );
  const [time, setTime] = useState(0);
  const onLiveCall = isLiveCallRunning(useLiveMedia().phase);

  useEffect(() => () => releaseRef.current?.(), []);
  useEffect(() => {
    if (!src) return;
    let alive = true;
    void peaksFor(src, cacheKey).then((next) => { if (alive) setPeaks(next); });
    return () => { alive = false; };
  }, [src, cacheKey]);

  const giveBackVoice = (release?: () => void) => {
    if (release && releaseRef.current !== release) return;
    releaseRef.current?.();
    releaseRef.current = null;
  };

  const start = (audio: HTMLAudioElement) => {
    if (onLiveCall) return;
    // Claim before play: the Speaker's stop() silences call mode and any other note first.
    releaseRef.current?.();
    const release = speaker.claimExternalVoice(() => audio.pause());
    releaseRef.current = release;
    audio.playbackRate = speed;
    // A refused play() never fires pause, so the claim comes back here, if this attempt's claim is still the active
    // one.
    void audio.play().catch(() => giveBackVoice(release));
  };

  useEffect(() => {
    if (!src || !wantsPlay.current || !audioRef.current) return;
    wantsPlay.current = false;
    start(audioRef.current);
  }, [src]);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) {
      wantsPlay.current = true;
      onNeedSource?.();
      return;
    }
    // The element's paused state, not the flag: play events are queued, so a second click before onPlay must still
    // pause.
    if (!audio.paused) {
      audio.pause();
      return;
    }
    start(audio);
  };

  const seekAt = (event: ReactPointerEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const next = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * duration;
    audio.currentTime = next;
    setTime(next);
  };

  const nextSpeed = () => {
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]!;
    setSpeed(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  };

  const progress = duration ? Math.min(1, time / duration) : 0;
  const shown = playing || time > 0 ? time : duration ?? 0;

  return (
    <div className={cn("flex items-center gap-2.5 rounded-2xl py-1.5 pl-2 pr-2.5", tone === "user" ? "bg-bubble-user" : tone === "bot" ? "bg-card" : "")}>
      {src && (
        <audio
          ref={audioRef}
          src={src}
          preload="metadata"
          onLoadedMetadata={(event) => {
            const loaded = event.currentTarget.duration;
            if (Number.isFinite(loaded) && loaded > 0) setDuration(loaded);
          }}
          onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
          onPlay={() => setPlaying(true)}
          onPause={(event) => {
            // A queued pause can land after playback already resumed.
            if (!event.currentTarget.paused) return;
            setPlaying(false);
            giveBackVoice();
          }}
          onEnded={() => {
            setPlaying(false);
            setTime(0);
            giveBackVoice();
          }}
          onError={onError}
        />
      )}
      <button
        type="button"
        onClick={toggle}
        disabled={(onLiveCall && !playing) || loading}
        aria-label={playing ? labels.pause : onLiveCall ? labels.onLiveCall : labels.play}
        title={playing ? labels.pause : onLiveCall ? labels.onLiveCall : labels.play}
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-40",
          playing ? "bg-accent text-white" : "bg-ink/10 text-ink hover:bg-ink/15",
          loading && "disabled:cursor-wait disabled:opacity-100",
        )}
      >
        {loading ? <LoaderCircle size={15} className="animate-spin" />
          : playing ? <Pause size={15} className="fill-current" /> : <Play size={15} className="translate-x-px fill-current" />}
      </button>
      <div className="min-w-0 flex-1">
        <div
          role="slider"
          tabIndex={0}
          aria-label={labels.seek}
          aria-valuemin={0}
          aria-valuemax={Math.round(duration ?? 0)}
          aria-valuenow={Math.round(time)}
          onPointerDown={seekAt}
          onKeyDown={(event) => {
            const audio = audioRef.current;
            if (!audio || !duration) return;
            if (event.key === "ArrowRight") audio.currentTime = Math.min(duration, audio.currentTime + 5);
            if (event.key === "ArrowLeft") audio.currentTime = Math.max(0, audio.currentTime - 5);
          }}
          className="flex h-6 cursor-pointer items-center justify-between focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          {peaks.map((peak, index) => (
            <span
              key={index}
              className={cn(
                "w-[2px] shrink-0 rounded-full",
                (index + 0.5) / peaks.length <= progress ? (playing ? "bg-accent" : "bg-ink") : "bg-ink/30",
              )}
              style={{ height: `${Math.round(peak * 100)}%`, minHeight: 2 }}
            />
          ))}
        </div>
        <div className="flex items-center justify-between text-[11px] leading-[14px] font-medium tabular-nums text-ink-tertiary">
          <span>{showTotal ? clock(time) : clock(shown)}</span>
          {showTotal && duration ? <span>{clock(duration)}</span> : null}
        </div>
      </div>
      {showSpeed && (
        <button
          type="button"
          onClick={nextSpeed}
          aria-label={t("chat.voiceNote.speed", { speed: String(speed).replace(".", ",") })}
          title={t("chat.voiceNote.speed", { speed: String(speed).replace(".", ",") })}
          className={cn(
            "shrink-0 rounded-[8px] px-1.5 py-0.5 text-[11px] font-semibold tabular-nums transition-colors",
            speed === 1 ? "bg-white/[0.06] text-ink-secondary hover:text-ink" : "bg-accent/15 text-accent-text",
          )}
        >
          {`${String(speed).replace(".", ",")}x`}
        </button>
      )}
    </div>
  );
}

export function VoiceNoteBubble({
  attachment,
  transcript,
  className,
  from = "bot",
}: {
  attachment: VoiceNoteAttachment;
  transcript?: string;
  className?: string;
  /** Who sent it: the user's note wears their bubble colour, a bot's the bot card. */
  from?: "user" | "bot";
}) {
  const url = attachmentAudioUrl(attachment.path);
  const pressRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showText, setShowText] = useState(false);
  if (!url) return null;

  return (
    <div
      className={cn("group/voice relative flex w-[290px] max-w-full flex-col", className)}
      data-test-voice-note=""
      onTouchStart={transcript ? () => { pressRef.current = setTimeout(() => setShowText((value) => !value), 500); } : undefined}
      onTouchEnd={() => { if (pressRef.current) clearTimeout(pressRef.current); }}
      onTouchMove={() => { if (pressRef.current) clearTimeout(pressRef.current); }}
    >
      <WavePlayer
        src={url}
        cacheKey={url}
        durationMs={attachment.durationMs}
        tone={from}
        labels={{ play: t("chat.voiceNote.play"), pause: t("chat.voiceNote.pause"), seek: t("chat.voiceNote.seek"), onLiveCall: t("chat.voiceNote.onLiveCall") }}
      />
      {transcript && (
        <p
          data-voice-transcript=""
          style={{ background: "var(--color-menu)" }}
          className={cn(
            "pointer-events-none absolute right-0 top-full z-20 mt-1 w-full rounded-[10px] border border-white/10 px-2.5 py-1.5 text-[11px] leading-snug text-ink-secondary shadow-[0_12px_30px_-14px_rgba(0,0,0,0.7)]",
            showText ? "block" : "hidden group-hover/voice:block",
          )}
        >
          {transcript}
        </p>
      )}
    </div>
  );
}
