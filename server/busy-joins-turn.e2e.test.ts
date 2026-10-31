import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { afterAll, beforeAll, expect, it } from "vitest";

import { removeTempDir, waitForExit } from "./testing/cleanup.ts";
import { freePortBlock } from "./testing/ports.ts";

// Nordus: messages to a bot busy in that conversation join the running turn (steer), like Grok: no parallel line, no
// new conversation, no queue, even when the decision model (a fake Jev here) would pick a parallel line.

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SERVER_DIR, "..");
const FAKE_CLAUDE = join(SERVER_DIR, "testing", "fake-claude-cli.ts");

let child: ChildProcess;
let jev: Server;
let home = "";
let data = "";
let base = "";
let output = "";
let holds = "";

const api = async (method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> => {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
};

beforeAll(async () => {
  jev = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const question = JSON.parse(raw || "{}").questions?.answer;
      res.writeHead(200, { "content-type": "application/json" });
      if (question?.type === "choice" && "parallel" in (question.criteria ?? {})) {
        res.end(JSON.stringify({ model: "jev-1.13.0", answers: { answer: { type: "choice", choice: "parallel", confidence: 0.9, probabilities: { parallel: 0.9, queue: 0.05, continue: 0.05 } } } }));
      } else if (question?.type === "choice") {
        const [first] = Object.keys(question.criteria ?? { x: 1 });
        res.end(JSON.stringify({ model: "jev-1.13.0", answers: { answer: { type: "choice", choice: first, confidence: 0.1, probabilities: { [first!]: 0.1 } } } }));
      } else {
        res.end(JSON.stringify({ model: "jev-1.13.0", answers: { answer: { type: "noul", noul: 0.5 } } }));
      }
    });
  });
  await new Promise<void>((resolve) => jev.listen(0, "127.0.0.1", resolve));
  const jevUrl = `http://127.0.0.1:${(jev.address() as AddressInfo).port}`;

  home = mkdtempSync(join(tmpdir(), "nordus-busy-joins-"));
  data = join(home, ".nordus");
  const staticDir = join(home, "static");
  mkdirSync(data, { recursive: true });
  mkdirSync(staticDir, { recursive: true });
  writeFileSync(join(staticDir, "index.html"), "<!doctype html><title>Lanes</title>");
  holds = join(home, "holds.json");
  writeFileSync(holds, "[]");
  // A held thread works until its gate file appears; any other thread answers at once.
  const wrapper = join(home, "lanes-cli.mjs");
  writeFileSync(wrapper, [
    "#!/usr/bin/env node",
    'import { readFileSync } from "node:fs";',
    'const at = process.argv.indexOf("--mcp-config");',
    'const thread = at < 0 ? "probe" : JSON.parse(readFileSync(process.argv[at + 1], "utf8")).mcpServers?.agents?.env?.NORDUS_THREAD_ID ?? "probe";',
    `const held = JSON.parse(readFileSync(${JSON.stringify(holds)}, "utf8")).includes(thread);`,
    'process.env.FAKE_CLAUDE_MODE = held ? "slow" : "happy";',
    `process.env.FAKE_CLAUDE_SLOW_FINISH_GATE = ${JSON.stringify(join(home, "release.gate"))};`,
    `await import(${JSON.stringify(pathToFileURL(FAKE_CLAUDE).href)});`,
  ].join("\n"), { mode: 0o700 });
  writeFileSync(join(data, "config.json"), JSON.stringify({
    instances: { quick: { driver: "claudeAgent", displayName: "Quick fixture", config: { cli: wrapper } } },
    decider: { enabled: true, baseUrl: jevUrl, jobs: { taskLanes: true } },
  }));
  const port = await freePortBlock([0, 1]);
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
    cwd: ROOT,
    env: {
      ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
      HOME: home, USERPROFILE: home, NORDUS_PORT: String(port), NORDUS_WEBHOOK_PORT: String(port + 1), NORDUS_STATIC_DIR: staticDir,
      NORDUS_JEV_API_KEY: "tsk_e2e_lanes_key_0000",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout!.on("data", (chunk) => (output += chunk));
  child.stderr!.on("data", (chunk) => (output += chunk));
  const deadline = Date.now() + 20_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`server exited ${child.exitCode}: ${output}`);
    try {
      if ((await fetch(`${base}/api/health`)).status === 200) break;
    } catch {
    }
    if (Date.now() >= deadline) throw new Error(`server never became healthy: ${output}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}, 30_000);

afterAll(async () => {
  if (child) await waitForExit(child, { signal: "SIGTERM" });
  await new Promise<void>((resolve) => (jev ? jev.close(() => resolve()) : resolve()));
  if (home) await removeTempDir(home);
});

it("brings two messages sent while the bot works into the same turn, opening nothing", async () => {
  const bot = (await api("POST", "/api/bots", { name: "DesignerDeIA", modelSelection: { instanceId: "quick", model: "claude-sonnet-5" } })).body.bot;
  const main = bot.threadId as string;
  writeFileSync(holds, JSON.stringify([main]));
  const state = async () => (await api("GET", "/api/bots?messages=200")).body.bots.find((b: any) => b.id === bot.id);
  const lines = async (threadId: string) => (await api("GET", `/api/threads/${threadId}/messages?limit=100`)).body.messages as any[];

  expect((await api("POST", `/api/bots/${bot.id}/messages`, { text: "Cria a página de upload." })).status).toBe(202);
  await expect.poll(async () => (await state())?.busy, { timeout: 20_000 }).toBe(true);
  const tasksBefore = (await state()).tasks.length;
  for (const text of ["Faça uma forma de pausar e continuar o upload.", "E mostra o progresso em porcentagem."]) {
    const sent = await api("POST", `/api/bots/${bot.id}/messages`, { text });
    expect(sent.status, JSON.stringify(sent.body)).toBeLessThan(300);
    expect(sent.body).toMatchObject({ steered: true, threadId: main });
    expect(sent.body.queued).toBeUndefined();
  }
  const during = await lines(main);
  expect(during.filter((m) => m.role === "user" && m.steered).map((m) => m.text))
    .toEqual(["Faça uma forma de pausar e continuar o upload.", "E mostra o progresso em porcentagem."]);
  expect(during.some((m) => /paralelo|fila/i.test(m.tool?.name ?? "") || m.threadRef)).toBe(false);
  expect((await state()).tasks.length).toBe(tasksBefore);

  writeFileSync(join(home, "release.gate"), "go");
  await expect.poll(async () => (await state())?.busy, { timeout: 30_000 }).toBe(false);
  // One answer from the one turn, which read both.
  const answers = (await lines(main)).filter((m) => m.role === "bot" && m.kind === "text" && m.text);
  expect(answers.at(-1)!.text).toContain("pausar e continuar o upload");
  expect(answers.at(-1)!.text).toContain("progresso em porcentagem");
  expect((await state()).tasks.length).toBe(tasksBefore);
}, 90_000);
