import { spawn, type ChildProcess } from "node:child_process";
import { createECDH, createPublicKey, verify } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, expect, it } from "vitest";

import { removeTempDir, waitForExit } from "./testing/cleanup.ts";
import { freePortBlock } from "./testing/ports.ts";
import { openSse } from "./testing/sse.ts";
import { decryptPush } from "./testing/web-push-receiver.ts";

// The real server, a fake engine and a fake push service on loopback: nothing leaves this machine.

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SERVER_DIR, "..");
const FAKE_CLAUDE = join(SERVER_DIR, "testing", "fake-claude-cli.ts");

let child: ChildProcess;
let pushService: Server;
let home = "";
let data = "";
let base = "";
let pushOrigin = "";
let stderr = "";
let pushStatus = 201;
const pushes: Array<{ path: string; headers: Record<string, string | string[] | undefined>; body: Buffer }> = [];

const api = async (method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> => {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: response.status === 204 ? null : await response.json() };
};

beforeAll(async () => {
  chmodSync(FAKE_CLAUDE, 0o755);
  home = mkdtempSync(join(tmpdir(), "nordus-web-push-e2e-"));
  data = join(home, ".nordus");
  mkdirSync(data, { recursive: true });
  writeFileSync(join(data, "config.json"), JSON.stringify({
    instances: { quick: { driver: "claudeAgent", displayName: "Quick fixture", environment: { FAKE_CLAUDE_MODE: "happy" }, config: { cli: FAKE_CLAUDE } } },
  }));
  pushService = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      pushes.push({ path: req.url ?? "", headers: req.headers, body: Buffer.concat(chunks) });
      res.writeHead(pushStatus).end();
    });
  });
  await new Promise<void>((resolve) => pushService.listen(0, "127.0.0.1", resolve));
  const address = pushService.address();
  pushOrigin = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;

  const port = await freePortBlock([0, 1]);
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
    cwd: ROOT,
    env: {
      ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
      HOME: home,
      USERPROFILE: home,
      NORDUS_PORT: String(port),
      NORDUS_WEBHOOK_PORT: String(port + 1),
      NORDUS_WEB_PUSH_TEST_ORIGIN: pushOrigin,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr!.on("data", (chunk) => (stderr += chunk));
  const deadline = Date.now() + 20_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`server exited ${child.exitCode}: ${stderr}`);
    try {
      if ((await fetch(`${base}/api/health`)).status === 200) break;
    } catch {}
    if (Date.now() >= deadline) throw new Error(`server never became healthy: ${stderr}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}, 45_000);

afterAll(async () => {
  if (child) await waitForExit(child, { signal: "SIGTERM" });
  await new Promise((resolve) => pushService?.close(resolve));
  if (home) await removeTempDir(home);
});

it("pushes the notify frame to a closed device, holds it while the page is visible, and drops a gone subscription", async () => {
  const receiver = createECDH("prime256v1");
  receiver.generateKeys();
  const auth = Buffer.alloc(16, 9);
  const endpoint = `${pushOrigin}/push/device-1`;
  const { publicKey } = (await api("GET", "/api/push/key")).body;

  // A free-form endpoint is refused: the server would POST to it.
  expect((await api("PUT", "/api/push/subscription", {
    subscription: { endpoint: "https://example.com/hook", keys: { p256dh: receiver.getPublicKey("base64url"), auth: auth.toString("base64url") } }, finished: true, sounds: true,
  })).status).toBe(400);
  expect((await api("PUT", "/api/push/subscription", {
    subscription: { endpoint, keys: { p256dh: receiver.getPublicKey("base64url"), auth: auth.toString("base64url") } }, finished: true, sounds: false,
  })).status).toBe(200);

  const created = (await api("POST", "/api/bots", {})).body.bot;
  const bot = (await api("PATCH", `/api/bots/${created.id}`, { name: "Herald", notifications: true, modelSelection: { instanceId: "quick", model: "claude-sonnet-5" } })).body.bot;
  const stream = await openSse(`${base}/api/events`);
  const turn = async (text: string) => {
    expect((await api("POST", `/api/bots/${bot.id}/messages`, { text })).status).toBe(202);
    return stream.until((frame) => frame.kind === "notify" && frame.notification?.botId === bot.id && frame.notification?.kind === "done", 20_000);
  };
  try {
    // The page is open and visible: it shows its own banner, so no push.
    expect((await api("POST", "/api/push/presence", { page: "page-e2e-0001", visible: true })).status).toBe(200);
    await turn("first");
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    expect(pushes).toHaveLength(0);

    // The page went away: the same kind of frame becomes a push.
    expect((await api("POST", "/api/push/presence", { page: "page-e2e-0001", visible: false })).status).toBe(200);
    const frame = await turn("second");
    await expect.poll(() => pushes.length, { timeout: 10_000 }).toBe(1);
    const push = pushes[0]!;
    expect(push.path).toBe("/push/device-1");
    expect(push.headers).toMatchObject({ "content-encoding": "aes128gcm", ttl: "86400", urgency: "high" });
    expect(JSON.parse(decryptPush(push.body, receiver.getPrivateKey(), auth))).toEqual({
      title: frame.notification.title, body: frame.notification.body, tag: `nordus:${bot.id}`,
      botId: bot.id, threadId: frame.notification.threadId, kind: "done", silent: true,
    });

    const [, jwt, k] = /^vapid t=([\w.-]+), k=([\w-]+)$/.exec(String(push.headers.authorization))!;
    expect(k).toBe(publicKey);
    const [head, claims, signature] = jwt!.split(".");
    expect(JSON.parse(Buffer.from(claims!, "base64url").toString())).toMatchObject({ aud: pushOrigin, sub: "https://nordus.ai" });
    const point = Buffer.from(publicKey, "base64url");
    const key = createPublicKey({ key: { kty: "EC", crv: "P-256", x: point.subarray(1, 33).toString("base64url"), y: point.subarray(33).toString("base64url") }, format: "jwk" });
    expect(verify("sha256", Buffer.from(`${head}.${claims}`), { key, dsaEncoding: "ieee-p1363" }, Buffer.from(signature!, "base64url"))).toBe(true);

    // The browser dropped it: the push service answers 410 and the server forgets the device.
    pushStatus = 410;
    await turn("third");
    await expect.poll(() => pushes.length, { timeout: 10_000 }).toBe(2);
    await expect.poll(() => JSON.parse(readFileSync(join(data, "web-push-subscriptions.json"), "utf8")), { timeout: 5_000 }).toEqual([]);
    await turn("fourth");
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    expect(pushes).toHaveLength(2);
  } finally {
    stream.close();
    await api("DELETE", `/api/bots/${bot.id}`).catch(() => undefined);
  }
}, 90_000);
