import { useSyncExternalStore } from "react";
import { contrastRatio, fromOklch, mixSrgb, relativeLuminance, toOklch, toneForSurface } from "./color-contrast";

/** The person's own accent: buttons, active states, links, the focus ring and
 * the glows behind the chat. Unread blue, error red and online green are
 * separate tokens and never follow it. `null` keeps the skin's own accent. */
export const ACCENT_PRESETS = [
  { id: "orange", hex: "#ff6633" },
  { id: "blue", hex: "#3b82f6" },
  { id: "green", hex: "#22c55e" },
  { id: "purple", hex: "#8b5cf6" },
  { id: "pink", hex: "#ec4899" },
  { id: "yellow", hex: "#facc15" },
] as const;

export const DEFAULT_ACCENT = ACCENT_PRESETS[0].hex;

/** "No colour": black, grey and white only. Stored as this word, not as a hex. */
export const MONO_ACCENT = "mono";

const KEY = "nordus-accent";
const HEX = /^#[0-9a-f]{6}$/i;
const PROPS = [
  "--color-accent",
  "--color-accent-border",
  "--color-accent-text",
  "--color-accent-ink",
  "--color-focus",
  "--color-bubble-user",
  "--color-bubble-user-ink",
  "--color-accent-soft",
  "--color-accent-chip-ink",
  "--color-unread",
  "--color-unread-text",
] as const;

type AccentTokens = Record<(typeof PROPS)[number], string>;

const listeners = new Set<() => void>();
let current: string | null = null;
let observing = false;

function storage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function normalizeAccent(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const hex = value.trim().toLowerCase();
  return HEX.test(hex) || hex === MONO_ACCENT ? hex : null;
}

/** The no-colour tokens: white on the dark surface, black on the light one. Errors stay red and online stays green. */
export function deriveMonoTokens(app: string): AccentTokens {
  const dark = relativeLuminance(app) < 0.2;
  return dark
    ? {
        "--color-accent": "#ededed",
        "--color-accent-border": "#ffffff",
        "--color-accent-text": "#ededed",
        "--color-accent-ink": "#0a0a0a",
        "--color-focus": "#ededed",
        "--color-bubble-user": "#3d2d23",
        "--color-bubble-user-ink": "#ededed",
        "--color-accent-soft": "rgb(255 255 255 / 0.12)",
        "--color-accent-chip-ink": "rgb(255 255 255 / 0.9)",
        "--color-unread": "#ededed",
        "--color-unread-text": "#ededed",
      }
    : {
        "--color-accent": "#0a0a0a",
        "--color-accent-border": "#000000",
        "--color-accent-text": "#0a0a0a",
        "--color-accent-ink": "#ffffff",
        "--color-focus": "#0a0a0a",
        "--color-bubble-user": "#e4e4e4",
        "--color-bubble-user-ink": "#1a1a1a",
        "--color-accent-soft": "rgb(15 23 42 / 0.08)",
        "--color-accent-chip-ink": "#333333",
        "--color-unread": "#0a0a0a",
        "--color-unread-text": "#0a0a0a",
      };
}

export function readAccent(): string | null {
  try {
    return normalizeAccent(storage()?.getItem(KEY));
  } catch {
    return null;
  }
}

/** Every token the accent drives, tuned to the surface it sits on. */
export function deriveAccentTokens(accent: string, app: string): AccentTokens {
  if (accent === MONO_ACCENT) return deriveMonoTokens(app);
  const dark = relativeLuminance(app) < 0.2;
  const tone = toOklch(accent);
  const border = fromOklch({ ...tone, l: Math.min(0.95, tone.l + (dark ? 0.06 : -0.06)) });
  const text = toneForSurface(dark ? fromOklch({ ...tone, l: Math.max(tone.l, 0.72) }) : accent, app, 4.5);
  // White labels like the Nordus orange, until the fill is too pale to carry them.
  const ink = contrastRatio("#ffffff", accent) >= 2.8 ? "#ffffff" : "#0a0a0a";
  // The orange gives #3d2d23, the brand's warm tone for what you send; any accent gets its own.
  const bubble = dark ? mixSrgb(accent, "#252422", 0.115) : mixSrgb(accent, "#ffffff", 0.16);
  const bubbleInk = dark ? "#ededed" : "#1a1a18";
  return {
    "--color-accent": accent,
    "--color-accent-border": border,
    "--color-accent-text": text,
    "--color-accent-ink": ink,
    "--color-focus": text,
    "--color-bubble-user": bubble,
    "--color-bubble-user-ink": bubbleInk,
    "--color-accent-soft": `color-mix(in srgb, ${accent} 14%, transparent)`,
    "--color-accent-chip-ink": text,
    "--color-unread": "",
    "--color-unread-text": "",
  };
}

function appSurface(root: HTMLElement): string {
  try {
    const value = getComputedStyle(root).getPropertyValue("--color-app").trim().toLowerCase();
    return HEX.test(value) ? value : "#080808";
  } catch {
    return "#080808";
  }
}

/** The workspace brand's accent (a white-label colour), worn only while the person has not picked their own. */
let base: Readonly<Record<string, string>> = {};

function paint(): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  for (const prop of PROPS) root.style.removeProperty(prop);
  delete root.dataset.accent;
  for (const prop of Object.keys(base)) root.style.removeProperty(prop);
  if (!current) {
    for (const [prop, value] of Object.entries(base)) root.style.setProperty(prop, value);
    return;
  }
  const tokens = deriveAccentTokens(current, appSurface(root));
  for (const prop of PROPS) if (tokens[prop]) root.style.setProperty(prop, tokens[prop]);
  if (current === MONO_ACCENT) root.dataset.accent = MONO_ACCENT;
  else delete root.dataset.accent;
}

/** The brand loads after the person's choice is painted; it becomes the default under it, never over it. */
export function setAccentBase(vars: Readonly<Record<string, string>>): void {
  base = { ...vars };
  paint();
}

/** Saves and paints the accent; `null` goes back to the skin's own. A skin
 * change repaints, so the derived text tone always fits the new surface. */
export function applyAccent(accent: string | null): void {
  current = normalizeAccent(accent);
  try {
    if (current) storage()?.setItem(KEY, current);
    else storage()?.removeItem(KEY);
  } catch {
  }
  paint();
  if (!observing && typeof MutationObserver !== "undefined" && typeof document !== "undefined") {
    observing = true;
    new MutationObserver(paint).observe(document.documentElement, { attributes: true, attributeFilter: ["data-skin"] });
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAccent(): string | null {
  return useSyncExternalStore(subscribe, () => current, () => current);
}
