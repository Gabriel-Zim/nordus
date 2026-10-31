import { describe, expect, it } from "vitest";

import { McpHealthMonitor, mcpHealthReason, mcpOutageNote, type McpHealthEntry } from "./mcp-health.ts";
import type { McpProbeResult } from "./mcp-probe.ts";

function monitor(results: Record<string, McpProbeResult>) {
  let now = Date.UTC(2026, 9, 16, 13, 0, 0);
  const changes: Array<[string, McpHealthEntry | null]> = [];
  let servers: Record<string, object> = Object.fromEntries(Object.keys(results).map((name) => [name, {}]));
  const health = new McpHealthMonitor<object>({
    servers: () => servers,
    probe: async (name) => results[name]!,
    now: () => now,
    onChange: (name, entry) => changes.push([name, entry]),
  });
  return {
    health, changes, results,
    advance: (ms: number) => { now += ms; },
    setServers: (next: Record<string, object>) => { servers = next; },
  };
}

describe("McpHealthMonitor", () => {
  it("goes degraded on the first failed probe, down on the second, and back to ok on its own", async () => {
    const m = monitor({ cerebro: { ok: true, tools: [] } });
    await m.health.checkAll();
    expect(m.health.entry("cerebro")).toMatchObject({ state: "ok", failures: 0 });

    m.results.cerebro = { ok: false, error: "Could not reach this address." };
    m.advance(5 * 60_000);
    await m.health.checkAll();
    const firstFailure = m.health.entry("cerebro")!;
    expect(firstFailure).toMatchObject({ state: "degraded", failures: 1 });
    expect(firstFailure.downSince).toBe(firstFailure.checkedAt);

    m.advance(60_000);
    await m.health.checkAll();
    expect(m.health.entry("cerebro")).toMatchObject({ state: "down", failures: 2, downSince: firstFailure.downSince });

    m.results.cerebro = { ok: true, tools: [] };
    m.advance(60_000);
    await m.health.checkAll();
    expect(m.health.entry("cerebro")).toMatchObject({ state: "ok", failures: 0, downSince: null });
    expect(m.changes.map(([, entry]) => entry?.state)).toEqual(["ok", "degraded", "down", "ok"]);
  });

  it("treats a server asking for sign-in as reachable and forgets removed servers", async () => {
    const m = monitor({ oauth: { ok: false, auth: "required", error: "This server needs you to sign in." } });
    await m.health.checkAll();
    expect(m.health.entry("oauth")?.state).toBe("ok");
    m.setServers({});
    await m.health.checkAll();
    expect(m.health.entry("oauth")).toBeUndefined();
    expect(m.changes.at(-1)).toEqual(["oauth", null]);
  });

  it("probes again a minute later while a server is failing, and five minutes later when all answer", async () => {
    const delays: number[] = [];
    let pending: (() => void) | null = null;
    let ok = false;
    const health = new McpHealthMonitor<object>({
      servers: () => ({ x: {} }),
      probe: async () => ok ? { ok: true, tools: [] } : { ok: false, error: "down" },
      setTimer: (run, ms) => { delays.push(ms); pending = run; return { cancel: () => { pending = null; } }; },
    });
    health.start(10);
    const fire = async () => { const run = pending!; run(); await health.checkAll(); await new Promise((resolve) => setTimeout(resolve, 0)); };
    await fire();
    ok = true;
    await fire();
    health.stop();
    expect(delays).toEqual([10, 60_000, 300_000]);
  });
});

describe("mcpOutageNote", () => {
  const at = Date.UTC(2026, 9, 16, 13, 5, 0);
  it("says in a plain sentence which connection is out and since when, only for the bot's own connections", () => {
    const entries: Record<string, McpHealthEntry> = {
      cerebro: { state: "down", checkedAt: at, lastOkAt: null, downSince: at, failures: 2 },
      drive: { state: "degraded", checkedAt: at, lastOkAt: null, downSince: at, failures: 1 },
      notion: { state: "ok", checkedAt: at, lastOkAt: at, downSince: null, failures: 0 },
    };
    const note = mcpOutageNote(entries, ["cerebro", "notion"], "America/Sao_Paulo");
    expect(note).toContain("A conexão cerebro está fora do ar desde 10:05.");
    expect(note).not.toContain("drive");
    expect(note).not.toMatch(/[—–]/);
    expect(mcpOutageNote(entries, ["drive"], "America/Sao_Paulo")).toContain("está instável desde 10:05");
    expect(mcpOutageNote(entries, ["notion"], "America/Sao_Paulo")).toBe("");
  });
});

describe("mcpHealthReason", () => {
  const cases: Array<[McpProbeResult, string]> = [
    [{ ok: false, error: "x", kind: "unreachable" }, "Não consegui falar com o app agora."],
    [{ ok: false, error: "x", kind: "timeout" }, "O app demorou demais para responder."],
    [{ ok: false, error: "x", kind: "http" }, "O app recusou o acesso; pode ser preciso entrar de novo."],
    [{ ok: false, error: "x", kind: "protocol" }, "O app respondeu de um jeito que não consegui entender."],
    [{ ok: false, error: "x", kind: "spawn" }, "Não consegui abrir o app neste computador."],
    [{ ok: false, error: "x", kind: "closed" }, "O app foi encerrado antes de responder."],
    [{ ok: false, error: "x", kind: "cancelled" }, "A verificação do app foi interrompida."],
    [{ ok: false, error: "probe failed" }, "Não consegui falar com o app agora."],
  ];
  it.each(cases)("turns %j into a plain sentence", (result, sentence) => {
    expect(mcpHealthReason(result)).toBe(sentence);
    expect(sentence).not.toMatch(/HTTP|https?:|MCP|server|\d{3}/i);
  });

  it("keeps the reason on the entry while failing, follows a changed cause, and drops it when the server answers", async () => {
    const m = monitor({ cerebro: { ok: false, error: "x", kind: "timeout" } });
    await m.health.checkAll();
    expect(m.health.entry("cerebro")).toMatchObject({ state: "degraded", reason: "O app demorou demais para responder." });
    m.results.cerebro = { ok: false, error: "x", kind: "http" };
    await m.health.checkAll();
    expect(m.health.entry("cerebro")).toMatchObject({ state: "down", reason: "O app recusou o acesso; pode ser preciso entrar de novo." });
    expect(m.health.snapshot().cerebro?.reason).toBeTruthy();
    m.results.cerebro = { ok: true, tools: [] };
    await m.health.checkAll();
    expect(m.health.entry("cerebro")).not.toHaveProperty("reason");
  });
});
