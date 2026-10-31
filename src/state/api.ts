// The renderer's JSON request helper. A Cloud home that went to sleep is never woken by a background poll
// (src/lib/cloud-power.ts).
import { signedOutWatch } from "../lib/signed-out";
import { sharedGet } from "../lib/early-requests";
import { asleepAnswer, BACKGROUND_HEADER, cloudAsleep, markCloudAsleep, markCloudAwake } from "../lib/cloud-power";

export class ApiError extends Error {
  readonly status: number;
  readonly body?: Record<string, unknown>;
  constructor(message: string, status: number, body?: Record<string, unknown>) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

/** `background`: a poll nobody asked for just now. It never wakes a Cloud home that went to sleep (it is refused here
 * instead, src/lib/cloud-power.ts) and the home doesn't count it as someone using it. Anything else wakes it. */
export async function api<T = any>(path: string, init?: RequestInit & { timeoutMs?: number; background?: boolean }): Promise<T> {
  const { timeoutMs, signal, background, headers, ...rest } = init ?? {};
  if (cloudAsleep()) {
    if (background) throw new ApiError("My Cloud is asleep", 503, { error: "asleep" });
    markCloudAwake();
  }
  if (path === "/api/config" && !rest.method && !signal && !background) {
    const shared = await sharedGet(path);
    if (!shared.ok) {
      const error = shared.body?.error;
      throw new ApiError(typeof error === "string" ? error : `${shared.status} ${shared.statusText}`, shared.status, shared.body);
    }
    return shared.body;
  }
  const sent = new Headers(headers ?? { "content-type": "application/json" });
  if (background) sent.set(BACKGROUND_HEADER, "1");
  const res = await fetch(path, {
    ...rest,
    headers: sent,
    signal: timeoutMs === undefined
      ? signal
      : signal
        ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
        : AbortSignal.timeout(timeoutMs),
  });
  if (asleepAnswer(res)) markCloudAsleep();
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = body?.error;
    const message = typeof error === "string" ? error : typeof error?.message === "string" ? error.message : `${res.status} ${res.statusText}`;
    const failure = new ApiError(message, res.status, body);
    void signedOutWatch.noteRefusal(failure);
    throw failure;
  }
  return body;
}
