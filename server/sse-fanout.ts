export interface SseFanoutClient {
  res: {
    write(chunk: string): boolean;
    end(): void;
    writableLength: number;
    writableEnded?: boolean;
    once(event: "drain", listener: () => void): unknown;
  };
  backpressured: boolean;
}

/** Past this, cut the client loose; its EventSource reconnects and replays via Last-Event-ID. */
export const SSE_MAX_BUFFERED_BYTES = 4 * 1024 * 1024;

export type SseFanoutOutcome = "sent" | "dropped" | "disconnected";

/** Only screen captures are skipped while backpressured; durable events are always written, or the client is disconnected to replay them. */
export function deliverSseFrame(client: SseFanoutClient, kind: string, frame: string): SseFanoutOutcome {
  // A write after end() never throws here: it emits 'error' on the next tick.
  if (client.res.writableEnded) return "disconnected";
  if (client.res.writableLength > SSE_MAX_BUFFERED_BYTES) {
    try {
      client.res.end();
    } catch {
    }
    return "disconnected";
  }
  if (client.backpressured && kind === "screen") return "dropped";
  try {
    if (!client.res.write(frame) && !client.backpressured) {
      // write() returns false past the 16 KB highWaterMark, which one screen frame clears: it means "not drained yet", and without the drain listener the flag latches forever.
      client.backpressured = true;
      client.res.once("drain", () => {
        client.backpressured = false;
      });
    }
    return "sent";
  } catch {
    return "disconnected";
  }
}

export interface SseKeepaliveResponse {
  write(chunk: string): boolean;
  end(): void;
  readonly writableEnded: boolean;
  readonly destroyed: boolean;
  on(event: "error", listener: (error: Error) => void): unknown;
  once(event: "close" | "finish", listener: () => void): unknown;
}

/**
 * Ending a stalled stream (session revoked, audience changed, buffer over the bound) leaves its socket open until the
 * buffer drains, so 'close' can be hours away. The heartbeat stops at the end itself: its next write would emit
 * ERR_STREAM_WRITE_AFTER_END as an unhandled 'error' and take the whole server down.
 */
export function startSseKeepalive(
  res: SseKeepaliveResponse,
  options: { intervalMs: number; frame: string; expired: () => boolean; onStop?: () => void },
): () => void {
  // The socket can still reset under a write; the stream is gone either way, and its owner sees 'close'.
  res.on("error", () => {});
  const timer = setInterval(() => {
    if (res.writableEnded || res.destroyed) return stop();
    if (options.expired()) {
      res.end();
      return stop();
    }
    res.write(options.frame);
  }, options.intervalMs);
  let stopped = false;
  // onStop lets the owner drop the client from fan-out now, not at a 'close' the stalled socket may never send.
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    options.onStop?.();
  };
  res.once("finish", stop);
  res.once("close", stop);
  return stop;
}
