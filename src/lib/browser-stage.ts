import { useSyncExternalStore } from "react";

// Opens a bot's browser in the stage (a big window over the chat) from anywhere in the app. The panel may not be
// mounted yet when the request is made, so the request waits briefly for it.
export const BROWSER_STAGE_EVENT = "nordus:browser-stage";
const PENDING_MS = 10_000;

export const BROWSER_STAGE_CLOSE_EVENT = "nordus:browser-stage-close";

/** Closes the stage of a bot's browser, back to the chat (the floating view stays). */
export function closeBrowserStage(botId: string): void {
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") return;
  window.dispatchEvent(new CustomEvent(BROWSER_STAGE_CLOSE_EVENT, { detail: { botId } }));
}

let pending: { botId: string; at: number } | null = null;

export function openBrowserStage(botId: string): void {
  pending = { botId, at: Date.now() };
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") return;
  window.dispatchEvent(new CustomEvent(BROWSER_STAGE_EVENT, { detail: { botId } }));
}

/** A stage request made for this bot a moment ago, taken once by the panel that mounts for it. */
export function takePendingBrowserStage(botId: string): boolean {
  if (!pending || pending.botId !== botId || Date.now() - pending.at > PENDING_MS) return false;
  pending = null;
  return true;
}

/** Whichever bot's stage was requested a moment ago, taken once by the stage host when it finishes loading. */
export function takeAnyPendingBrowserStage(): string | null {
  if (!pending || Date.now() - pending.at > PENDING_MS) return null;
  const { botId } = pending;
  pending = null;
  return botId;
}

export function clearPendingBrowserStage(botId: string): void {
  if (pending?.botId === botId) pending = null;
}

// One live connection per bot: while a stage is open for a bot, every other view of its browser (the side panel,
// the chat card's thumbnail) lets go of its own, so the stage never waits behind them.
const owners = new Map<string, symbol>();
const listeners = new Set<() => void>();

export function claimBrowserStage(botId: string, token: symbol): () => void {
  owners.set(botId, token);
  for (const listener of listeners) listener();
  return () => {
    if (owners.get(botId) !== token) return;
    owners.delete(botId);
    for (const listener of listeners) listener();
  };
}

export function useBrowserStageOwner(botId: string | undefined): symbol | undefined {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => (botId ? owners.get(botId) : undefined),
    () => undefined,
  );
}

// The floating live thumbnail is the one view of the browser outside the stage: while it is on screen for a bot, the chat
// card's own thumbnail shows its last picture instead of opening a second connection.
const floats = new Map<string, symbol>();
const floatListeners = new Set<() => void>();

export function claimBrowserFloat(botId: string, token: symbol): () => void {
  floats.set(botId, token);
  for (const listener of floatListeners) listener();
  return () => {
    if (floats.get(botId) !== token) return;
    floats.delete(botId);
    for (const listener of floatListeners) listener();
  };
}

export function useBrowserFloat(botId: string | undefined): boolean {
  return useSyncExternalStore(
    (listener) => { floatListeners.add(listener); return () => { floatListeners.delete(listener); }; },
    () => (botId ? floats.has(botId) : false),
    () => false,
  );
}
