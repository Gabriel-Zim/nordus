// POSIX-gated like the other CLI e2es: the fakes are shebang scripts.
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { STOPPED_REPLY } from "../shared/stop-request.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const FAKE_CLAUDE = join(SERVER_DIR, "testing", "fake-claude-cli.ts");
const PORT = 18800 + Math.floor(Math.random() * 10_000);
const BASE = `http://127.0.0.1:${PORT}`;
const posixOnly = describe.skipIf(process.platform === "win32");

posixOnly("stop request e2e", () => {
  let child: ChildProcess;
  let home: string;
  let stderr = "";
  let steerFinishGate: string;

  const api = async (method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json() };
  };
  const getBot = async (id: string) => (await api("GET", "/api/bots")).body.bots.find((b: any) => b.id === id);
  const PAIRED = { name: "Safari no Mac", id: expect.stringMatching(/^p_[\w-]{22}$/) };
  const asPairedPerson = async () => {
    const opened = await api("POST", "/api/auth/pairing", {});
    expect(opened.status).toBe(200);
    const paired = await fetch(`${BASE}/api/auth/pair`, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Safari/605.1" },
      body: JSON.stringify({ code: opened.body.code }),
    });
    const session = await paired.json() as any;
    expect(paired.status).toBe(200);
    expect(session.session.label).toBe(PAIRED.name);
    return async (method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> => {
      const res = await fetch(`${BASE}${path}`, {
        method,
        headers: { authorization: `Bearer ${session.token}`, ...(body ? { "content-type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: res.status, body: await res.json() };
    };
  };
  const waitFor = async (predicate: () => Promise<boolean>, what: string, ms = 30_000) => {
    const deadline = Date.now() + ms;
    while (!(await predicate())) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}. stderr: ${stderr.slice(-2000)}`);
      await new Promise((r) => setTimeout(r, 100));
    }
  };

  beforeAll(async () => {
    chmodSync(FAKE_CLAUDE, 0o755);
    home = mkdtempSync(join(tmpdir(), "nordus-stop-"));
    mkdirSync(join(home, ".nordus"), { recursive: true });
    steerFinishGate = join(home, "finish-steered-turn.gate");
    writeFileSync(
      join(home, ".nordus", "config.json"),
      JSON.stringify({
        instances: {
          claudeSteer: {
            driver: "claudeAgent",
            environment: { FAKE_CLAUDE_MODE: "slow", FAKE_CLAUDE_SLOW_FINISH_GATE: steerFinishGate },
            config: { cli: FAKE_CLAUDE, permissionMode: "bypassPermissions" },
          },
        },
      }),
    );
    child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
      cwd: join(SERVER_DIR, ".."),
      env: { ...(process.env.PATH ? { PATH: process.env.PATH } : {}), HOME: home, USERPROFILE: home, NORDUS_PORT: String(PORT) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stderr!.on("data", (c) => (stderr += c));
    const deadline = Date.now() + 20_000;
    for (;;) {
      try {
        if ((await fetch(`${BASE}/api/health`)).ok) break;
      } catch {
      }
      if (Date.now() > deadline) throw new Error(`server never came up. stderr:\n${stderr}`);
      if (child.exitCode !== null) throw new Error(`server exited ${child.exitCode}. stderr:\n${stderr}`);
      await new Promise((r) => setTimeout(r, 150));
    }
  }, 30_000);

  afterAll(async () => {
    child?.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      if (!child || child.exitCode !== null) return resolve();
      child.on("close", () => resolve());
      setTimeout(() => (child.kill("SIGKILL"), resolve()), 5_000).unref?.();
    });
    rmSync(home, { recursive: true, force: true });
  });

  const startBusy = async (api2: typeof api, text: string) => {
    rmSync(steerFinishGate, { force: true });
    const created = (await api("POST", "/api/bots")).body.bot;
    await api("PATCH", `/api/bots/${created.id}`, { modelSelection: { instanceId: "claudeSteer", model: "claude-fake" } });
    expect((await api2("POST", `/api/bots/${created.id}/messages`, { text })).status).toBe(202);
    await waitFor(async () => (await getBot(created.id)).busy === true, "the turn to start");
    await waitFor(async () => (await getBot(created.id)).messages.some((m: any) => m.kind === "activity"), "the tool chip");
    return created;
  };
  const texts = (bot: any) => bot.messages.filter((m: any) => m.kind === "text").map((m: any) => `${m.role}:${m.text}`);

  it("a plain 'para' from a paired person ends the busy turn and the bot answers STOPPED_REPLY", async () => {
    const person = await asPairedPerson();
    const created = await startBusy(person, "faz o relatorio");
    const res = await person("POST", `/api/bots/${created.id}/messages`, { text: "para" });
    expect(res.status).toBe(202);
    expect(res.body.steered).toBeUndefined();
    await waitFor(async () => (await getBot(created.id)).busy === false, "the turn to stop");
    const bot = await getBot(created.id);
    expect(texts(bot)).toContain("user:faz o relatorio");
    expect(texts(bot).slice(-2)).toEqual(["user:para", `bot:${STOPPED_REPLY}`]);
    expect(bot.messages.filter((m: any) => m.text === STOPPED_REPLY)).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 1_200));
    expect(texts(await getBot(created.id)).filter((t: string) => t.startsWith("bot:reply to:"))).toEqual([]);
  }, 40_000);

  it("'para de usar azul e faz verde' is another request: no stop, no STOPPED_REPLY, the turn keeps running", async () => {
    const person = await asPairedPerson();
    const created = await startBusy(person, "faz o relatorio");
    try {
      const res = await person("POST", `/api/bots/${created.id}/messages`, { text: "para de usar azul e faz verde" });
      expect(res.status).toBe(202);
      expect(res.body.steered === true || res.body.queued === true).toBe(true);
      const bot = await getBot(created.id);
      expect(bot.busy).toBe(true);
      expect(bot.messages.some((m: any) => m.text === STOPPED_REPLY)).toBe(false);
    } finally {
      writeFileSync(steerFinishGate, "finish");
    }
    await waitFor(async () => (await getBot(created.id)).busy === false, "the turn to settle");
    const bot = await getBot(created.id);
    expect(bot.messages.some((m: any) => m.text === STOPPED_REPLY)).toBe(false);
    expect(texts(bot)).toContain("user:para de usar azul e faz verde");
  }, 40_000);
});
