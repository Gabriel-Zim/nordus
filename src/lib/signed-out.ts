import { useSyncExternalStore } from "react";
import { readSessionState, type SessionState } from "./session";

/** The server's code for a refusal that only signing in again on this device lifts (server/request-auth.ts). */
export const SIGNED_OUT_CODE = "signed-out";

/** Servers from before the code carried only these words. */
const SIGNED_OUT_TEXT = /pair this device|session has expired or was revoked/i;

/** A 401/403 that means this browser has no session any more (a dropped cookie, a revoked device), not a refusal of this one request. */
export function isSignedOutError(error: unknown): boolean {
  const record = Object(error) as { status?: unknown; body?: unknown; message?: unknown };
  if (record.status !== 401 && record.status !== 403) return false;
  if (Reflect.get(Object(record.body), "code") === SIGNED_OUT_CODE) return true;
  return typeof record.message === "string" && SIGNED_OUT_TEXT.test(record.message);
}

const CHECK_SPACING_MS = 15_000;

export function createSignedOutWatch({
  readSession = readSessionState,
  now = () => Date.now(),
}: { readSession?: () => Promise<SessionState>; now?: () => number } = {}) {
  let signedOut = false;
  let checking: Promise<boolean> | null = null;
  let checkedAt = -Infinity;
  const listeners = new Set<() => void>();
  const set = (value: boolean) => {
    if (signedOut === value) return;
    signedOut = value;
    for (const listener of listeners) listener();
  };
  /** Asks the server itself: one refused route is not proof, and a server out of reach says nothing about the session. */
  const confirm = (): Promise<boolean> => checking ??= readSession()
    .then((state) => {
      if (state.kind === "unauthenticated") set(true);
      return signedOut;
    })
    .catch(() => signedOut)
    .finally(() => {
      checking = null;
      checkedAt = now();
    });
  return {
    signedOut: () => signedOut,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** The person asked to sign in (a queued send's button): the page shows the sign-in whatever the last check said. */
    show() {
      set(true);
    },
    /** After a response that says so: confirmed at once. */
    noteRefusal(error: unknown): Promise<boolean> {
      return isSignedOutError(error) ? confirm() : Promise.resolve(signedOut);
    },
    /** After a failure that shows nothing (a live stream that will not open): checked at most every few seconds. */
    suspect(): Promise<boolean> {
      if (signedOut || checking || now() - checkedAt < CHECK_SPACING_MS) return checking ?? Promise.resolve(signedOut);
      return confirm();
    },
  };
}

export type SignedOutWatch = ReturnType<typeof createSignedOutWatch>;

export const signedOutWatch = createSignedOutWatch();

export function useSignedOut(watch: SignedOutWatch = signedOutWatch): boolean {
  return useSyncExternalStore(watch.subscribe, watch.signedOut, watch.signedOut);
}
