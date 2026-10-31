// Event-loop delay and slow HTTP requests, measured in production so "the screen froze" has a number behind it.
// The idea follows touri's sidecar/src/kernel/performance.ts (Apache-2.0); the code is written anew for node:perf_hooks.
import type { IncomingMessage, ServerResponse } from "node:http";
import { monitorEventLoopDelay } from "node:perf_hooks";

const WINDOW_MS = 60_000;

export interface EventLoopStats {
  lagMs: number;
  p99Ms: number;
  maxMs: number;
  samples: number;
}

export interface ServerHealthOptions {
  log?: (line: string) => void;
  now?: () => number;
  /** Worst delay since the previous call, in ms. Defaults to a monitorEventLoopDelay histogram that is reset on each read. */
  readDelayMs?: () => number;
  startSampling?: (sample: () => void, intervalMs: number) => () => void;
  sampleMs?: number;
  lagWarnMs?: number;
  slowRequestMs?: number;
  cooldownMs?: number;
}

export interface ServerHealth {
  snapshot(): EventLoopStats;
  observe(req: IncomingMessage, res: ServerResponse): void;
  stop(): void;
}

const RESOLUTION_MS = 20;

function histogramReader(): { read: () => number; stop: () => void } {
  const histogram = monitorEventLoopDelay({ resolution: RESOLUTION_MS });
  histogram.enable();
  return {
    read: () => {
      // Node 24 records the whole timer period, so an idle loop reads ~22 ms; the delay is what exceeds the resolution.
      const ms = Math.max(0, histogram.max / 1e6 - RESOLUTION_MS);
      histogram.reset();
      return ms;
    },
    stop: () => histogram.disable(),
  };
}

function startInterval(sample: () => void, intervalMs: number): () => void {
  const timer = setInterval(sample, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}

const round = (ms: number) => Math.round(ms);

/** Path only, with ids and long tokens masked, so a log line names the route and never a thread, file or query. */
export function routeLabel(rawUrl: string | undefined): string {
  const path = (rawUrl ?? "/").split(/[?#]/, 1)[0] ?? "/";
  return path
    .split("/")
    .map((segment) => (segment.length > 24 || /\d/.test(segment) || /[^A-Za-z_-]/.test(segment) ? ":id" : segment))
    .slice(0, 6)
    .join("/") || "/";
}

export function createServerHealth(options: ServerHealthOptions = {}): ServerHealth {
  const {
    log = (line) => console.warn(line),
    now = () => performance.now(),
    sampleMs = 1_000,
    lagWarnMs = 500,
    slowRequestMs = 2_000,
    cooldownMs = 60_000,
    startSampling = startInterval,
  } = options;
  const reader = options.readDelayMs ? { read: options.readDelayMs, stop: () => {} } : histogramReader();
  const inFlight = new Map<IncomingMessage, number>();
  let samples: Array<{ at: number; lagMs: number }> = [];
  let expectedAt = now() + sampleMs;
  let lastLagWarningAt = Number.NEGATIVE_INFINITY;
  let lastRequestWarningAt = Number.NEGATIVE_INFINITY;

  const warn = (line: string) => {
    try {
      log(line);
    } catch {
      // A failing logger must never fail a request or stop the sampler.
    }
  };

  const snapshot = (): EventLoopStats => {
    const at = now();
    const current = samples.filter((s) => at - s.at < WINDOW_MS);
    const sorted = current.map((s) => s.lagMs).sort((a, b) => a - b);
    return {
      lagMs: round(current.at(-1)?.lagMs ?? 0),
      p99Ms: round(sorted[Math.ceil(sorted.length * 0.99) - 1] ?? 0),
      maxMs: round(sorted.at(-1) ?? 0),
      samples: current.length,
    };
  };

  const sample = () => {
    const at = now();
    // The sampler's own lateness catches a block the histogram has not recorded yet, since its timer may fire after ours.
    const lagMs = Math.max(0, reader.read(), at - expectedAt);
    expectedAt = at + sampleMs;
    samples = [...samples.filter((s) => at - s.at < WINDOW_MS), { at, lagMs }];
    if (lagMs < lagWarnMs || at - lastLagWarningAt < cooldownMs) return;
    lastLagWarningAt = at;
    const slowest = [...inFlight.entries()]
      .sort(([, a], [, b]) => a - b)
      .slice(0, 5)
      .map(([req, startedAt]) => `${req.method ?? "GET"} ${routeLabel(req.url)} ${round(at - startedAt)}ms`);
    const s = snapshot();
    warn(`[saude] atraso no event loop: ${round(lagMs)}ms (p99 ${s.p99Ms}ms, max ${s.maxMs}ms em 60s)${slowest.length ? `; pedidos em curso: ${slowest.join(", ")}` : ""}`);
  };
  const stopSampling = startSampling(sample, sampleMs);

  const observe = (req: IncomingMessage, res: ServerResponse) => {
    const startedAt = now();
    inFlight.set(req, startedAt);
    res.once("close", () => {
      inFlight.delete(req);
      const at = now();
      const durationMs = at - startedAt;
      // Event streams stay open by design; their length says nothing about the server being slow.
      if (String(res.getHeader("content-type") ?? "").startsWith("text/event-stream")) return;
      if (durationMs <= slowRequestMs || at - lastRequestWarningAt < cooldownMs) return;
      lastRequestWarningAt = at;
      warn(`[saude] pedido HTTP lento: ${req.method ?? "GET"} ${routeLabel(req.url)} ${round(durationMs)}ms (status ${res.statusCode})`);
    });
  };

  return {
    snapshot,
    observe,
    stop: () => {
      stopSampling();
      reader.stop();
      inFlight.clear();
    },
  };
}
