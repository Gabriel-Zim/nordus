import { useSyncExternalStore } from "react";
import { DEFAULT_ACCENT, MONO_ACCENT, readAccent } from "./accent-color";

/** The warm glow behind the chat, after the native app's window material: a
 * big soft light from the right and a faint one from the lower left, over a
 * near-black ground, plus a still grain. Painted by CSS layers only: no blur,
 * no animation, nothing per frame. */
export const BACKGROUND_TONES = [
  {
    id: "accent",
    glow1: "color-mix(in srgb, color-mix(in oklch, var(--color-accent) 48%, #262626) 40%, transparent)",
    glow2: "color-mix(in srgb, color-mix(in oklch, var(--color-accent) 34%, #1e1e1e) 20%, transparent)",
  },
  { id: "amber", glow1: "rgb(120 72 44 / 0.38)", glow2: "rgb(70 50 36 / 0.18)" },
  { id: "copper", glow1: "rgb(150 82 52 / 0.38)", glow2: "rgb(90 50 40 / 0.18)" },
  { id: "graphite", glow1: "rgb(112 112 112 / 0.30)", glow2: "rgb(72 72 72 / 0.14)" },
  { id: "midnight", glow1: "rgb(48 80 140 / 0.38)", glow2: "rgb(30 50 90 / 0.18)" },
  { id: "moss", glow1: "rgb(70 100 56 / 0.38)", glow2: "rgb(44 64 40 / 0.18)" },
  { id: "plain", glow1: "transparent", glow2: "transparent" },
] as const;

export type BackgroundToneId = (typeof BACKGROUND_TONES)[number]["id"];

export const DEFAULT_TONE: BackgroundToneId = "amber";
export const DEFAULT_STRENGTH = 100;

const TONE_KEY = "nordus-bg-tone";
const STRENGTH_KEY = "nordus-bg-strength";

const listeners = new Set<() => void>();
let tone: BackgroundToneId | null = null;
let strength = DEFAULT_STRENGTH;

function storage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function isToneId(value: unknown): value is BackgroundToneId {
  return BACKGROUND_TONES.some((entry) => entry.id === value);
}

export function clampStrength(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : DEFAULT_STRENGTH;
}

/** What the person chose; `null` means "never chose", so the accent decides (orange: amber, no colour: graphite, any other: that colour). */
export function readBackgroundTone(): { tone: BackgroundToneId | null; strength: number } {
  try {
    const stored = storage()?.getItem(TONE_KEY);
    const level = storage()?.getItem(STRENGTH_KEY);
    return { tone: isToneId(stored) ? stored : null, strength: level === null || level === undefined ? DEFAULT_STRENGTH : clampStrength(level) };
  } catch {
    return { tone: null, strength: DEFAULT_STRENGTH };
  }
}

/** The tone in force: the chosen one, or the default that goes with the accent. */
export function effectiveTone(chosen: BackgroundToneId | null = tone, accent: string | null = readAccent()): BackgroundToneId {
  if (chosen) return chosen;
  if (accent === MONO_ACCENT) return "graphite";
  return accent === null || accent === DEFAULT_ACCENT ? DEFAULT_TONE : "accent";
}

function paint(): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const entry = BACKGROUND_TONES.find((candidate) => candidate.id === effectiveTone()) ?? BACKGROUND_TONES[0];
  root.style.setProperty("--bg-glow-1", entry.glow1);
  root.style.setProperty("--bg-glow-2", entry.glow2);
  root.style.setProperty("--bg-glow-strength", String(strength / 100));
  if (entry.id === "plain") root.style.setProperty("--bg-grain", "none");
  else root.style.removeProperty("--bg-grain");
  root.dataset.bgTone = entry.id;
}

/** Paints and, when asked, saves the tone and its strength (0 to 100). Called before the first paint, and after the accent changes. */
export function applyBackgroundTone(next?: { tone?: BackgroundToneId | null; strength?: number }): void {
  if (next) {
    if (next.tone !== undefined) tone = next.tone;
    if (next.strength !== undefined) strength = clampStrength(next.strength);
    try {
      if (tone) storage()?.setItem(TONE_KEY, tone);
      else storage()?.removeItem(TONE_KEY);
      storage()?.setItem(STRENGTH_KEY, String(strength));
    } catch {
    }
  } else {
    const read = readBackgroundTone();
    tone = read.tone;
    strength = read.strength;
  }
  paint();
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

let snapshot = "";
function current(): string {
  const next = `${effectiveTone()}:${strength}`;
  snapshot = next;
  return snapshot;
}

/** The tone and strength in force, for the settings control. */
export function useBackgroundTone(): { tone: BackgroundToneId; strength: number } {
  const key = useSyncExternalStore(subscribe, current, current);
  const [id, level] = key.split(":");
  return { tone: id as BackgroundToneId, strength: Number(level) };
}
