// A message to a bot stays in the conversation it was written in, through real provider processes with per-thread gates.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { launchVerificationServer, type VerificationServer } from "../../scripts/control-nordus.ts";

describe("a bot's conversation", () => {
  let fixture: VerificationServer;
  let model: string;

  const api = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${fixture.info.url}${path}`, {
      method,
      headers: { "content-type": "application/json", origin: fixture.info.url },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() as any };
  };
  const botState = async (botId: string) => (await api("GET", "/api/bots?messages=0")).body.bots.find((bot: any) => bot.id === botId);
  const threadFile = (threadId: string, extension: string) => join(fixture.info.dataDir, `${threadId}.${extension}`);
  const readDump = (threadId: string) => {
    try { return JSON.parse(readFileSync(threadFile(threadId, "json"), "utf8")); } catch { return null; }
  };
  const dump = async (threadId: string) => {
    await expect.poll(() => readDump(threadId) !== null, { timeout: 15_000 }).toBe(true);
  };
  const finish = (threadId: string) => writeFileSync(threadFile(threadId, "gate"), "finish this isolated turn");
  const send = (botId: string, threadId: string, text: string) => api("POST", `/api/bots/${botId}/messages`, { threadId, text });

  beforeEach(async () => {
    fixture = await launchVerificationServer();
    const wrapper = join(fixture.info.dataDir, "desk-claude.mjs");
    writeFileSync(wrapper, [
      "#!/usr/bin/env node",
      'import { basename, join } from "node:path";',
      'const thread = basename(process.cwd());',
      'process.env.FAKE_CLAUDE_MODE = "slow";',
      'process.env.FAKE_CLAUDE_EXIT_AFTER_TURN = "1";',
      `process.env.FAKE_CLAUDE_SLOW_FINISH_GATE = join(${JSON.stringify(fixture.info.dataDir)}, thread + ".gate");`,
      `process.env.FAKE_CLAUDE_DUMP = join(${JSON.stringify(fixture.info.dataDir)}, thread + ".json");`,
      `await import(${JSON.stringify(pathToFileURL(join(process.cwd(), "server/testing/fake-claude-cli.ts")).href)});`,
    ].join("\n"), { mode: 0o700 });
    expect((await api("PATCH", "/api/instances/claude", { cli: wrapper })).status).toBe(200);
    const instance = (await api("GET", "/api/instances")).body.instances.find((candidate: any) => candidate.instanceId === "claude");
    model = instance.models.options[0].id;
  }, 30_000);

  afterEach(async () => { await fixture?.close(); });

  it("a bot asked to open a task per message still answers in the same conversation", async () => {
    const created = await api("POST", "/api/bots", { name: "Plain fixture", modelSelection: { instanceId: "claude", model } });
    const botId = created.body.bot.id as string, thread = created.body.bot.threadId as string;
    expect((await api("PATCH", `/api/bots/${botId}`, { taskSessions: true })).status).toBe(200);
    await send(botId, thread, "primeiro");
    await dump(thread);
    const second = await send(botId, thread, "segundo");
    expect(second.status).toBe(202);
    expect(second.body.threadId).toBe(thread);
    expect(Boolean(second.body.steered) || Boolean(second.body.queued)).toBe(true);
    expect((await botState(botId)).tasks).toHaveLength(1);
    finish(thread);
  }, 60_000);
});
