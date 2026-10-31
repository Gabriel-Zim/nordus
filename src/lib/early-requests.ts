// Requests the page can start before React mounts, in parallel with the session check. The store takes the answer
// instead of asking again; an early failure is never reused (the store asks for itself).
export const STARTUP_MESSAGES = 60;
export const LIST_PREVIEW_MESSAGES = 6;

const EARLY_TTL_MS = 15_000;
const early = new Map<string, { at: number; body: Promise<any> }>();

function start(path: string) {
  const body = fetch(path, { headers: { "content-type": "application/json" } }).then(async (res) => {
    if (!res.ok) throw new Error(String(res.status));
    return res.json();
  });
  body.catch(() => {});
  early.set(path, { at: Date.now(), body });
}

export function startEarlyRequests(focus: string | null): void {
  const query = new URLSearchParams({ messages: String(STARTUP_MESSAGES), preview: String(LIST_PREVIEW_MESSAGES) });
  if (focus) query.set("focus", focus);
  start(`/api/bots?${query}`);
  start("/api/instances");
}

/** Single use: the answer of an early request for exactly this path, or null. */
export function takeEarly<T = any>(path: string): Promise<T> | null {
  const entry = early.get(path);
  early.delete(path);
  return entry && Date.now() - entry.at < EARLY_TTL_MS ? entry.body : null;
}

export function hasEarly(path: string): boolean {
  const entry = early.get(path);
  return entry !== undefined && Date.now() - entry.at < EARLY_TTL_MS;
}

interface SharedAnswer { ok: boolean; status: number; statusText: string; body: any }
const shared = new Map<string, { at: number; promise: Promise<SharedAnswer> }>();

/** One GET at a time and for `ttl` ms after: several start-up callers ask for the same settings. Failures are not kept. */
export function sharedGet(path: string, ttl = 3_000): Promise<SharedAnswer> {
  const kept = shared.get(path);
  if (kept && Date.now() - kept.at < ttl) return kept.promise;
  const promise = fetch(path, { credentials: "same-origin", headers: { "content-type": "application/json" } }).then(async (res) => ({
    ok: res.ok, status: res.status, statusText: res.statusText, body: await res.json().catch(() => ({})),
  }));
  const entry = { at: Date.now(), promise };
  shared.set(path, entry);
  promise.catch(() => { if (shared.get(path) === entry) shared.delete(path); });
  return promise;
}
