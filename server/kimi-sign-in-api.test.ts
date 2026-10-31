import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { verificationServerEnvironment } from "../scripts/control-nordus.ts";
import { removeTempDir, waitForExit } from "./testing/cleanup.ts";
import { freePortBlock } from "./testing/ports.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const FAKE_KIMI = join(ROOT, "server/testing/fake-kimi-login-cli.ts");
// A one-off instance name keeps the product fleet's other engines out.
const ID = "fixture-kimi";
let child: ChildProcess | undefined;
let home: string;
let base: string;
let logPath: string;

async function api(method: string, path: string, body?: unknown) {
  const response = await fetch(`${base}${path}`, {
    method, headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15_000),
  });
  return { status: response.status, body: await response.json() as Record<string, any>, headers: response.headers };
}
const kimi = async () => (await api("GET", "/api/instances")).body.instances.find((row: { instanceId: string }) => row.instanceId === ID);
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

describe.skipIf(process.platform === "win32")("Kimi sign-in over HTTP", () => {
  beforeAll(async () => {
    chmodSync(FAKE_KIMI, 0o755);
    home = mkdtempSync(join(tmpdir(), "nordus-kimi-api-"));
    mkdirSync(join(home, "tmp"));
    const port = await freePortBlock([0, 1]);
    base = `http://127.0.0.1:${port}`;
    logPath = join(tmpdir(), `nordus-kimi-api-${port}-${process.pid}.log`);
    writeFileSync(join(home, "config.json"), JSON.stringify({ instances: {
      [ID]: { driver: "kimiAgent", displayName: "Kimi", environment: { NORDUS_DEVICE_AUTH_FIXTURE: "1", FAKE_KIMI_MODE: "approve" }, config: { cli: FAKE_KIMI } },
    } }));
    const log = openSync(logPath, "a", 0o600);
    try {
      child = spawn(process.execPath, ["--experimental-strip-types", join(ROOT, "server/index.ts")], {
        cwd: ROOT, env: verificationServerEnvironment({}, home, port), stdio: ["ignore", log, log],
      });
    } finally { closeSync(log); }
    await vi.waitFor(async () => {
      if (child!.exitCode !== null || child!.signalCode !== null) throw new Error(`Fixture exited: ${logPath}`);
      const health = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1_000) });
      expect(health.status).toBe(200);
    }, { timeout: 20_000, interval: 100 });
  }, 30_000);

  afterAll(async () => {
    await waitForExit(child, { signal: "SIGTERM" });
    if (home) await removeTempDir(home);
  });

  it("lists Kimi signed out, with the in-app code as its sign-in and the terminal command kept", async () => {
    await vi.waitFor(async () => expect((await kimi())?.snapshot?.state).toBe("available"), { timeout: 15_000, interval: 200 });
    expect(await kimi()).toMatchObject({
      driverKind: "kimiAgent",
      snapshot: { state: "available", authenticated: false },
      authentication: { method: "device-code", signOut: false },
      install: { signInCommand: "kimi login" },
    });
  });

  it("starts and cancels: the code goes to this browser, then the login stops", async () => {
    const started = await api("POST", `/api/instances/${ID}/auth/start`, {});
    expect(started.status, JSON.stringify(started.body)).toBe(200);
    expect(started.headers.get("cache-control")).toBe("no-store");
    expect(started.body.auth).toMatchObject({ phase: "waiting", authorizationUrl: "https://www.kimi.com/code/authorize_device?user_code=4F19-U3XI", userCode: "4F19-U3XI", flowId: expect.any(String) });
    const flowId = started.body.auth.flowId as string;
    const pid = Number(readFileSync(join(home, "fake-kimi-login.pid"), "utf8"));
    expect(alive(pid)).toBe(true);
    expect((await api("GET", `/api/instances/${ID}/auth/status?flowId=${flowId}`)).body.auth).toMatchObject({ phase: "waiting", userCode: "4F19-U3XI" });

    const cancelled = await api("POST", `/api/instances/${ID}/auth/cancel`, { flowId });
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
    expect(alive(pid)).toBe(false);
    const status = (await api("GET", `/api/instances/${ID}/auth/status?flowId=${flowId}`)).body.auth;
    expect(status).toMatchObject({ phase: "cancelled", authorizationUrl: null });
    expect(status).not.toHaveProperty("userCode");
    expect(existsSync(join(home, ".kimi-code", "credentials", "kimi-code.json"))).toBe(false);
    expect((await kimi()).snapshot.authenticated).toBe(false);
  });

  it("finishes when the person approves, and Kimi then reads signed in", async () => {
    const started = await api("POST", `/api/instances/${ID}/auth/start`, {});
    expect(started.status, JSON.stringify(started.body)).toBe(200);
    const flowId = started.body.auth.flowId as string;
    writeFileSync(join(home, ".nordus-fake-kimi-approved"), "approve fixture only\n");
    await vi.waitFor(async () => {
      expect((await api("GET", `/api/instances/${ID}/auth/status?flowId=${flowId}`)).body.auth.phase).toBe("succeeded");
    }, { timeout: 10_000, interval: 200 });
    expect((await kimi()).snapshot).toMatchObject({ state: "available", authenticated: true });
  });
});
