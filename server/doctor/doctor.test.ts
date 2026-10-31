import { describe, expect, it } from "vitest";
import { diskSource, engineSource, networkSource, ToolLoadFailures, toolsSource, type NetworkProbes } from "./checks.ts";
import { createDoctorService, type DoctorSource } from "./service.ts";

const GIB = 1024 ** 3;
const probes = (status: number | Error, failAt?: "dns" | "tls"): NetworkProbes => ({
  dns: async () => { if (failAt === "dns") throw new Error("ENOTFOUND"); },
  tls: async () => { if (failAt === "tls") throw new Error("handshake"); },
  http: async () => { if (status instanceof Error) throw status; return { status }; },
});
const target = [{ id: "anthropic", label: "Anthropic (Claude)", host: "api.anthropic.com" }];
const run = (source: DoctorSource) => source.run(new AbortController().signal);

describe("doctor service", () => {
  it("shares one run between concurrent callers and serves the cached report until refresh", async () => {
    let runs = 0;
    let clock = 0;
    const service = createDoctorService({ version: () => "1.0", now: () => clock, sources: [{ group: "disk", label: "Disco", run: async () => {
      runs += 1;
      return [{ id: "disk", group: "disk", label: "Disco", status: "ok", detail: "ok" }];
    } }] });
    const [a, b] = await Promise.all([service.report(), service.report()]);
    expect(a).toBe(b);
    await service.report();
    expect(runs).toBe(1);
    clock = 29_000;
    await service.report({ refresh: true });
    expect(runs).toBe(1);
    clock = 31_000;
    await service.report({ refresh: true });
    expect(runs).toBe(2);
  });

  it("hides a secret in the reason a source could not finish", async () => {
    const service = createDoctorService({ version: () => "1.0", sources: [
      { group: "tools", label: "Ferramentas", run: async () => { throw new Error("401 for key sk-ant-api03-TESTESECRETOFIXTURE123456"); } },
    ] });
    expect((await service.report()).checks[0].technical).not.toContain("TESTESECRETOFIXTURE");
  });

  it("turns a source that misses the total deadline into one warn line and keeps the others", async () => {
    const service = createDoctorService({ version: () => "1.0", totalMs: 30, sources: [
      { group: "network", label: "Conexão", run: () => new Promise(() => {}) },
      { group: "disk", label: "Disco", run: async () => [{ id: "disk", group: "disk", label: "Disco", status: "fail", detail: "cheio" }] },
    ] });
    const report = await service.report();
    expect(report.status).toBe("fail");
    expect(report.counts).toEqual({ ok: 0, warn: 1, fail: 1 });
    expect(report.checks.find((check) => check.group === "network")).toMatchObject({ status: "warn", fix: expect.any(String) });
  });
});

describe("doctor checks", () => {
  it("counts 401 as reachable and 403 as attention", async () => {
    expect((await run(networkSource(target, probes(401))))[0].status).toBe("ok");
    expect((await run(networkSource(target, probes(403))))[0].status).toBe("warn");
  });

  it("names the failing stage only in the technical text", async () => {
    const [check] = await run(networkSource(target, probes(200, "dns")));
    expect(check.status).toBe("fail");
    expect(check.detail).not.toMatch(/DNS/);
    expect(check.technical).toMatch(/^DNS api\.anthropic\.com/);
  });

  it("fails a signed-out engine, hides a secret in its technical text, and gives up on one that hangs", async () => {
    const [signedOut, hung] = await run(engineSource(() => [
      { id: "claude", label: "Claude", inUse: true, snapshot: async () => ({ state: "available", authenticated: false, reason: "token sk-ant-api03-TESTESECRETOFIXTURE123456 expired" }) },
      { id: "codex", label: "Codex", inUse: true, snapshot: () => new Promise(() => {}) },
    ]));
    expect(signedOut).toMatchObject({ status: "fail", fix: expect.stringContaining("entre de novo") });
    expect(signedOut.technical).not.toContain("TESTESECRETOFIXTURE");
    expect(hung.status).toBe("warn");
  }, 10_000);

  it("leaves out an engine nobody uses that is not set up, and fails when no engine works", async () => {
    const checks = await run(engineSource(() => [
      { id: "groq", label: "Groq", inUse: false, snapshot: async () => ({ state: "unavailable", reason: "No Groq API key" }) },
    ]));
    expect(checks.map((check) => [check.id, check.status])).toEqual([["engine:nenhum", "fail"]]);
  });

  it("fails when the disk is almost full", async () => {
    const [check] = await run(diskSource("/data", () => ({ freeBytes: GIB, totalBytes: 100 * GIB })));
    expect(check.status).toBe("fail");
  });

  it("keeps a bot's tool load failure until that bot finishes a turn well", async () => {
    const failures = new ToolLoadFailures();
    const source = toolsSource({ connections: () => ({ drive: { state: "down", checkedAt: 1, lastOkAt: null, downSince: 1, failures: 3 } }), loadFailures: () => failures.list() });
    failures.failed({ botId: "b1", botName: "ASSISTENTEFINANCEIRO", turnId: "turn-1", at: 1, message: "team tools didn't connect" });
    failures.turnSucceeded("b1", "turn-1");
    expect((await run(source)).map((check) => [check.id, check.status])).toEqual([["tools:drive", "fail"], ["tools:robo:b1", "warn"]]);
    failures.turnSucceeded("b1", "turn-2");
    expect((await run(source)).map((check) => check.id)).toEqual(["tools:drive"]);
  });
});
