import { useSyncExternalStore } from "react";
import { applySkin, type SkinId } from "./skins";

/** What the person picks in Aparência: the Nordus dark, the Nordus light, or
 * whichever the system is using. The colour is a separate choice (accent). */
export const THEME_MODES = ["dark", "light", "auto"] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

export const DEFAULT_THEME_MODE: ThemeMode = "dark";

const KEY = "nordus-theme";
const SKIN_KEY = "nordus-skin";
/** The retired skins with a light ground; anyone on one of them lands on Claro, the rest on Escuro. */
const LIGHT_SKINS = new Set(["atelier", "lagoon", "linen", "daylight", "meadow", "nordus-light"]);

const listeners = new Set<() => void>();
let current: ThemeMode = DEFAULT_THEME_MODE;
let systemQuery: MediaQueryList | null = null;

function storage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function isThemeMode(value: unknown): value is ThemeMode {
  return THEME_MODES.includes(value as ThemeMode);
}

export function readThemeMode(): ThemeMode {
  try {
    const store = storage();
    const stored = store?.getItem(KEY);
    if (isThemeMode(stored)) return stored;
    const skin = store?.getItem(SKIN_KEY);
    return skin && LIGHT_SKINS.has(skin) ? "light" : DEFAULT_THEME_MODE;
  } catch {
    return DEFAULT_THEME_MODE;
  }
}

function systemPrefersLight(): boolean {
  try {
    return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: light)").matches;
  } catch {
    return false;
  }
}

export function skinForMode(mode: ThemeMode, prefersLight = systemPrefersLight()): SkinId {
  const light = mode === "light" || (mode === "auto" && prefersLight);
  return light ? "nordus-light" : "nordus";
}

function followSystem(): void {
  if (current === "auto") applySkin(skinForMode("auto"));
}

/** Saves the choice and paints the matching Nordus skin; Automático keeps following the system. */
export function applyThemeMode(mode: ThemeMode): void {
  current = isThemeMode(mode) ? mode : DEFAULT_THEME_MODE;
  try {
    storage()?.setItem(KEY, current);
  } catch {
  }
  applySkin(skinForMode(current));
  if (!systemQuery && typeof window !== "undefined" && typeof window.matchMedia === "function") {
    try {
      systemQuery = window.matchMedia("(prefers-color-scheme: light)");
      systemQuery.addEventListener("change", followSystem);
    } catch {
      systemQuery = null;
    }
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useThemeMode(): ThemeMode {
  return useSyncExternalStore(subscribe, () => current, () => current);
}
