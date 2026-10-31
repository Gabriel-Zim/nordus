/** Like setInterval, but silent while the tab is hidden; when it shows again, a tick that came due runs at once. */
export function visibleInterval(tick: () => void, ms: number): () => void {
  if (typeof document === "undefined") {
    const timer = setInterval(tick, ms);
    return () => clearInterval(timer);
  }
  let timer: ReturnType<typeof setInterval> | null = null;
  let lastRun = Date.now();
  const run = () => {
    lastRun = Date.now();
    tick();
  };
  const start = () => {
    timer ??= setInterval(run, ms);
  };
  const stop = () => {
    if (timer) clearInterval(timer);
    timer = null;
  };
  const onVisibility = () => {
    if (document.visibilityState !== "visible") return stop();
    start();
    if (Date.now() - lastRun >= ms) run();
  };
  document.addEventListener("visibilitychange", onVisibility);
  if (document.visibilityState === "visible") start();
  return () => {
    stop();
    document.removeEventListener("visibilitychange", onVisibility);
  };
}
