// Real isolated server + native Claude permission broker. No real model calls,
// user profiles, shell commands or live application data are used.
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, existsSync, openSync, readFileSync, rmSync } from "node:fs";
import { connect, type Socket } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { launchVerificationServer, verificationServerEnvironment, type VerificationServer } from "../scripts/control-nordus.ts";
import { waitForExit } from "./testing/cleanup.ts";

function harness(fixture: VerificationServer) {
  const { url, dataDir } = fixture.info;
  const sockets: Socket[] = [];
  const api = async (method: string, path: string, body?: unknown, status = 200) => {
    const response = await fetch(url + path, { method, headers: { origin: url, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10_000) });
    const result = await response.json() as any;
    expect(response.status, `${method} ${path}: ${JSON.stringify(result)}`).toBe(status);
    return result;
  };
  const messages = async (thread: string): Promise<any[]> => (await api("GET", `/api/threads/${thread}/messages?limit=100`)).messages;
  const card = async (thread: string, id: string) => (await messages(thread)).find(message => message.card?.requestId === id)?.card;
  const pendingCard = async (thread: string, id: string) => {
    await expect.poll(async () => Boolean(await card(thread, id)), { timeout: 10_000 }).toBe(true);
    const found = await card(thread, id);
    expect(found.answered, `request ${id} should still wait for the person`).toBeUndefined();
    return found;
  };
  const releasedAt = async (botId: string, thread: string) =>
    (await api("GET", "/api/bots")).bots.find((b: any) => b.id === botId).tasks.find((t: any) => t.threadId === thread)?.releasedAt;
  const decisions = async (requestId: string) => (await api("GET", "/api/decisions?limit=500")).decisions.filter((row: any) => row.requestId === requestId);
  const start = async (bot: any, thread = bot.threadId) => {
    const dump = join(dataDir, "fake-claude-dump.json");
    rmSync(dump, { force: true });
    await api("POST", `/api/bots/${bot.id}/messages`, { threadId: thread, text: "Hold this verification task while its approvals are exercised." }, 202);
    await expect.poll(() => existsSync(dump), { timeout: 15_000 }).toBe(true);
    return JSON.parse(readFileSync(dump, "utf8")).mcpConfig.mcpServers.ogb.args.at(-1) as string;
  };
  const ask = async (socketPath: string, command: string, tool = "Bash", kind?: "question") => {
    const socket = connect(socketPath);
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => { socket.once("connect", resolve); socket.once("error", reject); });
    const id = randomUUID();
    let buffer = "";
    const reply = new Promise<any>((resolve, reject) => {
      socket.once("error", reject);
      socket.once("close", () => reject(new Error(`Permission socket closed before its reply: ${id}`)));
      socket.setTimeout(10_000, () => socket.destroy(new Error(`Permission reply timed out: ${id}`)));
      socket.on("data", chunk => {
        buffer += chunk;
        if (!buffer.includes("\n")) return;
        socket.setTimeout(0);
        resolve(JSON.parse(buffer.split("\n")[0]!));
      });
    });
    void reply.catch(() => {});
    const input = kind === "question" ? { question: command } : { command };
    socket.write(JSON.stringify({ t: "ask", id, ...(kind ? { kind } : {}), tool, input }) + "\n");
    return { id, reply };
  };
  const stop = (bot: any, thread = bot.threadId) => api("POST", `/api/bots/${bot.id}/interrupt`, { threadId: thread });
  const create = async (name: string) => {
    const bot = (await api("POST", "/api/bots", { name, modelSelection: { instanceId: "claude", model: "claude-sonnet-5" } }, 201)).bot;
    await api("PATCH", `/api/bots/${bot.id}`, { approvalMode: "ask" });
    return bot;
  };
  const closeSockets = () => { for (const socket of sockets) socket.destroy(); };
  return { api, card, pendingCard, releasedAt, decisions, start, ask, stop, create, closeSockets };
}

