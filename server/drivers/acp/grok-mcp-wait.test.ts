import { describe, expect, it } from "vitest";

import { awaitGrokMcpServers } from "./grok.ts";

const listing = (statuses: Array<boolean | undefined>) => {
  let calls = 0;
  const request = async (method: string) => {
    expect(method).toBe("_x.ai/mcp/list");
    const resolved = statuses[Math.min(calls, statuses.length - 1)];
    calls += 1;
    return { result: { servers: [{ name: "computer", session: { enabled: true, status: resolved ? "ready" : "initializing" } }], sessionMcpResolved: resolved } };
  };
  return { request, calls: () => calls };
};

describe("awaitGrokMcpServers", () => {
  it("holds the prompt until Grok reports its MCP servers resolved", async () => {
    const fake = listing([false, false, true]);
    await expect(awaitGrokMcpServers(fake.request, "s1", 5_000)).resolves.toBe("resolved");
    expect(fake.calls()).toBe(3);
  });

  it("returns at once for a pooled session that is already resolved", async () => {
    const fake = listing([true]);
    await expect(awaitGrokMcpServers(fake.request, "s1", 5_000)).resolves.toBe("resolved");
    expect(fake.calls()).toBe(1);
  });

  it("gives up at the deadline instead of failing the turn", async () => {
    const fake = listing([false]);
    await expect(awaitGrokMcpServers(fake.request, "s1", 250)).resolves.toBe("timeout");
  });

  it("does not block a Grok without the catalog extension", async () => {
    await expect(awaitGrokMcpServers(async () => { throw new Error("Method not found"); }, "s1", 5_000)).resolves.toBe("unsupported");
    await expect(awaitGrokMcpServers(async () => ({ result: {} }), "s1", 5_000)).resolves.toBe("unsupported");
  });
});
