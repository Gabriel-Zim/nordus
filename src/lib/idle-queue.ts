// Work that can wait: starts when the browser is idle and never runs more than `max` jobs at once.
let active = 0;
const waiting: Array<() => void> = [];

function whenIdle(run: () => void, timeout: number) {
  if (typeof requestIdleCallback === "function") requestIdleCallback(run, { timeout });
  else setTimeout(run, 50);
}

function pump(max: number) {
  while (active < max && waiting.length) waiting.shift()!();
}

export function whenIdleLimited<T>(job: () => Promise<T>, max = 2, timeout = 2_000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    whenIdle(() => {
      const start = () => {
        active += 1;
        job().then(resolve, reject).finally(() => { active -= 1; pump(max); });
      };
      if (active < max) start();
      else waiting.push(start);
    }, timeout);
  });
}

/** Runs once the page has settled: after the window load, then at idle (or after `delay` at the latest). */
export function afterStartup(run: () => void, delay = 3_000): void {
  const go = () => setTimeout(() => whenIdle(run, delay), 1_000);
  if (typeof document === "undefined" || document.readyState === "complete") go();
  else window.addEventListener("load", go, { once: true });
}
