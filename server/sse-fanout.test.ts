import http from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { deliverSseFrame, SSE_MAX_BUFFERED_BYTES, startSseKeepalive, type SseFanoutClient } from "./sse-fanout.ts";

type TestClient = SseFanoutClient & { drains: (() => void)[] };

function fakeClient(resOverrides: Partial<SseFanoutClient["res"]> = {}): TestClient {
  const drains: (() => void)[] = [];
  return {
    backpressured: false,
    drains,
    res: {
      writableLength: 0,
      write: () => true,
      end: () => {},
      once: (_event: "drain", listener: () => void) => drains.push(listener),
      ...resOverrides,
    },
  };
}

describe("deliverSseFrame", () => {
  it("sends normally while write() returns true", () => {
    const client = fakeClient();
    expect(deliverSseFrame(client, "message", "frame-a")).toBe("sent");
    expect(client.backpressured).toBe(false);
  });

  it("marks the client backpressured when write() returns false, without dropping that frame", () => {
    const client = fakeClient({ write: () => false });
    expect(deliverSseFrame(client, "message", "frame-a")).toBe("sent");
    expect(client.backpressured).toBe(true);
  });

  it("drops a replaceable screen frame once backpressured, but never drops a durable event", () => {
    const written: string[] = [];
    const client = fakeClient({
      write: (chunk: string) => {
        written.push(chunk);
        return false;
      },
    });

    expect(deliverSseFrame(client, "screen", "screen-1")).toBe("sent");
    expect(client.backpressured).toBe(true);

    expect(deliverSseFrame(client, "screen", "screen-2")).toBe("dropped");

    expect(deliverSseFrame(client, "message", "message-1")).toBe("sent");

    expect(written).toEqual(["screen-1", "message-1"]);
  });

  it("disconnects a client once buffered bytes exceed the bound, even for a durable event", () => {
    let ended = false;
    const client = fakeClient({
      writableLength: SSE_MAX_BUFFERED_BYTES + 1,
      end: () => {
        ended = true;
      },
    });
    expect(deliverSseFrame(client, "message", "message-1")).toBe("disconnected");
    expect(ended).toBe(true);
  });

  it("resumes screen frames once the socket drains", () => {
    // A single screen frame exceeds the 16 KB highWaterMark, so even a healthy client's write() returns false.
    let full = true;
    const client = fakeClient({ write: () => !full });

    expect(deliverSseFrame(client, "screen", "screen-1")).toBe("sent");
    expect(client.backpressured).toBe(true);
    expect(deliverSseFrame(client, "screen", "screen-2")).toBe("dropped");
    expect(client.drains).toHaveLength(1);

    full = false;
    for (const drain of client.drains) drain();

    expect(client.backpressured).toBe(false);
    expect(deliverSseFrame(client, "screen", "screen-3")).toBe("sent");
  });

  it("queues one drain listener per backpressure episode, not per frame", () => {
    const client = fakeClient({ write: () => false });

    deliverSseFrame(client, "message", "message-1");
    deliverSseFrame(client, "message", "message-2");
    deliverSseFrame(client, "message", "message-3");

    expect(client.backpressured).toBe(true);
    expect(client.drains).toHaveLength(1);
  });

  it("treats a throwing write() as a dead connection", () => {
    const client = fakeClient({
      write: () => {
        throw new Error("socket hang up");
      },
    });
    expect(deliverSseFrame(client, "message", "message-1")).toBe("disconnected");
  });

  it("never writes to a response that already ended", () => {
    const written: string[] = [];
    const client = fakeClient({ writableEnded: true, write: (chunk: string) => (written.push(chunk), true) });
    expect(deliverSseFrame(client, "message", "message-1")).toBe("disconnected");
    expect(written).toEqual([]);
  });
});

describe("startSseKeepalive", () => {
  const HEARTBEAT_MS = 10;
  const cleanups: (() => void)[] = [];
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  /** A real server and a client that stops reading, like a phone that went to sleep behind the proxy. */
  async function stalledStream(expired: () => boolean = () => false) {
    const errors: unknown[] = [];
    let stops = 0;
    let writesAfterEnd = 0;
    const opened = new Promise<http.ServerResponse>((resolve) => {
      const server = http.createServer((_req, res) => {
        res.writeHead(200, { "content-type": "text/event-stream", connection: "keep-alive" });
        const write = res.write.bind(res) as (chunk: string) => boolean;
        res.write = ((chunk: string) => {
          if (res.writableEnded) writesAfterEnd++;
          return write(chunk);
        }) as typeof res.write;
        startSseKeepalive(res, { intervalMs: HEARTBEAT_MS, frame: ": keepalive\n\n", expired, onStop: () => stops++ });
        res.on("error", (error) => errors.push(error));
        resolve(res);
      });
      server.listen(0, "127.0.0.1", () => {
        const agent = new http.Agent({ keepAlive: true });
        const req = http.get({ port: (server.address() as AddressInfo).port, host: "127.0.0.1", agent }, (incoming) => incoming.pause());
        req.on("error", () => {});
        cleanups.push(() => {
          req.destroy();
          agent.destroy();
          server.closeAllConnections();
          server.close();
        });
      });
    });
    const res = await opened;
    // Past what the socket and the paused client absorb, so end() cannot finish and 'close' does not come.
    const chunk = "x".repeat(1 << 20);
    for (let i = 0; i < 8; i++) res.write(chunk);
    return { res, errors, writesAfterEnd: () => writesAfterEnd, stops: () => stops };
  }

  it("stops at an end() from outside while the stalled socket stays open (22/10 production crash)", async () => {
    const stream = await stalledStream();
    expect(stream.res.writableLength).toBeGreaterThan(SSE_MAX_BUFFERED_BYTES);

    stream.res.end();
    await sleep(HEARTBEAT_MS * 6);

    expect(stream.res.writableEnded).toBe(true);
    expect(stream.res.writableFinished).toBe(false);
    expect(stream.writesAfterEnd()).toBe(0);
    expect(stream.errors).toEqual([]);
  });

  it("ends the stream once the session expires and writes nothing after", async () => {
    let live = true;
    const stream = await stalledStream(() => !live);
    await sleep(HEARTBEAT_MS * 3);
    live = false;
    await sleep(HEARTBEAT_MS * 6);

    expect(stream.res.writableEnded).toBe(true);
    expect(stream.writesAfterEnd()).toBe(0);
    expect(stream.errors).toEqual([]);
    // The client leaves fan-out at once, exactly once, without waiting for the socket's 'close'.
    expect(stream.stops()).toBe(1);
  });
});
