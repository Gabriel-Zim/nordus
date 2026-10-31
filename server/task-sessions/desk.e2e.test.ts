// The desk (balcão) of a taskSessions bot, through real provider processes with per-thread gates.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { launchVerificationServer, type VerificationServer } from "../../scripts/control-nordus.ts";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

describe("desk of a taskSessions bot", () => {
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
  const messages = async (threadId: string) => (await api("GET", `/api/threads/${threadId}/messages?limit=100`)).body.messages as any[];
  const threadFile = (threadId: string, extension: string) => join(fixture.info.dataDir, `${threadId}.${extension}`);
  const readDump = (threadId: string) => {
    try { return JSON.parse(readFileSync(threadFile(threadId, "json"), "utf8")); } catch { return null; }
  };
  const dump = async (threadId: string) => {
    let snapshot: any;
    await expect.poll(() => (snapshot = readDump(threadId)) !== null, { timeout: 15_000 }).toBe(true);
    return snapshot;
  };
  const finish = (threadId: string, body = "finish this isolated turn") => writeFileSync(threadFile(threadId, "gate"), body);
  /** Private desk fields never reach the wire: read them from the stored bots. */
  const deskOf = (botId: string, threadId: string) => {
    const stored = JSON.parse(readFileSync(join(fixture.info.dataDir, "bots.json"), "utf8"));
    const bots: any[] = Array.isArray(stored) ? stored : stored.bots;
    return bots.find((bot) => bot.id === botId)?.tasks?.find((task: any) => task.threadId === threadId)?.desk;
  };
  const send = (botId: string, threadId: string, text: string, extra: Record<string, unknown> = {}) =>
    api("POST", `/api/bots/${botId}/messages`, { threadId, text, ...extra });
  const taskTitled = async (botId: string, desk: string, title: string) => {
    let found: string | undefined;
    await expect.poll(async () => (found = (await botState(botId)).tasks.find((task: any) => task.threadId !== desk && task.title === title)?.threadId), { timeout: 15_000 }).toBeTruthy();
    return found!;
  };
  const deskBot = async (extra: Record<string, unknown> = {}) => {
    const created = await api("POST", "/api/bots", { name: "Balcao fixture", modelSelection: { instanceId: "claude", model } });
    expect(created.status).toBe(201);
    const bot = created.body.bot;
    expect((await api("PATCH", `/api/bots/${bot.id}`, { taskSessions: true, ...extra })).status).toBe(200);
    return { botId: bot.id as string, desk: bot.threadId as string };
  };
  const botLines = async (threadId: string) => (await messages(threadId)).filter((m) => m.role === "bot" && m.kind === "text");

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

  it("opens one task per request, delivers each to the desk and continues from the replies", async () => {
    const { botId, desk } = await deskBot();
    expect((await send(botId, desk, "X")).status).toBe(202);
    const x = await taskTitled(botId, desk, "X");
    expect((await send(botId, desk, "Y")).status).toBe(202);
    const y = await taskTitled(botId, desk, "Y");
    expect(deskOf(botId, x)).toMatchObject({ origin: desk, title: "X" });
    expect(deskOf(botId, y)).toMatchObject({ origin: desk, title: "Y" });
    const lines = (await botLines(desk)).map((m) => m.text);
    expect(lines).toEqual(expect.arrayContaining(["Comecei: X", "Comecei: Y"]));
    const [xs, ys] = await Promise.all([dump(x), dump(y)]);
    expect(xs.pid).not.toBe(ys.pid);
    expect(xs.env.NORDUS_TAREFA_ID).toMatch(/^[a-z0-9]{6}$/);
    expect(JSON.stringify(xs.prompt)).toContain(`inclua \\"${xs.env.NORDUS_TAREFA_ID}\\" no nome da pasta do pedido`);
    expect((await botState(botId)).tasks.filter((task: any) => task.busy).map((task: any) => task.threadId).sort()).toEqual([x, y].sort());

    // Delivery: X comes home with its link while Y keeps running.
    finish(x);
    let delivery: any;
    await expect.poll(async () => (delivery = (await botLines(desk)).find((m) => m.text?.startsWith('Sobre "X"'))) !== undefined, { timeout: 15_000 }).toBe(true);
    expect(delivery.threadRef).toMatchObject({ threadId: x, botId });
    expect((await botState(botId)).tasks.find((task: any) => task.threadId === y).busy).toBe(true);
    expect(deskOf(botId, x).state).toBe("done");

    // Replying to the delivery resumes X's session.
    const before = (await dump(x)).pid;
    expect((await send(botId, desk, "mais um detalhe", { replyToId: delivery.id })).status).toBe(202);
    await expect.poll(async () => { const d = readDump(x); return d && d.pid !== before && d.argv.includes("--resume"); }, { timeout: 15_000 }).toBe(true);
    expect((await messages(x)).some((m) => m.role === "user" && m.text === "mais um detalhe")).toBe(true);
    expect((await messages(y)).some((m) => m.text === "mais um detalhe")).toBe(false);
    expect((await messages(desk)).some((m) => m.role === "user" && m.text === "mais um detalhe" && m.threadRef?.threadId === x)).toBe(true);
    expect((await botState(botId)).tasks.filter((task: any) => task.title === "mais um detalhe")).toEqual([]);
    // The reopened task runs again and delivers a second time.
    await expect.poll(async () => (await botLines(desk)).filter((m) => m.text?.startsWith('Sobre "X"')).length, { timeout: 15_000 }).toBe(2);
    expect(deskOf(botId, x).state).toBe("done");
    finish(y);
    await expect.poll(async () => (await botLines(desk)).some((m) => m.text?.startsWith('Sobre "Y"')), { timeout: 15_000 }).toBe(true);
  }, 90_000);

  it("a reply to Comecei steers the running task and opens no new conversation", async () => {
    const { botId, desk } = await deskBot();
    await send(botId, desk, "X");
    const x = await taskTitled(botId, desk, "X");
    await send(botId, desk, "Y");
    const y = await taskTitled(botId, desk, "Y");
    await dump(x);
    const comecei = (await botLines(desk)).find((m) => m.text === "Comecei: X");
    const tasksBefore = (await botState(botId)).tasks.length;
    const reply = await send(botId, desk, "inclua o item Z", { replyToId: comecei.id });
    expect(reply.status).toBe(202);
    expect((await messages(x)).some((m) => m.role === "user" && m.text === "inclua o item Z")).toBe(true);
    expect((await messages(y)).some((m) => m.text === "inclua o item Z")).toBe(false);
    expect((await botState(botId)).tasks.length).toBe(tasksBefore);
    finish(x); finish(y);
  }, 60_000);

  it("queues past the limit, announces the position and starts by itself", async () => {
    expect((await api("PATCH", "/api/config", { threads: { maxConcurrentPerBot: 1 } })).status).toBe(200);
    const { botId, desk } = await deskBot();
    await send(botId, desk, "X");
    const x = await taskTitled(botId, desk, "X");
    await dump(x);
    await send(botId, desk, "Y");
    const y = await taskTitled(botId, desk, "Y");
    expect((await botLines(desk)).map((m) => m.text)).toContain("Aguardando vaga: Y (posição 1)");
    expect(existsSync(threadFile(y, "json"))).toBe(false);
    expect(deskOf(botId, y).state).toBe("queued");
    finish(x);
    await dump(y);
    await expect.poll(() => deskOf(botId, y).state, { timeout: 10_000 }).toBe("running");
    finish(y);
    await expect.poll(async () => (await botLines(desk)).some((m) => m.text?.startsWith('Sobre "Y"')), { timeout: 15_000 }).toBe(true);
  }, 60_000);

  it("replying to an archived task opens a new one, with 200 and no error", async () => {
    const { botId, desk } = await deskBot();
    await send(botId, desk, "X");
    const x = await taskTitled(botId, desk, "X");
    finish(x);
    await expect.poll(async () => (await botLines(desk)).some((m) => m.text?.startsWith('Sobre "X"')), { timeout: 15_000 }).toBe(true);
    const delivery = (await botLines(desk)).find((m) => m.text?.startsWith('Sobre "X"'));
    expect((await api("PATCH", `/api/bots/${botId}/tasks/${x}`, { archivedAt: Date.now() })).status).toBe(200);
    const reply = await send(botId, desk, "outra coisa", { replyToId: delivery.id });
    expect(reply.status).toBe(202);
    const fresh = await taskTitled(botId, desk, "outra coisa");
    expect(fresh).not.toBe(x);
    const texts = (await botLines(desk)).map((m) => m.text);
    const notice = texts.indexOf('A tarefa "X" não existe mais. Abri uma nova.');
    expect(notice).toBeGreaterThan(-1);
    expect(notice).toBeLessThan(texts.indexOf("Comecei: outra coisa"));
    finish(fresh);
  }, 60_000);

  it("a request with an image reaches the new task while the bot is busy", async () => {
    const { botId, desk } = await deskBot();
    await send(botId, desk, "X");
    const x = await taskTitled(botId, desk, "X");
    await dump(x);
    const uploaded = await fetch(`${fixture.info.url}/api/attachments`, { method: "POST", headers: { "content-type": "image/png", origin: fixture.info.url }, body: new Uint8Array(PNG) });
    expect(uploaded.status).toBe(201);
    const path = ((await uploaded.json()) as { path: string }).path;
    const sent = await send(botId, desk, `Olhe isto\n\n<attached-image path="${path}" />`);
    expect(sent.status).toBe(202);
    expect(sent.body.queued).toBeUndefined();
    const t = await taskTitled(botId, desk, "Olhe isto");
    const d = await dump(t);
    const blocks = d.prompt.message.content as Array<{ type: string; text?: string }>;
    expect(blocks.some((block) => block.type === "image")).toBe(true);
    // Recalled notes may quote the line; the message itself, after them, carries no tag.
    const own = blocks.filter((block) => block.type === "text").map((block) => block.text ?? "").join("\n");
    const message = own.slice(own.lastIndexOf("the message follows]"));
    expect(message).toContain("Olhe isto");
    expect(message).not.toContain("<attached-image");
    finish(x); finish(t);
  }, 60_000);

  it("the same sendId opens a single task", async () => {
    const { botId, desk } = await deskBot();
    const first = await send(botId, desk, "X", { sendId: "desk_same_send_1" });
    const second = await send(botId, desk, "X", { sendId: "desk_same_send_1" });
    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(second.body.message.id).toBe(first.body.message.id);
    const x = await taskTitled(botId, desk, "X");
    expect((await botState(botId)).tasks.filter((task: any) => task.title === "X")).toHaveLength(1);
    finish(x);
  }, 60_000);

  it("a task waiting on a teammate delivers only the final answer", async () => {
    const { botId, desk } = await deskBot();
    const mate = (await api("POST", "/api/bots", { name: "Mate fixture", modelSelection: { instanceId: "claude", model } })).body.bot;
    await send(botId, desk, "X");
    const x = await taskTitled(botId, desk, "X");
    const launched = await dump(x);
    const handed = await fetch(`${fixture.info.url}/api/internal/coordinate-bots`, {
      method: "POST",
      headers: { authorization: `Bearer ${launched.mcpConfig.mcpServers.agents.env.NORDUS_COMMS_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ botIds: [mate.id], message: "Revise isto" }),
    });
    const receipt = await handed.json() as any;
    expect(handed.status, JSON.stringify(receipt)).toBe(200);
    const work = receipt.receipts[0].threadId as string;
    await dump(work);
    finish(x);
    await expect.poll(async () => (await botState(botId)).tasks.find((task: any) => task.threadId === x).busy, { timeout: 15_000 }).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    expect((await botLines(desk)).some((m) => m.text?.startsWith('Sobre "X"'))).toBe(false);
    expect(deskOf(botId, x).state).not.toBe("done");
    finish(work);
    await expect.poll(async () => (await botLines(desk)).some((m) => m.text?.startsWith('Sobre "X"')), { timeout: 20_000 }).toBe(true);
    expect((await botLines(desk)).filter((m) => m.text?.startsWith('Sobre "X"'))).toHaveLength(1);
  }, 90_000);

  it("a task whose engine cannot start says so, and a reply after the engine returns runs it", async () => {
    const { botId, desk } = await deskBot();
    const wrapper = join(fixture.info.dataDir, "desk-claude.mjs");
    expect((await api("PATCH", "/api/instances/claude", { cli: join(fixture.info.dataDir, "no-such-cli") })).status).toBe(200);
    expect((await send(botId, desk, "X")).status).toBe(202);
    const x = await taskTitled(botId, desk, "X");
    let line: any;
    await expect.poll(async () => (line = (await botLines(desk)).find((m) => m.text?.includes("não terminou"))) !== undefined, { timeout: 20_000 }).toBe(true);
    expect(line.text).toMatch(/^A tarefa "X" não terminou: .+\. Responda esta mensagem para retomar\.$/);
    expect(line.threadRef).toMatchObject({ threadId: x, botId });
    expect(deskOf(botId, x).state).toBe("failed");
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    expect((await botLines(desk)).filter((m) => m.text?.includes("não terminou"))).toHaveLength(1);
    expect((await api("PATCH", "/api/instances/claude", { cli: wrapper })).status).toBe(200);
    expect((await send(botId, desk, "de novo", { replyToId: line.id })).status).toBe(202);
    await dump(x);
    expect((await messages(x)).some((m) => m.role === "user" && m.text === "de novo")).toBe(true);
    finish(x);
    await expect.poll(async () => (await botLines(desk)).some((m) => m.text?.startsWith('Sobre "X"')), { timeout: 15_000 }).toBe(true);
    expect(deskOf(botId, x).state).toBe("done");
  }, 60_000);

  it("a task that failed says so and a reply resumes it", async () => {
    const { botId, desk } = await deskBot();
    await send(botId, desk, "X");
    const x = await taskTitled(botId, desk, "X");
    finish(x, "fail");
    let line: any;
    await expect.poll(async () => (line = (await botLines(desk)).find((m) => m.text?.includes("não terminou"))) !== undefined, { timeout: 15_000 }).toBe(true);
    expect(line.text).toContain('A tarefa "X" não terminou');
    expect(line.text).toContain("Responda esta mensagem para retomar.");
    expect(deskOf(botId, x).state).toBe("failed");
    const before = (await dump(x)).pid;
    finish(x, "now it works");
    expect((await send(botId, desk, "tente de novo", { replyToId: line.id })).status).toBe(202);
    await expect.poll(async () => { const d = readDump(x); return d && d.pid !== before && d.argv.includes("--resume"); }, { timeout: 15_000 }).toBe(true);
    expect((await messages(x)).some((m) => m.role === "user" && m.text === "tente de novo")).toBe(true);
    await expect.poll(async () => (await botLines(desk)).some((m) => m.text?.startsWith('Sobre "X"')), { timeout: 15_000 }).toBe(true);
    expect(deskOf(botId, x).state).toBe("done");
  }, 60_000);

  it("a message typed inside a task conversation resolves, even for a bot with no model selected", async () => {
    const created = await api("POST", "/api/bots", { name: "Unset fixture" });
    expect(created.status).toBe(201);
    const botId = created.body.bot.id as string, desk = created.body.bot.threadId as string;
    expect((await api("PATCH", `/api/bots/${botId}`, { taskSessions: true })).status).toBe(200);
    expect((await send(botId, desk, "X")).status).toBe(202);
    const x = await taskTitled(botId, desk, "X");
    await dump(x);
    const typed = await Promise.race([
      send(botId, x, "dentro da tarefa", { sendId: "desk_inside_task_1" }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("typing inside a task hung")), 20_000)),
    ]);
    expect(typed.status).toBe(202);
    expect((await messages(x)).some((m) => m.role === "user" && m.text === "dentro da tarefa")).toBe(true);
    expect((await botState(botId)).tasks).toHaveLength(2);
    finish(x);
  }, 60_000);

  it("pauses on the plan limit, tells the desk once and creates no quota card", async () => {
    const wrapper = join(fixture.info.dataDir, "limit-claude.mjs");
    writeFileSync(wrapper, [
      "#!/usr/bin/env node",
      'process.env.FAKE_CLAUDE_MODE = "usage-limit";',
      `process.env.FAKE_CLAUDE_RATE_LIMIT = ${JSON.stringify(JSON.stringify({ status: "rejected", resetsAt: Math.floor(Date.now() / 1000) + 86_400, rateLimitType: "five_hour", isUsingOverage: false }))};`,
      `await import(${JSON.stringify(pathToFileURL(join(process.cwd(), "server/testing/fake-claude-cli.ts")).href)});`,
    ].join("\n"), { mode: 0o700 });
    expect((await api("PATCH", "/api/instances/claude", { cli: wrapper })).status).toBe(200);
    const { botId, desk } = await deskBot();
    expect((await send(botId, desk, "X")).status).toBe(202);
    const x = await taskTitled(botId, desk, "X");
    await expect.poll(() => deskOf(botId, x)?.state, { timeout: 15_000 }).toBe("paused");
    await expect.poll(async () => (await botLines(desk)).filter((m) => m.text?.startsWith("Pausei as tarefas")).length, { timeout: 15_000 }).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(deskOf(botId, x).state).toBe("paused");
    expect((await botLines(desk)).some((m) => m.text?.includes("não terminou"))).toBe(false);
    expect((await messages(x)).some((m) => m.kind === "options" && m.card?.quotaSwitch)).toBe(false);
  }, 60_000);

  it("a bot without taskSessions keeps working in the same conversation", async () => {
    const created = await api("POST", "/api/bots", { name: "Plain fixture", modelSelection: { instanceId: "claude", model } });
    const botId = created.body.bot.id as string, thread = created.body.bot.threadId as string;
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
