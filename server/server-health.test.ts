import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import { createServerHealth, routeLabel } from "./server-health.ts";

function harness(delays: number[] = []) {
  let clock = 0;
  let tick = () => {};
  const lines: string[] = [];
  const health = createServerHealth({
    now: () => clock,
    readDelayMs: () => delays.shift() ?? 0,
    log: (line) => lines.push(line),
    startSampling: (sample) => {
      tick = sample;
      return () => {};
    },
  });
  const advance = (ms: number) => {
    clock += ms;
    tick();
  };
  const request = (url: string, contentType = "application/json") => {
    const req = { method: "GET", url } as IncomingMessage;
    const res = Object.assign(new EventEmitter(), { statusCode: 200, getHeader: () => contentType }) as unknown as ServerResponse;
    health.observe(req, res);
    return { finishAfter: (ms: number) => { clock += ms; res.emit("close"); } };
  };
  return { health, lines, advance, request };
}

describe("server health", () => {
  it("reports lag, p99 and max over the last 60 seconds only", () => {
    const { health, advance } = harness([0, 0, 900, 0]);
    advance(1_000);
    advance(1_000);
    advance(1_000);
    advance(1_000);
    expect(health.snapshot()).toEqual({ lagMs: 0, p99Ms: 900, maxMs: 900, samples: 4 });
    for (let i = 0; i < 60; i += 1) advance(1_000);
    expect(health.snapshot()).toMatchObject({ maxMs: 0, samples: 60 });
  });

  it("counts a late sampler as lag even before the histogram records it", () => {
    const { health, advance } = harness();
    advance(3_000);
    expect(health.snapshot().lagMs).toBe(2_000);
  });

  it("logs a blocked loop once per minute, naming the routes in flight without ids or query", () => {
    const { lines, advance, request } = harness([700, 800]);
    request("/api/threads/0f3a9c2e-1111/messages?text=segredo");
    advance(1_000);
    advance(1_000);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\[saude\] atraso no event loop: 700ms/);
    expect(lines[0]).toContain("GET /api/threads/:id/messages");
    expect(lines[0]).not.toContain("segredo");
    expect(lines[0]).not.toContain("0f3a9c2e");
  });

  it("logs a request slower than 2 s with its route and skips event streams", () => {
    const { lines, request } = harness();
    request("/api/events", "text/event-stream").finishAfter(30_000);
    request("/api/health").finishAfter(1_500);
    expect(lines).toEqual([]);
    request("/api/bots/abc123/files?path=x").finishAfter(2_500);
    expect(lines).toEqual(["[saude] pedido HTTP lento: GET /api/bots/:id/files 2500ms (status 200)"]);
    request("/api/bots").finishAfter(5_000);
    expect(lines).toHaveLength(1);
  });

  it("reads an idle loop as near zero, not as the histogram's 20 ms timer period", async () => {
    let tick = () => {};
    const health = createServerHealth({ startSampling: (sample) => { tick = sample; return () => {}; } });
    await new Promise((resolve) => setTimeout(resolve, 300));
    tick();
    health.stop();
    expect(health.snapshot().lagMs).toBeLessThan(15);
  });

  it("labels routes by their fixed segments", () => {
    expect(routeLabel("/")).toBe("/");
    expect(routeLabel("/api/health")).toBe("/api/health");
    expect(routeLabel("/api/bots/bot-budgets")).toBe("/api/bots/bot-budgets");
    expect(routeLabel("/files/report.pdf")).toBe("/files/:id");
  });
});