it("releases one task so every pending and later request in it is allowed, critical ones included, until revoked, and survives a restart", async () => {
  const fixture = await launchVerificationServer({ FAKE_CLAUDE_MODE: "hang" });
  const { url, dataDir, logPath } = fixture.info;
  const { api, card, pendingCard, releasedAt, decisions, start, ask, stop, create, closeSockets } = harness(fixture);
  let restarted: ChildProcess | undefined;
  try {
    const alpha = await create("Task release fixture A");
    const beta = await create("Task release fixture B");
    const t1 = alpha.threadId;

    const socket1 = await start(alpha);
    const first = await ask(socket1, "printf 'first'");
    expect((await pendingCard(t1, first.id)).canReleaseTask).toBe(true);
    const released = await api("POST", `/api/threads/${t1}/respond`, { requestId: first.id, behavior: "allow", releaseTask: true });
    expect(released).toMatchObject({ ok: true, released: true, answered: 1 });
    expect(await first.reply).toMatchObject({ id: first.id, behavior: "allow" });
    expect(await card(t1, first.id)).toMatchObject({ answered: "allow", answeredBy: { kind: "loopback" } });
    expect((await card(t1, first.id)).releasedTask).toBeUndefined();
    expect(typeof await releasedAt(alpha.id, t1)).toBe("number");

    const second = await ask(socket1, "printf 'second'");
    expect(await second.reply).toMatchObject({ id: second.id, behavior: "allow" });
    await expect.poll(async () => (await card(t1, second.id))?.releasedTask, { timeout: 10_000 }).toBe(true);
    expect(await card(t1, second.id)).toMatchObject({ answered: "allow", releasedTask: true, requestType: "permission", tool: "Bash", answeredBy: { kind: "loopback" } });
    await expect.poll(async () => (await decisions(second.id)).length, { timeout: 10_000 }).toBeGreaterThan(0);
    expect((await decisions(second.id)).map((row: any) => [row.decision, row.source])).toEqual([["auto-approved", "task-release"]]);

    const critical = await ask(socket1, "sudo systemctl restart nginx");
    expect(await critical.reply).toMatchObject({ id: critical.id, behavior: "allow" });
    await expect.poll(async () => (await card(t1, critical.id))?.releasedTask, { timeout: 10_000 }).toBe(true);

    const question = await ask(socket1, "Qual cor?", "ask_user", "question");
    expect((await pendingCard(t1, question.id)).requestType).toBe("question");
    await api("POST", `/api/threads/${t1}/respond`, { requestId: question.id, behavior: "answer", message: "azul" });
    expect(await question.reply).toMatchObject({ id: question.id, message: "azul" });
    const disguised = await ask(socket1, "", "AskUserQuestion");
    expect((await pendingCard(t1, disguised.id)).canReleaseTask).toBeUndefined();
    await api("POST", `/api/threads/${t1}/respond`, { requestId: disguised.id, behavior: "deny" });
    expect(await disguised.reply).toMatchObject({ id: disguised.id, behavior: "deny" });

    const t2 = (await api("POST", `/api/bots/${alpha.id}/tasks`, { title: "Another task" }, 201)).task.threadId;
    const socket2 = await start(alpha, t2);
    const other = await ask(socket2, "printf 'other task'");
    await pendingCard(t2, other.id);
    expect(await releasedAt(alpha.id, t2)).toBeUndefined();
    const together = [await ask(socket2, "printf 'two'"), await ask(socket2, "printf 'three'")];
    await pendingCard(t2, together[1]!.id);
    const releasedTogether = await api("POST", `/api/threads/${t2}/respond`, { requestId: together[0]!.id, behavior: "allow", releaseTask: true });
    expect(releasedTogether).toMatchObject({ ok: true, released: true, answered: 3 });
    for (const request of [other, ...together]) expect(await request.reply).toMatchObject({ id: request.id, behavior: "allow" });
    expect(await card(t2, together[0]!.id)).toMatchObject({ answered: "allow", answeredBy: { kind: "loopback" } });
    expect((await card(t2, together[0]!.id)).releasedTask).toBeUndefined();
    expect(await card(t2, other.id)).toMatchObject({ answered: "allow", releasedTask: true, answeredBy: { kind: "loopback" } });
    expect(await card(t2, together[1]!.id)).toMatchObject({ answered: "allow", releasedTask: true, answeredBy: { kind: "loopback" } });
    expect((await decisions(other.id)).map((row: any) => [row.decision, row.source, row.rule])).toEqual([["card-shown", "no-grant", undefined], ["user-approved", "user", "task-release"]]);
    await stop(alpha, t2);

    const socketBeta = await start(beta);
    const fromBeta = await ask(socketBeta, "printf 'beta'");
    await pendingCard(beta.threadId, fromBeta.id);
    await api("POST", `/api/threads/${beta.threadId}/respond`, { requestId: fromBeta.id, behavior: "deny" });
    expect(await fromBeta.reply).toMatchObject({ id: fromBeta.id, behavior: "deny" });
    await stop(beta);

    await api("DELETE", `/api/bots/${alpha.id}/tasks/${t1}/release`);
    expect(await releasedAt(alpha.id, t1)).toBeUndefined();
    const afterRevoke = await ask(socket1, "printf 'after revoke'");
    expect((await pendingCard(t1, afterRevoke.id)).canReleaseTask).toBe(true);
    await api("POST", `/api/threads/${t1}/respond`, { requestId: afterRevoke.id, behavior: "allow", releaseTask: true });
    expect(await afterRevoke.reply).toMatchObject({ id: afterRevoke.id, behavior: "allow" });
    await stop(alpha);

    await waitForExit(fixture.child, { signal: "SIGTERM" });
    const log = openSync(logPath, "a", 0o600);
    restarted = spawn(process.execPath, ["--experimental-strip-types", fileURLToPath(new URL("./index.ts", import.meta.url))], {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      env: verificationServerEnvironment({ FAKE_CLAUDE_MODE: "hang" }, dataDir, Number(new URL(url).port)),
      stdio: ["ignore", log, log],
    });
    closeSync(log);
    await expect.poll(async () => {
      try { return (await fetch(url + "/api/health", { signal: AbortSignal.timeout(1000) })).ok; } catch { return false; }
    }, { timeout: 20_000 }).toBe(true);
    expect(typeof await releasedAt(alpha.id, t1)).toBe("number");
    const restartedSocket = await start(alpha);
    const restored = await ask(restartedSocket, "printf 'after restart'");
    expect(await restored.reply).toMatchObject({ id: restored.id, behavior: "allow" });
    await expect.poll(async () => (await card(t1, restored.id))?.releasedTask, { timeout: 10_000 }).toBe(true);
    await stop(alpha);
    console.info(`Task release real-server verification passed; isolated log: ${logPath}`);
  } finally {
    closeSockets();
    await waitForExit(restarted, { signal: "SIGTERM" });
    await fixture.close();
  }
}, 120_000);

