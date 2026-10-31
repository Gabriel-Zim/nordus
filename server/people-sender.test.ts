import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { verificationServerArgs, verificationServerEnvironment } from "../scripts/control-nordus.ts";
import { removeTempDir, waitForExit } from "./testing/cleanup.ts";
import { startControlPlaneStub, type ControlPlaneStub } from "./testing/control-plane-stub.ts";
import { freePortBlock } from "./testing/ports.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const HOST = "acme.agentada.test";
const OWNER_NAME = "Gabe";
const OWNER_EMAIL = "Gabe@Acme.test";
const MEMBER = "ronny@acme.test";
const ABOUT_ME = "Gabe drinks oolong and runs standups on Tuesday.";

let port: number;
let dataDir: string;
let child: ChildProcess;
let stub: ControlPlaneStub;
let botId = "";
let threadId = "";

interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: any;
}

function send(path: string, init: { method?: string; body?: unknown; cookie?: string }, headers: Record<string, string>): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const payload = init.body === undefined ? undefined : JSON.stringify(init.body);
    const req = httpRequest(
      {
        hostname: "127.0.0.1",
        port,
        path,
        signal: AbortSignal.timeout(10_000),
        method: init.method ?? (payload ? "POST" : "GET"),
        headers: { ...headers, ...(payload ? { "content-type": "application/json" } : {}), ...(init.cookie ? { cookie: init.cookie } : {}) },
      },
      (res) => {
        let raw = "";
        res.on("error", reject);
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => {
          let body: unknown = raw;
          try {
            body = JSON.parse(raw);
          } catch {
          }
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body });
        });
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const loopback = (path: string, init: { method?: string; body?: unknown } = {}) =>
  send(path, init, { host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}` });

const remote = (path: string, init: { method?: string; body?: unknown; cookie?: string } = {}) =>
  send(path, init, { host: HOST, "x-forwarded-for": "203.0.113.7", "x-forwarded-proto": "https", origin: `https://${HOST}` });

async function signIn(email: string): Promise<string> {
  expect((await remote("/api/auth/email/start", { body: { email } })).status).toBe(200);
  const verified = await remote("/api/auth/email/verify", { body: { email, code: stub.otp, label: `${email}'s laptop` } });
  expect(verified.status).toBe(200);
  const raw = verified.headers["set-cookie"];
  return ((Array.isArray(raw) ? raw[0] : raw) ?? "").split(";")[0];
}

interface Dump { prompt: unknown; systemPrompt: string }

const dumpPath = () => join(dataDir, "turn-dump.json");
/** While it is missing, every engine turn stays open. */
const finishGate = () => join(dataDir, "finish-turns");

/** The engine's view of the turn whose message carries `marker`, once the bot is idle again. */
async function turnSent(marker: string): Promise<{ prompt: string; systemPrompt: string }> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (existsSync(dumpPath())) {
      const dump = JSON.parse(readFileSync(dumpPath(), "utf8")) as Dump;
      const prompt = JSON.stringify(dump.prompt);
      const bot = (await loopback("/api/bots")).body.bots.find((b: { id: string }) => b.id === botId);
      if (prompt.includes(marker) && bot && !bot.busy) return { prompt, systemPrompt: dump.systemPrompt };
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`no settled turn for ${marker}`);
}

async function say(text: string, init: { cookie?: string; replyToId?: string; thread?: string } = {}): Promise<{ id: string; queued: boolean }> {
  const body = { text, threadId: init.thread ?? threadId, ...(init.replyToId ? { replyToId: init.replyToId } : {}) };
  const reply = init.cookie
    ? await remote(`/api/bots/${botId}/messages`, { body, cookie: init.cookie })
    : await loopback(`/api/bots/${botId}/messages`, { body });
  expect(reply.status, JSON.stringify(reply.body)).toBe(202);
  return { id: reply.body.message?.id, queued: Boolean(reply.body.queued) };
}

