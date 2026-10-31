import { spawn, type ChildProcess } from "node:child_process";
import { createECDH } from "node:crypto";
import { appendFileSync, chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, expect, it } from "vitest";

import { countsAsUnread, type NotificationLogEntry } from "../shared/notification.ts";
import { removeTempDir, waitForExit } from "./testing/cleanup.ts";
import { freePortBlock } from "./testing/ports.ts";
import { openSse } from "./testing/sse.ts";
import { decryptPush } from "./testing/web-push-receiver.ts";

// The real server, a fake engine and a fake push service on loopback: nothing leaves this machine.

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SERVER_DIR, "..");
const FAKE_CLAUDE = join(SERVER_DIR, "testing", "fake-claude-cli.ts");
const TEST_CAPABILITY_KEY = "notification-lifecycle-fixture-capability";
const PROOF_FILE = process.env.NORDUS_PROOF_FILE;

let child: ChildProcess;
let pushService: Server;
let home = "";
let base = "";
let pushOrigin = "";
let stderr = "";
const pushes: Buffer[] = [];

const proof = (step: string, detail: unknown) => {
  if (PROOF_FILE) appendFileSync(PROOF_FILE, `${new Date().toISOString()} ${step}\n${JSON.stringify(detail, null, 2)}\n\n`);
};

const api = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: any }> => {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...(body ? { "content-type": "application/json" } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: response.status === 204 ? null : await response.json() };
};

const capability = async (botId: string, threadId: string): Promise<Record<string, string>> => {
  const minted = await api("POST", "/api/testing/internal-capability", { botId, threadId, kind: "agents" }, { "x-nordus-test-capability": TEST_CAPABILITY_KEY });
  expect(minted.status).toBe(201);
  return { authorization: `Bearer ${minted.body.token}` };
};

const createBot = async (name: string) => {
  const created = (await api("POST", "/api/bots", {})).body.bot;
  return (await api("PATCH", `/api/bots/${created.id}`, { name, notifications: true, modelSelection: { instanceId: "quick", model: "claude-sonnet-5" } })).body.bot;
};

const feed = async (): Promise<NotificationLogEntry[]> => (await api("GET", "/api/notifications")).body.notifications;