it("with the safety floor on, a release leaves a never-list command pending for the person and never allows one later", async () => {
  const fixture = await launchVerificationServer({ FAKE_CLAUDE_MODE: "hang" });
  const { api, pendingCard, decisions, start, ask, stop, create, closeSockets } = harness(fixture);
  try {
    await api("PATCH", "/api/config", { safetyFloor: { enabled: true } });
    const bot = await create("Task release fixture with floor");
    const thread = bot.threadId;
    const socket = await start(bot);
    const safe = await ask(socket, "printf 'safe'");
    const wipe = await ask(socket, "rm -rf /");
    await pendingCard(thread, safe.id);
    await pendingCard(thread, wipe.id);
    const released = await api("POST", `/api/threads/${thread}/respond`, { requestId: safe.id, behavior: "allow", releaseTask: true });
    expect(released).toMatchObject({ ok: true, released: true, answered: 1 });
    expect(await safe.reply).toMatchObject({ id: safe.id, behavior: "allow" });
    const held = await pendingCard(thread, wipe.id);
    expect(held.canReleaseTask).toBe(true);
    expect(held.releasedTask).toBeUndefined();
    await api("POST", `/api/threads/${thread}/respond`, { requestId: wipe.id, behavior: "deny" });
    expect(await wipe.reply).toMatchObject({ id: wipe.id, behavior: "deny" });

    const later = await ask(socket, "rm -rf /");
    expect(await later.reply).toMatchObject({ id: later.id, behavior: "deny" });
    await expect.poll(async () => (await decisions(later.id)).length, { timeout: 10_000 }).toBeGreaterThan(0);
    expect((await decisions(later.id)).map((row: any) => [row.decision, row.source])).toEqual([["auto-denied", "safety-floor"]]);
    const plain = await ask(socket, "printf 'still released'");
    expect(await plain.reply).toMatchObject({ id: plain.id, behavior: "allow" });
    await stop(bot);
  } finally {
    closeSockets();
    await fixture.close();
  }
}, 120_000);
