// The fake ACP CLI asks once per turn to run a command it spells twice (`command` and Antigravity's `CommandLine`), with
// the safety floor on and Jev answering yes to every question from a fake endpoint on this machine.
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { removeTempDir, waitForExit } from "./testing/cleanup.ts";
import { freePortBlock } from "./testing/ports.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const FAKE_CLI = join(SERVER_DIR, "testing", "fake-acp-cli.ts");
const SPELLINGS = {
  // The floor cannot read the first spelling (an open quote); the second pushes.
  unreadable: { command: "echo '", CommandLine: "git push origin main" },
  // Both ordinary: Jev would read the first while the engine may run the second.
  ordinary: { command: "ls /tmp", CommandLine: "cat notes.txt" },
} as const;

let child: ChildProcess;
let jev: Server;
let home = "";
let base = "";
let log = "";
const jevBodies: string[] = [];

const api = async (method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> => {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { origin: base, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

async function waitFor<T>(read: () => Promise<T | null | undefined>, ms = 30_000): Promise<T | null> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline) return null;
    await new Promise((r) => setTimeout(r, 250));
  }
}

describe.skipIf(process.platform === "win32")("a command an ACP engine spells two different ways", () => {
  beforeAll(async () => {
    chmodSync(FAKE_CLI, 0o755);
    jev = createServer((req, res) => {
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      req.on("end", () => {
        jevBodies.push(raw);
        const questions = JSON.parse(raw || "{}").questions ?? {};
        const answers = Object.fromEntries(Object.keys(questions).map((id) => [id, { type: "noul", noul: 0.99 }]));
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ model: "jev-1.13.0", answers, usage: { input_tokens: 40 } }));
      });
    });
    await new Promise<void>((resolve) => jev.listen(0, "127.0.0.1", resolve));
    home = mkdtempSync(join(tmpdir(), "nordus-acp-spellings-"));
    const data = join(home, ".nordus");
    mkdirSync(data, { recursive: true });
    const instance = (rawInput: object) => ({ driver: "grokAgent", config: { cli: FAKE_CLI, fullAuto: false },
      environment: { FAKE_ACP_MODE: "permission", FAKE_ACP_PERMISSION_TOOL_CALL: JSON.stringify({ kind: "execute", title: "Run", rawInput }) } });
    writeFileSync(join(data, "config.json"), JSON.stringify({
      instances: Object.fromEntries(Object.entries(SPELLINGS).map(([name, rawInput]) => [name, instance(rawInput)])),
      decider: { enabled: true, baseUrl: `http://127.0.0.1:${(jev.address() as AddressInfo).port}` },
    }));
    const port = await freePortBlock([0, 1]);
    base = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
      cwd: join(SERVER_DIR, ".."),
      env: {
        ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
        HOME: home, USERPROFILE: home, NORDUS_PORT: String(port), NORDUS_WEBHOOK_PORT: String(port + 1),
        NORDUS_SAFETY_FLOOR: "1", NORDUS_JEV_API_KEY: "tsk_e2e_spellings_fixture_key",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout!.on("data", (c) => (log += c));
    child.stderr!.on("data", (c) => (log += c));
    const deadline = Date.now() + 20_000;
    for (;;) {
      try {
        if ((await fetch(`${base}/api/health`)).ok) break;
      } catch {
      }
      if (Date.now() > deadline) throw new Error(`server never came up:\n${log}`);
      await new Promise((r) => setTimeout(r, 150));
    }
  }, 40_000);

  afterAll(async () => {
    await waitForExit(child, { signal: "SIGTERM" });
    await new Promise((resolve) => jev.close(resolve));
    await removeTempDir(home);
  });

  it.each(Object.keys(SPELLINGS) as Array<keyof typeof SPELLINGS>)("goes to the person with both spellings shown, never to Jev (%s)", async (instanceId) => {
    const created = await api("POST", "/api/bots", { name: `Spelled ${instanceId}` });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const bot = created.body.bot as { id: string; threadId: string };
    expect((await api("PATCH", `/api/bots/${bot.id}`, { modelSelection: { instanceId, model: "fake-model" }, approvalMode: "ask" })).status).toBe(200);
    expect((await api("POST", `/api/bots/${bot.id}/messages`, { text: "run it", threadId: bot.threadId })).status).toBe(202);
    const outcome = await waitFor(async () => {
      const decisions = ((await api("GET", "/api/decisions")).body.decisions ?? []) as Array<{ botId?: string; decision: string; source?: string }>;
      const approved = decisions.find((row) => row.botId === bot.id && row.decision === "auto-approved");
      if (approved) return `auto-approved by ${approved.source}`;
      const { body } = await api("GET", `/api/threads/${bot.threadId}/messages`);
      const card = (body.messages ?? []).find((m: any) => m.kind === "options" && m.card?.requestId && !m.card.answered);
      return card ? { subtitle: card.card.subtitle as string } : null;
    });
    expect(outcome, log.slice(-2_000)).toEqual({ subtitle: expect.any(String) });
    for (const spelling of Object.values(SPELLINGS[instanceId])) expect((outcome as { subtitle: string }).subtitle).toContain(spelling);
    expect(jevBodies.filter((body) => Object.values(SPELLINGS[instanceId]).some((spelling) => body.includes(JSON.stringify(spelling).slice(1, -1))))).toEqual([]);
  }, 60_000);
});