beforeAll(async () => {
  port = await freePortBlock([0, 1]);
  stub = await startControlPlaneStub();
  dataDir = mkdtempSync(join(tmpdir(), "nordus-people-sender-"));
  mkdirSync(join(dataDir, "tmp"));
  writeFileSync(finishGate(), "");
  writeFileSync(join(dataDir, "config.json"), JSON.stringify({
    threads: { maxConcurrentPerBot: 1 },
    instances: {
      claude: {
        driver: "claudeAgent",
        displayName: "Sender fixture",
        config: { cli: join(SERVER_DIR, "testing", "fake-claude-cli.ts") },
        environment: { FAKE_CLAUDE_DUMP: dumpPath(), FAKE_CLAUDE_TEXT_DUMP: join(dataDir, "text-dump.json"), FAKE_CLAUDE_EXIT_AFTER_TURN: "1",
          FAKE_CLAUDE_MODE: "hang", FAKE_CLAUDE_FINISH_GATE: finishGate() },
      },
    },
  }));
  const env = {
    ...verificationServerEnvironment(process.env, dataDir, port),
    NORDUS_PUBLIC_URL: `https://${HOST}`,
    NORDUS_CONTROL_PLANE_URL: stub.url,
  };
  child = spawn(process.execPath, verificationServerArgs(env), { cwd: join(SERVER_DIR, ".."), env, stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  child.stderr?.on("data", (chunk) => (stderr += String(chunk)));
  const deadline = Date.now() + 20_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`fixture exited:\n${stderr}`);
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1_000) })).ok) break;
    } catch {
    }
    if (Date.now() > deadline) throw new Error(`server did not start:\n${stderr}`);
    await new Promise((r) => setTimeout(r, 100));
  }
  expect((await loopback("/api/config", { method: "PUT", body: {
    profile: { name: OWNER_NAME, email: OWNER_EMAIL, aboutMe: ABOUT_ME },
    signIn: { admins: [OWNER_EMAIL.toLowerCase()], members: [MEMBER] },
  } })).status).toBe(200);
  const created = await loopback("/api/bots", { body: { name: "Sender fixture" } });
  expect(created.status).toBe(201);
  botId = created.body.bot.id;
  threadId = created.body.bot.threadId;
}, 40_000);

afterAll(async () => {
  if (child) await waitForExit(child, { signal: "SIGTERM" });
  if (stub) await stub.close();
  if (dataDir) await removeTempDir(dataDir);
});

describe("who a turn is from", () => {
  it("gives the owner's own turn the owner's About me", async () => {
    await say("owner-loopback-line");
    const sent = await turnSent("owner-loopback-line");
    expect(sent.systemPrompt).toContain(ABOUT_ME);
    expect(sent.systemPrompt).not.toContain(MEMBER);
  });

  it("tells the bot a team member is writing, without the owner's About me", async () => {
    const ronny = await signIn(MEMBER);
    const first = await say("member-first-line", { cookie: ronny });
    const sent = await turnSent("member-first-line");
    expect.soft(sent.systemPrompt).not.toContain(ABOUT_ME);
    expect.soft(sent.systemPrompt).toContain(MEMBER);
    expect.soft(sent.systemPrompt).toContain(OWNER_NAME);

    await say("member-reply-line", { cookie: ronny, replyToId: first.id });
    const reply = await turnSent("member-reply-line");
    expect.soft(reply.prompt).toContain(`an earlier message from ${MEMBER}`);
    expect.soft(reply.prompt).not.toContain(`an earlier message from ${OWNER_NAME}`);
    expect.soft(reply.systemPrompt).not.toContain(ABOUT_ME);
  });

  it("keeps a member's message that waited in the queue theirs", async () => {
    const ronny = await signIn(MEMBER);
    const opened = await remote(`/api/bots/${botId}/tasks`, { body: {}, cookie: ronny });
    expect(opened.status).toBe(201);
    rmSync(finishGate());
    let queued: boolean;
    try {
      await say("owner-busy-line");
      await expect.poll(() => existsSync(dumpPath()) && readFileSync(dumpPath(), "utf8").includes("owner-busy-line"), { timeout: 15_000 }).toBe(true);
      queued = (await say("member-queued-line", { cookie: ronny, thread: opened.body.task.threadId })).queued;
    } finally {
      writeFileSync(finishGate(), "");
    }
    expect(queued).toBe(true);
    const sent = await turnSent("member-queued-line");
    expect(sent.systemPrompt).not.toContain(ABOUT_ME);
    expect(sent.systemPrompt).toContain(MEMBER);
  });

  it("treats a session signed in with the owner's own email, in any case, as the owner", async () => {
    const gabe = await signIn(OWNER_EMAIL.toLowerCase());
    await say("owner-email-line", { cookie: gabe });
    const sent = await turnSent("owner-email-line");
    expect(sent.systemPrompt).toContain(ABOUT_ME);
    expect(sent.systemPrompt).not.toContain(MEMBER);
  });
});
