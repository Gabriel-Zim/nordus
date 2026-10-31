// The real server with the fake engine in "permission" mode (every turn asks to run a command), a fake push service on
// loopback, and an email sign-in list naming one administrator and two members: nothing leaves this machine.
import { spawn, type ChildProcess } from "node:child_process";
import { createECDH } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { APPROVAL_TTL_MS } from "../shared/approvals.ts";
import type { DecisionRow } from "./decision-log.ts";
import { SessionRegistry } from "./sessions.ts";
import { removeTempDir, waitForExit } from "./testing/cleanup.ts";
import { freePortBlock } from "./testing/ports.ts";
import { decryptPush } from "./testing/web-push-receiver.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const FAKE_CLI = join(SERVER_DIR, "testing", "fake-acp-cli.ts");
const posixOnly = describe.skipIf(process.platform === "win32");
const BOSS = "boss@example.test";
const ADA = "ada@example.test";
const BOB = "bob@example.test";
const CAPABILITY_KEY = "approvals-fixture-capability";
const HANDLED = "handled the permission decision";
const GIT_PUSH = JSON.stringify({ kind: "execute", rawInput: { command: "git push origin main" }, title: "git push origin main" });

let child: ChildProcess;
let pushService: Server;
let home: string;
let base = "";
let port = 0;
let pushOrigin = "";
let log = "";
const tokens: Record<string, string> = {};
const sessionIds: Record<string, string> = {};
const pushes: Array<{ path: string; body: Buffer }> = [];

