import { useEffect } from "react";

/** Lists that load after the conversation is ready, or when a screen that reads them opens, not with the first snapshot. */
export type LazyListKey = "routines" | "notifications" | "webhooks";

const wanted = new Set<LazyListKey>();
let loader: ((key: LazyListKey) => void) | null = null;

/** Asks for a list the first snapshot leaves out (a no-op once requested). Safe before the store has started. */
export function ensureList(...keys: LazyListKey[]): void {
  for (const key of keys) {
    wanted.add(key);
    loader?.(key);
  }
}

/** Screens that read a deferred list call this on mount: it loads the list at once if the idle load has not. */
export function useEnsureList(...keys: LazyListKey[]): void {
  const id = keys.join(",");
  useEffect(() => { ensureList(...(id.split(",") as LazyListKey[])); }, [id]);
}

/** The store registers how to load a list; lists asked for before that load as soon as it does. Returns the unregister. */
export function registerListLoader(load: (key: LazyListKey) => void): () => void {
  loader = load;
  for (const key of wanted) load(key);
  return () => { if (loader === load) loader = null; };
}
