import { useEffect, useRef } from "react";
import { liveAudioStreams } from "@/lib/live-call-media";

const BARS = 14;

function level(analyser: AnalyserNode | null, buffer: Uint8Array<ArrayBuffer>): number {
  if (!analyser) return 0;
  analyser.getByteTimeDomainData(buffer);
  let sum = 0;
  for (const value of buffer) {
    const centered = (value - 128) / 128;
    sum += centered * centered;
  }
  return Math.min(1, Math.sqrt(sum / buffer.length) * 4);
}

/** Bars that follow whoever is speaking: Nordus orange for the bot, light grey for the person. */
export function VoiceWave({ muted }: { muted: boolean }) {
  const bars = useRef<Array<HTMLSpanElement | null>>([]);
  useEffect(() => {
    const AudioContextClass = globalThis.AudioContext ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    void context.resume().catch(() => undefined);
    const analysers = new Map<string, { node: AnalyserNode; stream: MediaStream }>();
    const buffer = new Uint8Array(256);
    const history = Array.from({ length: BARS }, () => 0.08);
    let frame = 0;
    const analyserFor = (key: string, stream: MediaStream | null) => {
      const current = analysers.get(key);
      if (current?.stream === stream) return current.node;
      current?.node.disconnect();
      analysers.delete(key);
      if (!stream || stream.getAudioTracks().length === 0) return null;
      const node = context.createAnalyser();
      node.fftSize = 256;
      context.createMediaStreamSource(stream).connect(node);
      analysers.set(key, { node, stream });
      return node;
    };
    const tick = () => {
      const { mic, remote } = liveAudioStreams();
      const bot = level(analyserFor("remote", remote), buffer);
      const person = muted ? 0 : level(analyserFor("mic", mic), buffer);
      const speaker = bot >= person ? "bot" : "person";
      history.shift();
      history.push(Math.max(0.08, Math.max(bot, person)));
      bars.current.forEach((bar, index) => {
        if (!bar) return;
        const value = history[index] ?? 0.08;
        bar.style.transform = `scaleY(${value.toFixed(3)})`;
        bar.style.backgroundColor = speaker === "bot" && bot > 0.06 ? "var(--color-accent)" : "var(--color-ink-secondary)";
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      for (const { node } of analysers.values()) node.disconnect();
      void context.close();
    };
  }, [muted]);
  return (
    <span className="flex h-6 w-[88px] items-center justify-between" aria-hidden="true">
      {Array.from({ length: BARS }, (_, index) => (
        <span
          key={index}
          ref={(element) => { bars.current[index] = element; }}
          className="h-full w-[3px] origin-center rounded-full bg-ink-secondary transition-[transform,background-color] duration-75"
          style={{ transform: "scaleY(0.08)" }}
        />
      ))}
    </span>
  );
}
