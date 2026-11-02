import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runContaLogin, type CliIo, type CliOptions } from "./cli.ts";
import { CONTA_FILE, contaTunnelAccess, readContaLink } from "./conta-nordus.ts";
import { GoogleLoginStore } from "./google-login.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const CREDENTIAL = `nordus_install_${"a".repeat(22)}.${"b".repeat(43)}`;
const INSTALLATION = "0b7f6c2e-6a43-4c1e-9d55-3f6f1c2b9a10";

function fakeConta(pendingPolls: number) {
  const calls: Array<{ path: string; body: any; auth: string | null }> = [];
  let polls = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ path: url.pathname, body, auth: new Headers(init?.headers).get("authorization") });
    if (url.pathname === "/v1/ativacoes") {
      return Response.json({ deviceCode: "d".repeat(43), userCode: "BCDF-GHJK", verificationUrl: "https://conta.nordus.ai/ativar?codigo=BCDF-GHJK", intervalSeconds: 3, expiresInSeconds: 900 });
    }
    if (url.pathname === "/v1/ativacoes/verificar") {
      if (polls++ < pendingPolls) return Response.json({ error: "authorization_pending" }, { status: 428 });
      return Response.json({ installationId: INSTALLATION, credential: CREDENTIAL, address: "https://loja-da-ana.nordus.ai", email: "Ana@Example.com".toLowerCase(), controlPlane: "https://conta.nordus.ai" });
    }
    if (url.pathname === "/v1/installations/self/endpoint") {
      return Response.json({ endpoint: { url: "https://loja-da-ana.nordus.ai", status: "ready" }, connectorToken: "t".repeat(40) });
    }
    return new Response(null, { status: 404 });
  };
  return { calls, fetchImpl };
}

function setup() {
  const dataDir = mkdtempSync(join(tmpdir(), "nordus-conta-"));
  dirs.push(dataDir);
  const lines: string[] = [];
  const io: CliIo = { log: (line) => lines.push(line), error: (line) => lines.push(`ERR ${line}`), ask: async () => "" };
  const options = { command: "login", port: 1, dataDir, tailscale: false, tunnel: false, client: false, pair: true, json: false, label: "MacBook da Ana" } as CliOptions;
  return { dataDir, lines, io, options };
}

describe("nordus login with a Nordus account", () => {
  it("shows the link and code, waits for the confirmation, then saves the address, the Google sign-in and the owner", async () => {
    const { dataDir, lines, io, options } = setup();
    const conta = fakeConta(2);
    expect(await runContaLogin(options, io, { fetchImpl: conta.fetchImpl, sleep: async () => {} })).toBe(0);

    expect(lines.join("\n")).toContain("https://conta.nordus.ai/ativar?codigo=BCDF-GHJK");
    expect(lines.join("\n")).toContain("BCDF-GHJK");
    expect(conta.calls[0]).toMatchObject({ path: "/v1/ativacoes", body: { machine: "MacBook da Ana", credentialPrefix: "nordus_install_" } });
    expect(conta.calls.filter((call) => call.path === "/v1/ativacoes/verificar")).toHaveLength(3);

    const link = readContaLink(dataDir)!;
    expect(link).toMatchObject({ installationId: INSTALLATION, address: "https://loja-da-ana.nordus.ai", email: "ana@example.com" });
    if (process.platform !== "win32") expect(statSync(join(dataDir, CONTA_FILE)).mode & 0o077).toBe(0);
    expect(new GoogleLoginStore(dataDir).status()).toMatchObject({ configured: true, clientId: INSTALLATION, conta: "https://conta.nordus.ai" });
    const config = JSON.parse(readFileSync(join(dataDir, "config.json"), "utf8"));
    expect(config.signIn.admins).toContain("ana@example.com");

    const access = await contaTunnelAccess(link, { fetchImpl: conta.fetchImpl });
    expect(access).toEqual({ endpoint: "https://loja-da-ana.nordus.ai", token: "t".repeat(40) });
    expect(conta.calls.at(-1)?.auth).toBe(`Bearer ${CREDENTIAL}`);
  });

  it("shows a new code when one expires, and stops with a clear message after the last", async () => {
    const { dataDir, lines, io, options } = setup();
    let started = 0;
    const fetchImpl: typeof fetch = async (input) => {
      const path = new URL(String(input)).pathname;
      if (path === "/v1/ativacoes") {
        started++;
        return Response.json({ deviceCode: "d".repeat(43), userCode: "BCDF-GHJK", verificationUrl: "https://conta.nordus.ai/ativar?codigo=BCDF-GHJK", intervalSeconds: 3, expiresInSeconds: 900 });
      }
      return Response.json({ error: "expired_token" }, { status: 410 });
    };
    expect(await runContaLogin(options, io, { fetchImpl, sleep: async () => {}, codes: 3 })).toBe(1);
    expect(started).toBe(3);
    expect(lines.filter((line) => line.includes("Here is a new one"))).toHaveLength(2);
    expect(lines.at(-1)).toContain("run login again");
    expect(readContaLink(dataDir)).toBeNull();
    expect(new GoogleLoginStore(dataDir).status().configured).toBe(false);
  });

  it("refuses an answer that points the person at another site", async () => {
    const { io, options, lines } = setup();
    const fetchImpl: typeof fetch = async () => Response.json({ deviceCode: "d".repeat(43), userCode: "BCDF-GHJK", verificationUrl: "https://evil.example/ativar", intervalSeconds: 3, expiresInSeconds: 900 });
    expect(await runContaLogin(options, io, { fetchImpl, sleep: async () => {} })).toBe(1);
    expect(lines.join("\n")).toContain("another site");
  });
});
