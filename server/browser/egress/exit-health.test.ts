import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { fetchViaExit, INCIDENTS_FILE, msUntilDaily, runExitHealth, type FetchVia } from "./exit-health.ts";
import type { Exit } from "./proxy-pool.ts";

const exitOf = (name: string, up = true): Exit => ({
  name, kind: "proxy", label: `${name} host:1`,
  upstream: { open: async () => ({ gone: true }) },
  state: () => (up ? "online" : "offline"), resting: () => false, probe: async () => (up ? "online" : "offline"),
});

const answers = (ips: Record<string, string>, page = 204): FetchVia => async (exit, url) => {
  if (url.includes("ipinfo")) return { status: 200, body: JSON.stringify({ ip: ips[exit.name], city: "Exampleville", org: "AS64496 EXAMPLE-NET" }) };
  return { status: page, body: "" };
};

describe("o raio-x diário das saídas", () => {
  it("saída boa: no ar, com IP, cidade, ASN e página 204, sem incidente", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nordus-raiox-"));
    const logs: string[] = [];
    const [check] = await runExitHealth({ exits: [exitOf("PROXY_1")], dataDir: dir, fetchVia: answers({ PROXY_1: "200.1.1.1" }), log: (line) => logs.push(line) });
    expect(check).toMatchObject({ name: "PROXY_1", up: true, ip: "200.1.1.1", city: "Exampleville", asn: "AS64496 EXAMPLE-NET", page: 204, worse: false });
    expect(logs).toEqual([]);
    expect(existsSync(join(dir, INCIDENTS_FILE))).toBe(false);
  });

  it("marca piora quando o IP mudou, quando a saída caiu ou quando a página não abre, e anota uma linha datada", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nordus-raiox-"));
    const logs: string[] = [];
    const now = () => new Date("2026-10-23T09:00:00.000Z");
    await runExitHealth({ exits: [exitOf("PROXY_1"), exitOf("PROXY_2")], dataDir: dir, fetchVia: answers({ PROXY_1: "200.1.1.1", PROXY_2: "200.2.2.2" }), log: (line) => logs.push(line), now });
    const second = await runExitHealth({ exits: [exitOf("PROXY_1"), exitOf("PROXY_2", false), exitOf("PROXY_3")], dataDir: dir,
      fetchVia: answers({ PROXY_1: "200.9.9.9", PROXY_3: "200.3.3.3" }, 200), log: (line) => logs.push(line), now });
    expect(second.map((check) => [check.name, check.worse])).toEqual([["PROXY_1", true], ["PROXY_2", true], ["PROXY_3", true]]);
    expect(second[0]).toMatchObject({ previousIp: "200.1.1.1", ip: "200.9.9.9", page: 200 });
    expect(second[1]!.reasons).toEqual(["saída fora do ar"]);
    const incidents = readFileSync(join(dir, INCIDENTS_FILE), "utf8").trim().split("\n");
    expect(incidents).toHaveLength(3);
    expect(incidents[0]).toBe("2026-10-23T09:00:00.000Z PROXY_1 piorou: IP mudou (200.1.1.1 para 200.9.9.9); a página respondeu 200 em vez de 204");
    expect(logs.length).toBe(3);
    expect(readFileSync(join(dir, INCIDENTS_FILE), "utf8")).not.toMatch(/socks5|@/u);
  });

  it("uma saída nova (sem IP anterior) não conta como IP mudado", async () => {
    const [check] = await runExitHealth({ exits: [exitOf("PROXY_1")], fetchVia: answers({ PROXY_1: "1.1.1.1" }) });
    expect(check!.worse).toBe(false);
  });

  it("lê uma página de verdade pela saída (HTTP puro contra servidor local)", async () => {
    const site = createServer((_req, res) => { res.statusCode = 204; res.end(); });
    await new Promise<void>((done) => site.listen(0, "127.0.0.1", done));
    const port = (site.address() as { port: number }).port;
    const exit: Exit = { ...exitOf("PROXY_1"), upstream: { open: async () => {
      const socket = connect(port, "127.0.0.1");
      await new Promise<void>((done, fail) => { socket.once("connect", () => done()); socket.once("error", fail); });
      socket.pause();
      return { join: (client) => { socket.pipe(client); client.pipe(socket); socket.resume(); }, cancel: () => socket.destroy() };
    } } };
    try {
      expect(await fetchViaExit(exit, "http://pagina.test/generate_204")).toEqual({ status: 204, body: "" });
    } finally {
      await new Promise<void>((done) => { site.close(() => done()); site.closeAllConnections(); });
    }
  });

  it("calcula quanto falta para as 06:00 de São Paulo", () => {
    expect(msUntilDaily(6, "America/Sao_Paulo", new Date("2026-10-23T08:00:00Z"))).toBe(60 * 60_000);
    expect(msUntilDaily(6, "America/Sao_Paulo", new Date("2026-10-23T09:00:00Z"))).toBe(24 * 60 * 60_000);
    expect(msUntilDaily(6, "America/Sao_Paulo", new Date("2026-10-23T12:00:00Z"))).toBe(21 * 60 * 60_000);
  });
});
