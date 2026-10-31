import { useEffect, useRef, useState, type RefObject } from "react";

/** A phone that opens a thread full of photos fetches and decodes three at a time instead of all at once. */
export const DECODE_LIMIT = 3;
/** A picture that never fires load or error (a stalled request) gives its slot back after this long. */
export const DECODE_SLOT_TIMEOUT_MS = 15_000;

let active = 0;
const waiting: Array<() => void> = [];

/** Calls `grant` when a slot frees up; the returned function gives the slot back, or leaves the line. Safe to call twice. */
export function requestDecodeSlot(grant: () => void): () => void {
  let state: "waiting" | "active" | "done" = "waiting";
  let timer: ReturnType<typeof setTimeout> | undefined;
  const release = () => {
    if (state === "waiting") waiting.splice(waiting.indexOf(start), 1);
    if (state === "active") {
      clearTimeout(timer);
      active -= 1;
      waiting.shift()?.();
    }
    state = "done";
  };
  function start() {
    state = "active";
    active += 1;
    timer = setTimeout(release, DECODE_SLOT_TIMEOUT_MS);
    grant();
  }
  if (active < DECODE_LIMIT) start();
  else waiting.push(start);
  return release;
}

export function decodeSlotsInUse(): { active: number; waiting: number } {
  return { active, waiting: waiting.length };
}

/** Joins the line once the element comes near the screen (at once when `eager`); `release` frees the slot after load. */
export function useDecodeSlot(ref: RefObject<Element | null>, eager: boolean) {
  const [granted, setGranted] = useState(false);
  const releaseRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (granted) return;
    const el = ref.current;
    const join = () => {
      releaseRef.current ??= requestDecodeSlot(() => setGranted(true));
    };
    if (eager || !el || typeof IntersectionObserver === "undefined") {
      join();
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        join();
      }
    }, { rootMargin: "600px 0px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, [eager, granted, ref]);
  useEffect(() => () => releaseRef.current?.(), []);
  return { granted, release: () => releaseRef.current?.() };
}