const api = async (method: string, path: string, body?: unknown, as?: string): Promise<{ status: number; body: any }> => {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(as ? { authorization: `Bearer ${tokens[as]}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

async function waitFor<T>(read: () => Promise<T | null | undefined>, ms = 60_000): Promise<T | null> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline) return null;
    await new Promise((r) => setTimeout(r, 250));
  }
}

const listFor = async (as?: string) => (await api("GET", "/api/approvals", undefined, as)).body.items as any[];
const waitingFor = (botId: string, as: string = BOSS) => waitFor(async () => (await listFor(as)).find((item) => item.botId === botId) ?? null);
const messagesOf = async (threadId: string) => (await api("GET", `/api/threads/${threadId}/messages`, undefined, BOSS)).body.messages as any[];
const decision = (requestId: string, kind: DecisionRow["decision"]) => waitFor(async () => {
  const { body } = await api("GET", "/api/decisions", undefined, BOSS);
  return ((body.decisions ?? []) as DecisionRow[]).find((row) => row.requestId === requestId && row.decision === kind) ?? null;
});

async function makeBot(name: string, instanceId = "grok", extra: Record<string, unknown> = {}) {
  const created = await api("POST", "/api/bots", { name }, BOSS);
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const patched = await api("PATCH", `/api/bots/${created.body.bot.id}`, { modelSelection: { instanceId, model: "fake-model" }, approvalMode: "ask", ...extra }, BOSS);
  expect(patched.status, JSON.stringify(patched.body)).toBe(200);
  return created.body.bot as { id: string; threadId: string; name: string };
}

async function ask(bot: { id: string; threadId: string }) {
  const sent = await api("POST", `/api/bots/${bot.id}/messages`, { text: "run it", threadId: bot.threadId }, BOSS);
  expect(sent.status, JSON.stringify(sent.body)).toBe(202);
  const item = await waitingFor(bot.id);
  expect(item, `no approval appeared:\n${log.slice(-2_000)}`).not.toBeNull();
  return item;
}

const turnContinued = (threadId: string) => waitFor(async () => (await messagesOf(threadId)).find((message) => message.role === "bot" && String(message.text ?? "").includes(HANDLED)) ?? null);

const receiver = createECDH("prime256v1");
receiver.generateKeys();
const receiverAuth = Buffer.alloc(16, 9);

async function subscribeDevice(as: string, name: string) {
  const subscribed = await api("PUT", "/api/push/subscription", {
    subscription: { endpoint: `${pushOrigin}/push/${name}`, keys: { p256dh: receiver.getPublicKey("base64url"), auth: receiverAuth.toString("base64url") } },
    finished: true, sounds: false,
  }, as);
  expect(subscribed.status, JSON.stringify(subscribed.body)).toBe(200);
}

const pushFor = (name: string, nth = 0) => waitFor(async () => {
  const mine = pushes.filter((push) => push.path === `/push/${name}`);
  return mine[nth] ? JSON.parse(decryptPush(mine[nth]!.body, receiver.getPrivateKey(), receiverAuth)) : null;
}, 60_000);

async function boot() {
  child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
    cwd: join(SERVER_DIR, ".."),
    env: {
      ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
      HOME: home, USERPROFILE: home, NORDUS_PORT: String(port), NORDUS_WEBHOOK_PORT: String(port + 1),
      NORDUS_TEST_INTERNAL_CAPABILITY_KEY: CAPABILITY_KEY, NORDUS_WEB_PUSH_TEST_ORIGIN: pushOrigin,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout!.on("data", (c) => (log += c));
  child.stderr!.on("data", (c) => (log += c));
  const deadline = Date.now() + 150_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`server exited ${child.exitCode}:\n${log}`);
    try {
      if ((await fetch(`${base}/api/health`)).ok) return;
    } catch {
    }
    if (Date.now() > deadline) throw new Error(`server never came up:\n${log}`);
    await new Promise((r) => setTimeout(r, 150));
  }
}

posixOnly("the approvals inbox, end to end", () => {
  beforeAll(async () => {
    chmodSync(FAKE_CLI, 0o755);
    home = mkdtempSync(join(tmpdir(), "nordus-approvals-"));
    const data = join(home, ".nordus");
    mkdirSync(data, { recursive: true });
    writeFileSync(join(data, "config.json"), JSON.stringify({
      signIn: { admins: [BOSS], members: [ADA, BOB] },
      instances: {
        grok: { driver: "grokAgent", environment: { FAKE_ACP_MODE: "permission" }, config: { cli: FAKE_CLI, fullAuto: false } },
        grokpush: { driver: "grokAgent", environment: { FAKE_ACP_MODE: "permission", FAKE_ACP_PERMISSION_TOOL_CALL: GIT_PUSH }, config: { cli: FAKE_CLI, fullAuto: false } },
      },
    }));
    const role = (email: string) => (email === BOSS ? ["admin", "client"] as const : ["client"] as const);
    const registry = new SessionRegistry({ file: join(data, "sessions.json"), emailScopes: (email) => [...role(email)] });
    for (const email of [BOSS, ADA, BOB]) {
      const issued = registry.issue({ label: `${email.split("@")[0]}'s phone`, email, scopes: [...role(email)] });
      tokens[email] = issued.token;
      sessionIds[email] = issued.session.id;
    }
    registry.close();

    pushService = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        pushes.push({ path: req.url ?? "", body: Buffer.concat(chunks) });
        res.writeHead(201).end();
      });
    });
    await new Promise<void>((resolve) => pushService.listen(0, "127.0.0.1", resolve));
    const address = pushService.address();
    pushOrigin = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;

    port = await freePortBlock([0, 1]);
    base = `http://127.0.0.1:${port}`;
    await boot();
  }, 180_000);

  afterAll(async () => {
    if (child) await waitForExit(child, { signal: "SIGTERM" });
    await new Promise((resolve) => pushService?.close(resolve));
    if (home) await removeTempDir(home);
  });

  it("lists a permission that waits, with what to decide on, and approving it from the list lets the turn go on", async () => {
    const bot = await makeBot("Atlas");
    const item = await ask(bot);
    expect(item).toMatchObject({
      kind: "permission", botId: bot.id, botName: "Atlas", threadId: bot.threadId, decider: "Administradores", canDecide: true, action: "decide",
      requestId: expect.any(String), id: `${bot.threadId}.${item.messageId}`,
    });
    expect(item.title).toContain("Atlas");
    expect(item.fields.at(-1)).toMatchObject({ label: "Quem decide", value: "Administradores" });
    expect(item.fields.map((field: any) => field.label)).toContain("Ação");
    expect(item.expiresAt - item.requestedAt).toBe(APPROVAL_TTL_MS);

    const stamped = (await messagesOf(bot.threadId)).find((message) => message.id === item.messageId);
    await expect.poll(async () => (await messagesOf(bot.threadId)).find((message) => message.id === item.messageId)?.card?.approval?.expiresAt, { timeout: 20_000 })
      .toBe(stamped.at + APPROVAL_TTL_MS);

    const approved = await api("POST", `/api/approvals/${item.id}/approve`, {}, BOSS);
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect(approved.body.outcome).not.toBe("unavailable");
    expect(await turnContinued(bot.threadId), `the turn never went on:\n${log.slice(-2_000)}`).not.toBeNull();
    expect((await decision(item.requestId, "user-approved"))?.actor).toMatchObject({ kind: "session", sessionId: sessionIds[BOSS], email: BOSS });
    expect((await listFor(BOSS)).some((waiting) => waiting.id === item.id)).toBe(false);
    const settled = (await messagesOf(bot.threadId)).find((message) => message.id === item.messageId);
    expect(settled.card.answeredBy).toEqual({ kind: "session", name: BOSS });
  }, 180_000);

  it("keeps a decline's reason on the card and proposes it as a lesson from the refusal, to make a rule or to discard", async () => {
    const bot = await makeBot("Pepper");
    const item = await ask(bot);
    const declined = await api("POST", `/api/approvals/${item.id}/decline`, { reason: "  agora não, falta revisar  " }, BOSS);
    expect(declined.status, JSON.stringify(declined.body)).toBe(200);
    expect(declined.body.lesson).toMatchObject({ requestId: expect.any(String), messageId: expect.any(String) });
    expect((await decision(item.requestId, "user-denied"))?.actor).toMatchObject({ kind: "session", email: BOSS });
    expect(await turnContinued(bot.threadId)).not.toBeNull();

    const messages = await messagesOf(bot.threadId);
    expect(messages.find((message) => message.id === item.messageId)?.card).toMatchObject({ approval: { declinedWhy: "agora não, falta revisar" } });
    const lesson = messages.find((message) => message.card?.tool === "propose_lesson");
    expect(lesson?.card).toMatchObject({
      requestId: declined.body.lesson.requestId,
      options: ["Make it a rule", "Discard"],
      approval: { fromRefusal: true },
      lessonRequest: { lesson: expect.stringContaining("agora não, falta revisar") },
    });

    const proposed = await waitFor(async () => (await listFor(BOSS)).find((waiting) => waiting.requestId === declined.body.lesson.requestId) ?? null);
    expect(proposed).toMatchObject({ kind: "lesson", action: "decide", canDecide: true });
    expect(proposed.title).toContain("a partir da sua recusa");
    expect(proposed.risk).toBe("normal");
    expect(proposed.expiresAt).toBeUndefined();

    const discarded = await api("POST", `/api/approvals/${proposed.id}/decline`, {}, BOSS);
    expect(discarded.status, JSON.stringify(discarded.body)).toBe(200);
    await expect.poll(async () => (await listFor(BOSS)).some((waiting) => waiting.id === proposed.id), { timeout: 20_000 }).toBe(false);
  }, 180_000);

  it("turns a lesson from a refusal into a rule when it is approved from the list", async () => {
    const bot = await makeBot("Mira");
    const item = await ask(bot);
    const declined = await api("POST", `/api/approvals/${item.id}/decline`, { reason: "só depois do almoço" }, BOSS);
    expect(declined.status).toBe(200);
    const proposed = await waitFor(async () => (await listFor(BOSS)).find((waiting) => waiting.requestId === declined.body.lesson.requestId) ?? null);
    expect(proposed).not.toBeNull();
    const made = await api("POST", `/api/approvals/${proposed.id}/approve`, {}, BOSS);
    expect(made.status, JSON.stringify(made.body)).toBe(200);
    await expect.poll(async () => (await listFor(BOSS)).some((waiting) => waiting.id === proposed.id), { timeout: 20_000 }).toBe(false);
    const card = (await messagesOf(bot.threadId)).find((message) => message.card?.requestId === declined.body.lesson.requestId)?.card;
    expect(card?.answered).toBe("allow");
  }, 180_000);

  it("shows a member only the bots they are shown, in the list and in the inbox, and never lets them decide", async () => {
    const open = await makeBot("Aberto");
    const secret = await makeBot("Reservado", "grok", { visibility: "admins" });
    const chosen = await makeBot("Escolhido", "grok", { visibility: { people: [ADA] } });
    const items = {
      open: await ask(open),
      secret: await ask(secret),
      chosen: await ask(chosen),
    };
    expect((await listFor(BOSS)).map((item) => item.botId)).toEqual(expect.arrayContaining([open.id, secret.id, chosen.id]));

    const seenByAda = (await listFor(ADA)).map((item) => item.botId);
    expect(seenByAda).toEqual(expect.arrayContaining([open.id, chosen.id]));
    expect(seenByAda).not.toContain(secret.id);
    const seenByBob = (await listFor(BOB)).map((item) => item.botId);
    expect(seenByBob).toContain(open.id);
    expect(seenByBob).not.toContain(secret.id);
    expect(seenByBob).not.toContain(chosen.id);
    expect((await listFor(ADA)).find((item) => item.botId === open.id)).toMatchObject({ canDecide: false, decider: "Administradores" });

    for (const as of [ADA, BOB]) {
      const inbox = await api("GET", "/api/inbox", undefined, as);
      expect(inbox.status).toBe(200);
      expect(Object.keys(inbox.body).sort()).toEqual(["before", "forYou", "waiting"]);
      expect(JSON.stringify(inbox.body)).not.toContain("Reservado");
      expect(inbox.body.waiting.map((waiting: any) => waiting.botId)).toContain(open.id);
    }
    expect(JSON.stringify((await api("GET", "/api/inbox", undefined, BOB)).body)).not.toContain("Escolhido");
    expect((await api("GET", "/api/inbox", undefined, BOSS)).body.waiting.map((waiting: any) => waiting.botId)).toContain(secret.id);

    const hidden = await api("POST", `/api/approvals/${items.secret.id}/approve`, {}, ADA);
    expect(hidden.status).toBe(404);
    const notTheirs = await api("POST", `/api/approvals/${items.open.id}/approve`, {}, ADA);
    expect(notTheirs.status).toBe(403);
    expect(notTheirs.body.error).toContain("Administradores");
    expect((await api("POST", `/api/approvals/${items.open.id}/decline`, { reason: "x" }, BOB)).status).toBe(403);
    expect((await listFor(BOSS)).some((waiting) => waiting.id === items.open.id)).toBe(true);
  }, 180_000);

  it("keeps the wait setting to administrators and counts new requests from it", async () => {
    const asMember = await api("PUT", "/api/approvals/settings", { ttlMs: 3_600_000 }, ADA);
    expect(asMember.status).toBe(403);
    expect((await api("GET", "/api/approvals/settings", undefined, ADA)).status).toBe(403);
    const set = await api("PUT", "/api/approvals/settings", { ttlMs: 3_600_000 }, BOSS);
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    expect(set.body.ttlMs).toBe(3_600_000);
    try {
      const bot = await makeBot("Curto");
      const item = await ask(bot);
      expect(item.expiresAt - item.requestedAt).toBe(3_600_000);
    } finally {
      expect((await api("PUT", "/api/approvals/settings", { ttlMs: APPROVAL_TTL_MS }, BOSS)).status).toBe(200);
    }
  }, 180_000);

  it("puts Approve and Decline on the phone's banner, with a token that works once and only for that person", async () => {
    await subscribeDevice(BOSS, "boss-phone");
    const bot = await makeBot("Celular");
    const sent = await api("POST", `/api/bots/${bot.id}/messages`, { text: "run it", threadId: bot.threadId }, BOSS);
    expect(sent.status).toBe(202);
    const banner = await pushFor("boss-phone");
    expect(banner, `no push arrived:\n${log.slice(-2_000)}`).not.toBeNull();
    expect(banner.actions).toEqual([{ action: "approve", title: "Aprovar" }, { action: "decline", title: "Recusar" }]);
    expect(banner.title).toContain("Celular");
    expect(banner.body).toMatch(/Pediu aos administradores\.$/);
    expect(banner.approval).toMatchObject({ token: expect.stringMatching(/^[\w-]{20,}$/), done: { approve: "Aprovado por você · enviado", decline: "Recusado por você" } });
    const item = await waitingFor(bot.id);
    expect(banner.approval.id).toBe(item.id);
    const token = banner.approval.token as string;

    const forged = await api("POST", `/api/approvals/${item.id}/approve`, { token: "made-up-token-value" }, BOSS);
    expect(forged.status).toBe(403);
    expect(forged.body.code).toBe("token-unknown");

    const asOwnerMachine = await api("POST", `/api/approvals/${item.id}/approve`, { token });
    expect(asOwnerMachine.status).toBe(403);
    expect(asOwnerMachine.body.code).toBe("token-wrong-person");
    expect((await listFor(BOSS)).some((waiting) => waiting.id === item.id)).toBe(true);
  }, 180_000);

  it("approves from the banner with a fresh token, once, as the person it was issued to", async () => {
    const bot = await makeBot("Celular dois");
    const before = pushes.filter((push) => push.path === "/push/boss-phone").length;
    const sent = await api("POST", `/api/bots/${bot.id}/messages`, { text: "run it", threadId: bot.threadId }, BOSS);
    expect(sent.status).toBe(202);
    const banner = await pushFor("boss-phone", before);
    expect(banner?.approval?.token, `no push arrived:\n${log.slice(-2_000)}`).toBeTruthy();
    const item = await waitingFor(bot.id);
    const approved = await api("POST", `/api/approvals/${item.id}/approve`, { token: banner.approval.token }, BOSS);
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect(await turnContinued(bot.threadId)).not.toBeNull();
    expect((await decision(item.requestId, "user-approved"))?.actor).toMatchObject({ kind: "session", email: BOSS });
    const again = await api("POST", `/api/approvals/${item.id}/approve`, { token: banner.approval.token }, BOSS);
    expect(again.status).toBe(404);
  }, 180_000);

  it("never offers a critical action on the banner, and holds it as critical in the list", async () => {
    const bot = await makeBot("Publica", "grokpush");
    const before = pushes.filter((push) => push.path === "/push/boss-phone").length;
    const item = await ask(bot);
    expect(item.risk, JSON.stringify(item)).toBe("critical");
    const banner = await pushFor("boss-phone", before);
    expect(banner, `no push arrived:\n${log.slice(-2_000)}`).not.toBeNull();
    expect(banner.actions).toBeUndefined();
    expect(banner.approval).toBeUndefined();
    expect(banner.requestId).toBe(item.requestId);

    const refused = await api("POST", `/api/approvals/${item.id}/approve`, { token: "any-token-at-all" }, BOSS);
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe("critical");
    expect((await listFor(BOSS)).some((waiting) => waiting.id === item.id)).toBe(true);
  }, 180_000);

  it("keeps the deadline on the card across a restart, and does not offer again what the restart ended", async () => {
    const bot = await makeBot("Reinicio");
    const item = await ask(bot);
    const stamped = await waitFor(async () => (await messagesOf(bot.threadId)).find((message) => message.id === item.messageId)?.card?.approval?.expiresAt);
    expect(stamped).toBe(item.expiresAt);
    await waitForExit(child, { signal: "SIGTERM" });
    await boot();

    expect((await listFor(BOSS)).some((waiting) => waiting.id === item.id)).toBe(false);
    const card = (await messagesOf(bot.threadId)).find((message) => message.id === item.messageId)?.card;
    expect(card, log.slice(-2_000)).toMatchObject({ approval: { expiresAt: item.expiresAt }, dismissed: true });
  }, 300_000);
});
