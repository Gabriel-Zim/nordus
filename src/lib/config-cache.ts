import type { ConfigStatus } from "@/state/config-status";

let shared: Promise<any> | null = null;

async function fetchConfig(fetchImpl: typeof fetch): Promise<any> {
  const res = await fetchImpl("/api/config", { headers: { "content-type": "application/json" }, credentials: "same-origin" });
  const body: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = Reflect.get(Object(body), "error");
    throw new Error(typeof error === "string" ? error : `${res.status} ${res.statusText}`);
  }
  return body;
}

// Like api(), the answer is untyped: readers narrow it themselves (ConfigStatus is only the part the store keeps).
/** One GET /api/config for the whole page: callers share the request in flight or its answer. A failure is not kept. */
export function configOnce(force = false, fetchImpl: typeof fetch = fetch): Promise<any> {
  if (force || !shared) {
    const next: Promise<any> = fetchConfig(fetchImpl).catch((error) => {
      if (shared === next) shared = null;
      throw error;
    });
    shared = next;
  }
  return shared;
}

/** The server's own answer to a save or an update frame replaces what the next reader sees. */
export function applyConfig(next: ConfigStatus): void {
  shared = Promise.resolve(next);
}

export function resetConfigCache(): void {
  shared = null;
}
