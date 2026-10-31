// The fake ACP CLI in "permission" mode (every turn asks to run `echo hi`), on a server with an admin and a member
// whose sessions are issued before boot: the card is asked in words and a typed yes answers it.
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SessionRegistry } from "./sessions.ts";
import { removeTempDir, waitForExit } from "./testing/cleanup.ts";
import { MIN_SEEN_MS } from "./text-approval.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const FAKE_CLI = join(SERVER_DIR, "testing", "fake-acp-cli.ts");
const PORT = 28800 + Math.floor(Math.random() * 10_000);
const BASE = `http://127.0.0.1:${PORT}`;
const posixOnly = describe.skipIf(process.platform === "win32");
const BOSS = "boss@example.test";
const ADA = "ada@example.test";

let child: ChildProcess;
let home: string;
let log = "";
const tokens: Record<string, string> = {};

const api = async (method: string, path: string, body?: unknown, as = BOSS): Promise<{ status: number; body: any }> => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(body ? { "content-type": "application/json" } : {}), authorization: `Bearer ${tokens[as]}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

async function waitFor<T>(read: () => Promise<T | null | undefined>, ms = 30_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out\n${log.slice(-3_000)}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

const messages = async (threadId: string): Promise<any[]> => (await api("GET", `/api/threads/${threadId}/messages?limit=200`)).body.messages ?? [];

async function makeBot(name: string) {
  const created = await api("POST", "/api/bots", { name });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const patched = await api("PATCH", `/api/bots/${created.body.bot.id}`, { modelSelection: { instanceId: "grok", model: "fake-model" }, approvalMode: "ask" });
  expect(patched.status).toBe(200);
  return created.body.bot as { id: string; threadId: string };
}

/** The bot's turn asks to run a command: the card is held and the bot's question shows in the conversation. */
async function asked(bot: { id: string; threadId: string }) {
  expect((await api("POST", `/api/bots/${bot.id}/messages`, { text: "roda o comando", threadId: bot.threadId })).status).toBe(202);
  const question = await waitFor(async () => (await messages(bot.threadId)).find((m) => m.role === "bot" && m.kind === "text" && m.textAsk));
  const card = (await messages(bot.threadId)).find((m) => m.card?.requestId === question.textAsk.requestId);
  await new Promise((r) => setTimeout(r, MIN_SEEN_MS + 200));
  return { question, card };
}

posixOnly("a card asked in words, end to end", () => {
  beforeAll(async () => {
    chmodSync(FAKE_CLI, 0o755);
    home = mkdtempSync(join(tmpdir(), "nordus-text-approval-"));
    const data = join(home, ".nordus");
    mkdirSync(data, { recursive: true });
    writeFileSync(join(data, "config.json"), JSON.stringify({
      signIn: { admins: [BOSS], members: [ADA] },
      instances: { grok: { driver: "grokAgent", environment: { FAKE_ACP_MODE: "permission" }, config: { cli: FAKE_CLI, fullAuto: false } } },
    }));
    const role = (email: string) => (email === BOSS ? ["admin", "client"] as const : ["client"] as const);
    const registry = new SessionRegistry({ file: join(data, "sessions.json"), emailScopes: (email) => [...role(email)] });
    for (const email of [BOSS, ADA]) tokens[email] = registry.issue({ label: `${email.split("@")[0]}'s phone`, email, scopes: [...role(email)] }).token;
    registry.close();
    child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
      cwd: join(SERVER_DIR, ".."),
      env: { ...(process.env.PATH ? { PATH: process.env.PATH } : {}), HOME: home, USERPROFILE: home, NORDUS_PORT: String(PORT), NORDUS_WEBHOOK_PORT: String(PORT + 1) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout!.on("data", (c) => (log += c));
    child.stderr!.on("data", (c) => (log += c));
    await waitFor(async () => (await fetch(`${BASE}/api/health`).catch(() => null))?.ok);
  }, 40_000);

  afterAll(async () => {
    if (child) await waitForExit(child, { signal: "SIGTERM" });
    if (home) await removeTempDir(home);
  });

  it("the bot asks in words, the card is not drawn, and an admin's typed yes runs the action with no new turn", async () => {
    const bot = await makeBot("Pergunta");
    const { question, card } = await asked(bot);
    expect(question.text).toMatch(/\?$/);
    expect(card.card.byText).toBe(true);
    const sent = await api("POST", `/api/bots/${bot.id}/messages`, { text: "sim", threadId: bot.threadId });
    expect(sent.status, JSON.stringify(sent.body)).toBe(202);
    expect(sent.body.message).toMatchObject({ text: "sim", answersAsk: { reply: "yes" } });
    const settled = await waitFor(async () => (await messages(bot.threadId)).find((m) => m.id === card.id && m.card.answered));
    expect(settled.card).toMatchObject({ answered: "allow", answeredBy: { kind: "session", name: BOSS } });
    await waitFor(async () => (await messages(bot.threadId)).some((m) => m.role === "bot" && m.text === "handled the permission decision"));
    // The yes started no turn of its own: the engine asked once, for the one message that started the work.
    expect((await messages(bot.threadId)).filter((m) => m.role === "bot" && m.textAsk)).toHaveLength(1);
  }, 90_000);

  it("a member's yes frees nothing", async () => {
    const bot = await makeBot("Membro");
    const { card } = await asked(bot);
    await api("POST", `/api/bots/${bot.id}/messages`, { text: "sim", threadId: bot.threadId }, ADA);
    await new Promise((r) => setTimeout(r, 1_000));
    expect((await messages(bot.threadId)).find((m) => m.id === card.id).card.answered).toBeUndefined();
  }, 90_000);
});
