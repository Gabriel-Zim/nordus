// Desk tasks across a real server crash: nothing is silently lost.
import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, it } from "vitest";

import { launchVerificationServer } from "../../scripts/control-nordus.ts";
import { waitForExit } from "../testing/cleanup.ts";

it("survives a restart: the queue goes on, an interrupted task is announced and a reply resumes it", async () => {
  const fixture = await launchVerificationServer();
  const { url, dataDir, logPath } = fixture.info;
  let restarted: ChildProcess | undefined;
  const api = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${url}${path}`, {
      method, headers: { "content-type": "application/json", origin: url },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(5_000),
    });
    return { status: response.status, body: await response.json() as any };
  };
  const messages = async (thread: string) => (await api("GET", `/api/threads/${thread}/messages?limit=100`)).body.messages as any[];
  const botLines = async (thread: string) => (await messages(thread)).filter((m) => m.role === "bot" && m.kind === "text");
  const deskOf = (botId: string, threadId: string) => {
    const stored = JSON.parse(readFileSync(join(dataDir, "bots.json"), "utf8"));
    const bots: any[] = Array.isArray(stored) ? stored : stored.bots;
    return bots.find((bot) => bot.id === botId)?.tasks?.find((task: any) => task.threadId === threadId)?.desk;
  };
  const prompts = (thread: string): any[] => {
    try { return readFileSync(join(dataDir, `${thread}.prompts`), "utf8").trim().split("\n").map((line) => JSON.parse(line)); }
    catch { return []; }
  };
  const taskTitled = async (botId: string, desk: string, title: string) => {
    let found: string | undefined;
    await expect.poll(async () => (found = (await api("GET", "/api/bots?messages=0")).body.bots.find((b: any) => b.id === botId).tasks.find((t: any) => t.threadId !== desk && t.title === title)?.threadId), { timeout: 15_000 }).toBeTruthy();
    return found!;
  };
  const restart = async () => {
    const env: NodeJS.ProcessEnv = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (["SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "LANG", "LC_ALL", "TZ"].includes(key.toUpperCase()) && value) env[key.toUpperCase()] = value;
    }
    Object.assign(env, {
      HOME: dataDir, USERPROFILE: dataDir, NORDUS_DATA_DIR: dataDir,
      APPDATA: join(dataDir, "AppData", "Roaming"), LOCALAPPDATA: join(dataDir, "AppData", "Local"),
      XDG_CONFIG_HOME: join(dataDir, ".config"), XDG_CACHE_HOME: join(dataDir, ".cache"),
      XDG_DATA_HOME: join(dataDir, ".local", "share"), HERMES_HOME: join(dataDir, ".hermes"),
      TEMP: join(dataDir, "tmp"), TMP: join(dataDir, "tmp"), TMPDIR: join(dataDir, "tmp"),
      NORDUS_PORT: new URL(url).port, NORDUS_WEBHOOK_PORT: String(Number(new URL(url).port) + 1), PATH: dirname(process.execPath),
    });
    const log = openSync(logPath, "a", 0o600);
    restarted = spawn(process.execPath, ["--experimental-strip-types", fileURLToPath(new URL("../index.ts", import.meta.url))], {
      cwd: fileURLToPath(new URL("../..", import.meta.url)), env, stdio: ["ignore", log, log],
    });
    closeSync(log);
    await expect.poll(async () => {
      expect(restarted?.exitCode, `see ${logPath}`).toBeNull();
      try { return (await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(1_000) })).ok; }
      catch { return false; }
    }, { timeout: 20_000 }).toBe(true);
  };
  try {
    const wrapper = join(dataDir, "restart-claude.mjs");
    writeFileSync(wrapper, [
      "#!/usr/bin/env node",
      'import { existsSync } from "node:fs";',
      'import { basename, join } from "node:path";',
      'const thread = basename(process.cwd());',
      `const home = ${JSON.stringify(dataDir)};`,
      'process.env.FAKE_CLAUDE_MODE = existsSync(join(home, "restarted")) ? "happy" : "slow";',
      'process.env.FAKE_CLAUDE_SLOW_FINISH_GATE = join(home, thread + ".gate");',
      'process.env.FAKE_CLAUDE_PROMPTS = join(home, thread + ".prompts");',
      'process.stdin.on("end", () => process.exit(0));',
      `await import(${JSON.stringify(pathToFileURL(join(process.cwd(), "server/testing/fake-claude-cli.ts")).href)});`,
    ].join("\n"), { mode: 0o700 });
    expect((await api("PATCH", "/api/instances/claude", { cli: wrapper })).status).toBe(200);
    expect((await api("PATCH", "/api/config", { threads: { maxConcurrentPerBot: 1 } })).status).toBe(200);
    const instance = (await api("GET", "/api/instances")).body.instances.find((candidate: any) => candidate.instanceId === "claude");
    const created = await api("POST", "/api/bots", { name: "Balcao restart", modelSelection: { instanceId: "claude", model: instance.models.options[0].id } });
    const botId = created.body.bot.id as string;
    const desk = created.body.bot.threadId as string;
    expect((await api("PATCH", `/api/bots/${botId}`, { taskSessions: true })).status).toBe(200);

    expect((await api("POST", `/api/bots/${botId}/messages`, { threadId: desk, text: "X" })).status).toBe(202);
    const x = await taskTitled(botId, desk, "X");
    await expect.poll(() => prompts(x).length, { timeout: 15_000 }).toBe(1);
    expect((await api("POST", `/api/bots/${botId}/messages`, { threadId: desk, text: "Y" })).status).toBe(202);
    const y = await taskTitled(botId, desk, "Y");
    expect(deskOf(botId, x).state).toBe("running");
    await expect.poll(() => deskOf(botId, y)?.state, { timeout: 10_000 }).toBe("queued");

    await waitForExit(fixture.child, { signal: "SIGKILL" });
    writeFileSync(join(dataDir, "restarted"), "turns finish by themselves now");
    await restart();

    const line = 'A tarefa "X" foi interrompida por um reinício. Responda esta mensagem para retomar.';
    // The interrupted task is announced on the desk, linked to the task; the queue goes on by itself.
    await expect.poll(async () => (await botLines(desk)).some((m) => m.text === line), { timeout: 15_000 }).toBe(true);
    const notice = (await botLines(desk)).find((m) => m.text === line);
    expect(notice.threadRef).toMatchObject({ botId, threadId: x, title: "X" });
    await expect.poll(() => prompts(y).length, { timeout: 20_000 }).toBe(1);
    await expect.poll(async () => (await botLines(desk)).some((m) => m.text?.startsWith('Sobre "Y"')), { timeout: 20_000 }).toBe(true);
    expect(deskOf(botId, y).state).toBe("done");

    // Replying to the notice resumes X's session.
    expect((await api("POST", `/api/bots/${botId}/messages`, { threadId: desk, text: "pode continuar", replyToId: notice.id })).status).toBe(202);
    await expect.poll(() => prompts(x).length, { timeout: 20_000 }).toBe(2);
    expect((await messages(x)).some((m) => m.role === "user" && m.text === "pode continuar")).toBe(true);
    await expect.poll(async () => (await botLines(desk)).some((m) => m.text?.startsWith('Sobre "X"')), { timeout: 20_000 }).toBe(true);
  } finally {
    await waitForExit(restarted, { signal: "SIGTERM" });
    await fixture.close();
  }
}, 120_000);
