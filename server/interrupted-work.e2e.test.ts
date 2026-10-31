import { spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, closeSync, openSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";

import { launchVerificationServer, runControlNordus, verificationServerArgs, verificationServerEnvironment } from "../scripts/control-nordus.ts";
import { waitForExit } from "./testing/cleanup.ts";

type Session = Awaited<ReturnType<typeof launchVerificationServer>>;

async function killAndRespawn(session: Session, running: ChildProcess): Promise<ChildProcess> {
  const { url, dataDir, logPath } = session.info;
  await waitForExit(running, { signal: "SIGKILL" });
  const env = verificationServerEnvironment(process.env, dataDir, Number(new URL(url).port));
  const log = openSync(logPath, "a", 0o600);
  const respawned = spawn(process.execPath, verificationServerArgs(env), { cwd: process.cwd(), env, stdio: ["ignore", log, log] });
  closeSync(log);
  await expect.poll(async () => {
    try { return (await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(1_000) })).ok; } catch { return false; }
  }, { timeout: Number(process.env.NORDUS_VERIFICATION_READY_MS) || 60_000 }).toBe(true);
  return respawned;
}

it("a turn a restart cut after it generated a video is not run again and waits in Parou no meio", async () => {
  const session = await launchVerificationServer(process.env);
  const { url, dataDir } = session.info;
  let restarted: ChildProcess | undefined;
  const api = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(url + path, { method, headers: { "content-type": "application/json", origin: url }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() as any };
  };
  const hold = join(dataDir, "read.gate");
  try {
    const wrapper = join(dataDir, "restart-cli.mjs");
    const calls = [
      { name: "mcp__zorg__gerar_video", input: { prompt: "praia ao pôr do sol" }, ok: true, output: "geração 42 iniciada" },
      { name: "Read", input: { file_path: "notes.md" }, hold },
    ];
    writeFileSync(wrapper, [
      "#!/usr/bin/env node",
      `process.env.FAKE_CLAUDE_TOOL_CALLS = ${JSON.stringify(JSON.stringify(calls))};`,
      `await import(${JSON.stringify(pathToFileURL(join(process.cwd(), "server/testing/fake-claude-cli.ts")).href)});`,
    ].join("\n"), { mode: 0o700 });
    expect((await api("PATCH", "/api/instances/claude", { cli: wrapper })).status).toBe(200);
    const bot = (await runControlNordus(["new-bot", "--name", "Ada", "--url", url]) as any).bot;
    await runControlNordus(["send", "--bot", bot.id, "--text", "Faz o vídeo da praia.", "--url", url]);
    const tools = async () => ((await api("GET", `/api/threads/${bot.activeTaskId}/messages?limit=100`)).body.messages as any[])
      .filter((message) => message.kind === "activity" && message.tool?.itemId).map((message) => [message.tool.name, message.tool.ok ?? null]);
    await expect.poll(tools, { timeout: 60_000 }).toEqual([["mcp__zorg__gerar_video", true], ["Read", null]]);

    restarted = await killAndRespawn(session, session.child);

    const listed = async () => (await api("GET", "/api/interrupted-work")).body.items as any[];
    await expect.poll(async () => (await listed()).map((item) => item.threadId), { timeout: 30_000 }).toContain(bot.activeTaskId);
    const item = (await listed()).find((candidate) => candidate.threadId === bot.activeTaskId);
    expect(item).toMatchObject({
      kind: "turn", botName: "Ada", mustConfirm: true, canResume: true,
      cause: "O Nordus reiniciou depois que o robô já tinha feito algo, então ele não continuou sozinho.",
    });
    expect(item.done).toContain("gerou um vídeo");
    expect((await api("POST", `/api/interrupted-work/${encodeURIComponent(item.id)}/resume`, { acknowledged: true })).status).toBe(403);
    appendFileSync(join(dataDir, "evidence.json"), JSON.stringify({ item }, null, 2));
    console.log(`interrupted-work evidence: ${JSON.stringify(item)}`);

    await new Promise((resolve) => setTimeout(resolve, 3_000));
    expect(await tools(), "the cut turn's calls were not made again").toEqual([["mcp__zorg__gerar_video", true], ["Read", null]]);
  } finally {
    writeFileSync(hold, "release");
    if (restarted) await waitForExit(restarted, { signal: "SIGTERM" });
    await session.close();
  }
}, 240_000);

it("a turn a restart cut twice is resumed from Parou no meio and finishes", async () => {
  const session = await launchVerificationServer(process.env);
  const { url, dataDir } = session.info;
  let running: ChildProcess = session.child;
  const api = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(url + path, { method, headers: { "content-type": "application/json", origin: url }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() as any };
  };
  const hold = join(dataDir, "read.gate");
  try {
    const wrapper = join(dataDir, "restart-cli.mjs");
    const calls = [{ name: "Read", input: { file_path: "notes.md" }, hold }];
    writeFileSync(wrapper, [
      "#!/usr/bin/env node",
      `process.env.FAKE_CLAUDE_TOOL_CALLS = ${JSON.stringify(JSON.stringify(calls))};`,
      `await import(${JSON.stringify(pathToFileURL(join(process.cwd(), "server/testing/fake-claude-cli.ts")).href)});`,
    ].join("\n"), { mode: 0o700 });
    expect((await api("PATCH", "/api/instances/claude", { cli: wrapper })).status).toBe(200);
    const bot = (await runControlNordus(["new-bot", "--name", "Ada", "--url", url]) as any).bot;
    await runControlNordus(["send", "--bot", bot.id, "--text", "Lê as anotações.", "--url", url]);
    const messages = async () => (await api("GET", `/api/threads/${bot.activeTaskId}/messages?limit=100`)).body.messages as any[];
    const reads = async () => (await messages()).filter((message) => message.kind === "activity" && message.tool?.name === "Read" && message.tool?.itemId);
    await expect.poll(async () => (await reads()).length, { timeout: 60_000 }).toBe(1);

    running = await killAndRespawn(session, running);
    await expect.poll(async () => (await reads()).length, { timeout: 60_000 }).toBe(2);
    expect((await api("GET", "/api/interrupted-work")).body.items, "the read-only turn reruns by itself once").toEqual([]);

    running = await killAndRespawn(session, running);
    const listed = async () => (await api("GET", "/api/interrupted-work")).body.items as any[];
    await expect.poll(async () => (await listed()).map((item) => item.threadId), { timeout: 30_000 }).toContain(bot.activeTaskId);
    const item = (await listed()).find((candidate) => candidate.threadId === bot.activeTaskId);
    expect(item).toMatchObject({
      kind: "turn", botName: "Ada", mustConfirm: false, canResume: true, done: [],
      cause: "O Nordus reiniciou duas vezes durante esta tarefa, então ela não foi retomada de novo.",
    });

    writeFileSync(hold, "release");
    expect((await api("POST", `/api/interrupted-work/${encodeURIComponent(item.id)}/resume`, {})).status).toBe(200);
    await expect.poll(async () => (await messages()).some((message) => message.turnSucceeded === true && message.at > item.at), { timeout: 60_000 }).toBe(true);
    expect((await listed()).map((candidate) => candidate.id)).not.toContain(item.id);
  } finally {
    writeFileSync(hold, "release");
    if (running !== session.child) await waitForExit(running, { signal: "SIGTERM" });
    await session.close();
  }
}, 360_000);