beforeAll(async () => {
  chmodSync(FAKE_CLAUDE, 0o755);
  home = mkdtempSync(join(tmpdir(), "nordus-notification-lifecycle-"));
  const data = join(home, ".nordus");
  mkdirSync(data, { recursive: true });
  writeFileSync(join(data, "config.json"), JSON.stringify({
    instances: { quick: { driver: "claudeAgent", displayName: "Quick fixture", environment: { FAKE_CLAUDE_MODE: "happy" }, config: { cli: FAKE_CLAUDE } } },
  }));
  pushService = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      pushes.push(Buffer.concat(chunks));
      res.writeHead(201).end();
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
      NORDUS_TEST_INTERNAL_CAPABILITY_KEY: TEST_CAPABILITY_KEY,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr!.on("data", (chunk) => (stderr += chunk));
  const deadline = Date.now() + 60_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`server exited ${child.exitCode}: ${stderr}`);
    try {
      if ((await fetch(`${base}/api/health`)).status === 200) break;
    } catch {}
    if (Date.now() >= deadline) throw new Error(`server never became healthy: ${stderr}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}, 90_000);

afterAll(async () => {
  if (child) await waitForExit(child, { signal: "SIGTERM" });
  await new Promise((resolve) => pushService?.close(resolve));
  if (home) await removeTempDir(home);
});

it("speaks Portuguese, carries the card, resolves when answered, and stays quiet at night except for approvals", async () => {
  const receiver = createECDH("prime256v1");
  receiver.generateKeys();
  const auth = Buffer.alloc(16, 7);
  expect((await api("PUT", "/api/push/subscription", {
    subscription: { endpoint: `${pushOrigin}/push/iphone`, keys: { p256dh: receiver.getPublicKey("base64url"), auth: auth.toString("base64url") } }, finished: true, sounds: true,
  })).status).toBe(200);
  const opened = () => JSON.parse(decryptPush(pushes.at(-1)!, receiver.getPrivateKey(), auth));

  const asker = await createBot("DESIGNERGRAFICO");
  const peer = await createBot("Dot");
  const herald = await createBot("Herald");
  expect((await api("PATCH", `/api/bots/${asker.id}`, { approvePeerComms: true, approvalMode: "ask" })).status).toBe(200);
  const stream = await openSse(`${base}/api/events`);

  const askApproval = async (seen?: string) => {
    const asking = api("POST", "/api/internal/coordinate-bots", { botIds: [peer.id], message: "Dot, pode publicar a página?", consult: true }, await capability(asker.id, asker.threadId));
    const frame = await stream.until((candidate) => candidate.kind === "notify" && candidate.notification?.botId === asker.id && candidate.notification?.kind === "approval" && candidate.notification.id !== seen, 20_000);
    return { asking, notification: frame.notification as NotificationLogEntry };
  };

  try {
    const first = await askApproval();
    await expect.poll(() => pushes.length, { timeout: 10_000 }).toBe(1);
    const payload = opened();
    proof("1. Push da aprovação, decifrado no serviço de push falso", payload);
    expect(payload.title).toBe("DESIGNERGRAFICO precisa de você: autorizar falar com @Dot");
    expect(payload.body).toBe("@DESIGNERGRAFICO quer falar com @Dot: Dot, pode publicar a página?");
    expect(payload.requestId).toBe(first.notification.requestId);
    expect(first.notification.requestId).toBeTruthy();

    const unreadBefore = (await feed()).filter(countsAsUnread).length;
    const answered = await api("POST", `/api/bots/${asker.id}/respond`, { requestId: first.notification.requestId, behavior: "deny" });
    expect(answered.status).toBe(200);
    const resolved = await stream.until((candidate) => candidate.kind === "notify.resolved" && candidate.ids?.includes(first.notification.id), 10_000);
    await first.asking;
    const after = await feed();
    const unreadAfter = after.filter(countsAsUnread).length;
    proof("2. Cartão respondido: evento no fio ao vivo e contagem do sino", {
      frame: resolved, entry: after.find((entry) => entry.id === first.notification.id), unreadBefore, unreadAfter,
    });
    expect(after.find((entry) => entry.id === first.notification.id)?.resolvedAt).toBe(resolved.at);
    expect(unreadAfter).toBe(unreadBefore - 1);

    const allNight = { enabled: true, start: "00:00", end: "00:00" };
    expect((await api("PUT", "/api/notifications/quiet-hours", allNight)).status).toBe(200);
    const pushesBefore = pushes.length;
    expect((await api("POST", `/api/bots/${herald.id}/messages`, { text: "termina" })).status).toBe(202);
    const done = await stream.until((candidate) => candidate.kind === "notify" && candidate.notification?.botId === herald.id && candidate.notification?.kind === "done", 20_000);
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    const quietFeed = await feed();
    proof("3. Horário silencioso ligado: tarefa terminada gravada e contada, sem push", {
      quietHours: (await api("GET", "/api/notifications/quiet-hours")).body,
      notification: done.notification, inFeed: quietFeed.some((entry) => entry.id === done.notification.id),
      countsAsUnread: countsAsUnread(quietFeed.find((entry) => entry.id === done.notification.id)!), pushesBefore, pushesAfter: pushes.length,
    });
    expect(pushes.length).toBe(pushesBefore);
    expect(quietFeed.find((entry) => entry.id === done.notification.id)).toMatchObject({ title: "Herald terminou", read: false });

    const second = await askApproval(first.notification.id);
    await expect.poll(() => pushes.length, { timeout: 10_000 }).toBe(pushesBefore + 1);
    proof("4. Horário silencioso ligado: aprovação toca mesmo assim", opened());
    expect(opened()).toMatchObject({ kind: "approval", requestId: second.notification.requestId });
    await api("POST", `/api/bots/${asker.id}/respond`, { requestId: second.notification.requestId, behavior: "deny" });
    await second.asking;
  } finally {
    stream.close();
    for (const bot of [asker, peer, herald]) await api("DELETE", `/api/bots/${bot.id}`).catch(() => undefined);
  }
}, 120_000);
