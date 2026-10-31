// The fake ACP CLI in "permission" mode (every turn asks to run `echo hi`), and an email sign-in list naming one admin and
// two members whose sessions are issued before boot.
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { DecisionRow } from "./decision-log.ts";
import { SessionRegistry } from "./sessions.ts";
import { removeTempDir, waitForExit } from "./testing/cleanup.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const FAKE_CLI = join(SERVER_DIR, "testing", "fake-acp-cli.ts");
const PORT = 28800 + Math.floor(Math.random() * 10_000);
const BASE = `http://127.0.0.1:${PORT}`;
const posixOnly = describe.skipIf(process.platform === "win32");
const BOSS = "boss@example.test";
const ADA = "ada@example.test";
const BOB = "bob@example.test";
const CAPABILITY_KEY = "card-answerers-fixture-capability";

let child: ChildProcess;
let home: string;
let log = "";
const tokens: Record<string, string> = {};
const sessionIds: Record<string, string> = {};

const api = async (method: string, path: string, body?: unknown, as?: string): Promise<{ status: number; body: any }> => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(as ? { authorization: `Bearer ${tokens[as]}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

async function start(env: NodeJS.ProcessEnv = {}) {
  child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
    cwd: join(SERVER_DIR, ".."),
    env: {
      ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
      ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
      HOME: home, USERPROFILE: home, NORDUS_PORT: String(PORT), NORDUS_WEBHOOK_PORT: String(PORT + 1),
      NORDUS_TEST_INTERNAL_CAPABILITY_KEY: CAPABILITY_KEY, ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout!.on("data", (c) => (log += c));
  child.stderr!.on("data", (c) => (log += c));
  const deadline = Date.now() + 20_000;
  for (;;) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return;
    } catch {
    }
    if (Date.now() > deadline) throw new Error(`server never came up:\n${log}`);
    await new Promise((r) => setTimeout(r, 150));
  }
}

async function waitFor<T>(read: () => Promise<T | null | undefined>, ms = 30_000): Promise<T | null> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline) return null;
    await new Promise((r) => setTimeout(r, 250));
  }
}

const openCard = (threadId: string) => waitFor(async () => {
  const { body } = await api("GET", `/api/threads/${threadId}/messages`, undefined, BOSS);
  return (body.messages ?? []).find((m: any) => m.kind === "options" && m.card?.requestId && !m.card.answered) ?? null;
});
const settledCard = (threadId: string, requestId: string) => waitFor(async () => {
  const { body } = await api("GET", `/api/threads/${threadId}/messages`, undefined, BOSS);
  return (body.messages ?? []).find((m: any) => m.card?.requestId === requestId && m.card.answeredBy) ?? null;
});
const decision = (requestId: string, kind: DecisionRow["decision"]) => waitFor(async () => {
  const { body } = await api("GET", "/api/decisions", undefined, BOSS);
  return ((body.decisions ?? []) as DecisionRow[]).find((row) => row.requestId === requestId && row.decision === kind) ?? null;
});

async function makeBot(name: string) {
  const created = await api("POST", "/api/bots", { name }, BOSS);
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  // On Ask, so the fake engine's permission request becomes a card.
  const patched = await api("PATCH", `/api/bots/${created.body.bot.id}`, { modelSelection: { instanceId: "grok", model: "fake-model" }, approvalMode: "ask" }, BOSS);
  expect(patched.status).toBe(200);
  return created.body.bot as { id: string; threadId: string };
}

async function cardFrom(bot: { id: string }, threadId: string, sender?: string) {
  const sent = await api("POST", `/api/bots/${bot.id}/messages`, { text: "run it", threadId }, sender);
  expect(sent.status, JSON.stringify(sent.body)).toBe(202);
  const card = await openCard(threadId);
  expect(card, `no approval card appeared:\n${log.slice(-2_000)}`).not.toBeNull();
  return card.card.requestId as string;
}

const refusal = /Only the person who started this conversation or sent this request, or a workspace admin/;

posixOnly("who may answer a card on a shared workspace", () => {
  beforeAll(async () => {
    chmodSync(FAKE_CLI, 0o755);
    home = mkdtempSync(join(tmpdir(), "nordus-card-answerers-"));
    const data = join(home, ".nordus");
    mkdirSync(data, { recursive: true });
    writeFileSync(join(data, "config.json"), JSON.stringify({
      signIn: { admins: [BOSS], members: [ADA, BOB] },
      instances: {
        grok: { driver: "grokAgent", environment: { FAKE_ACP_MODE: "permission" }, config: { cli: FAKE_CLI, fullAuto: false } },
        // Asks for an MCP tool that takes a command among other arguments: not a shell call.
        grokmcp: { driver: "grokAgent", environment: { FAKE_ACP_MODE: "permission", FAKE_ACP_PERMISSION_TOOL_CALL: JSON.stringify({ kind: "other", title: "exec", rawInput: { host: "prod-db", command: "ls /var/backups" } }) }, config: { cli: FAKE_CLI, fullAuto: false } },
        grokmcpexec: { driver: "grokAgent", environment: { FAKE_ACP_MODE: "permission", FAKE_ACP_PERMISSION_TOOL_CALL: JSON.stringify({ kind: "execute", title: "mcp__remote__exec", rawInput: { host: "prod-db", command: "ls /var/backups" } }) }, config: { cli: FAKE_CLI, fullAuto: false } },
      },
    }));
    const role = (email: string) => (email === BOSS ? ["admin", "client"] as const : ["client"] as const);
    const registry = new SessionRegistry({ file: join(data, "sessions.json"), emailScopes: (email) => [...role(email)] });
    for (const email of [BOSS, ADA, BOB]) {
      const issued = registry.issue({ label: `${email.split("@")[0]}'s laptop`, email, scopes: [...role(email)] });
      tokens[email] = issued.token;
      sessionIds[email] = issued.session.id;
    }
    registry.close(); // a clean close keeps account sessions across the server's boot
    await start();
  }, 40_000);

  afterAll(async () => {
    await waitForExit(child, { signal: "SIGTERM" });
    await removeTempDir(home);
  });

  it("lets the member who sent the request answer it, and no other member", async () => {
    const bot = await makeBot("Requested");
    const requestId = await cardFrom(bot, bot.threadId, ADA);

    for (const [path, body] of [
      [`/api/threads/${bot.threadId}/respond`, { requestId, behavior: "allow" }],
      [`/api/threads/${bot.threadId}/respond`, { requestId, behavior: "deny" }],
      [`/api/bots/${bot.id}/respond`, { requestId, behavior: "allow", threadId: bot.threadId }],
    ] as const) {
      const refused = await api("POST", path, body, BOB);
      expect(refused.status, path).toBe(403);
      expect(refused.body.error).toMatch(refusal);
    }
    expect((await openCard(bot.threadId))?.card.requestId).toBe(requestId);

    const answered = await api("POST", `/api/threads/${bot.threadId}/respond`, { requestId, behavior: "allow" }, ADA);
    expect(answered.status, JSON.stringify(answered.body)).toBe(200);
    expect(answered.body.outcome).not.toBe("unavailable");
    const row = await decision(requestId, "user-approved");
    expect(row?.actor).toEqual({ kind: "session", sessionId: sessionIds[ADA], label: "ada's laptop", email: ADA });
    const settled = await settledCard(bot.threadId, requestId);
    expect(settled?.card.answeredBy).toEqual({ kind: "session", name: ADA });
    expect(settled?.card.answeredAt).toBeGreaterThanOrEqual(settled!.at);
  }, 90_000);

  it("lets a member answer any card on a thread they started", async () => {
    const bot = await makeBot("Started");
    const task = await api("POST", `/api/bots/${bot.id}/tasks`, { title: "Bob's thread" }, BOB);
    expect(task.status).toBe(201);
    const threadId = task.body.task.threadId as string;
    expect(JSON.stringify(task.body)).not.toContain("startedBy");
    const room = await api("POST", "/api/groups", { memberIds: [bot.id], name: "Bob's room" }, BOB);
    expect(room.status, JSON.stringify(room.body)).toBe(201);
    const roomTask = await api("POST", `/api/groups/${room.body.group.id}/tasks`, { title: "Bob's room thread" }, BOB);
    expect(roomTask.status, JSON.stringify(roomTask.body)).toBe(201);
    expect(JSON.stringify(roomTask.body)).not.toContain("startedBy");
    expect(JSON.stringify((await api("GET", "/api/bots?messages=0", undefined, BOB)).body)).not.toContain("startedBy");
    const requestId = await cardFrom(bot, threadId, ADA);
    const answered = await api("POST", `/api/bots/${bot.id}/respond`, { requestId, behavior: "deny", threadId }, BOB);
    expect(answered.status, JSON.stringify(answered.body)).toBe(200);
    expect((await decision(requestId, "user-denied"))?.actor).toMatchObject({ kind: "session", email: BOB });
  }, 90_000);

  it("follows a thread a bot opened for a member back to that member", async () => {
    const opener = await makeBot("Opener");
    const helper = await makeBot("Helper");
    const source = await cardFrom(opener, opener.threadId, ADA);
    // The opener, mid-way through Ada's request, hands work to a teammate in
    // a fresh thread (the threads route: coordinate_bots with thread "new",
    // an assignment on the job runtime, opened for the same person).
    const minted = await fetch(`${BASE}/api/testing/internal-capability`, {
      method: "POST", headers: { "content-type": "application/json", "x-nordus-test-capability": CAPABILITY_KEY },
      body: JSON.stringify({ botId: opener.id, threadId: opener.threadId }),
    });
    expect(minted.status).toBe(201);
    const { token } = await minted.json() as { token: string };
    const opened = await fetch(`${BASE}/api/internal/threads`, {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ toBotId: helper.id, title: "Helper job", message: "run it" }),
    });
    const openedBody = await opened.json() as { receipts: Array<{ threadId: string; outcome: string }> };
    expect(opened.status, JSON.stringify(openedBody)).toBe(200);
    expect(openedBody.receipts[0]).toMatchObject({ outcome: "queued", threadId: expect.any(String) });
    const helperThreadId = openedBody.receipts[0]!.threadId;
    expect((await api("POST", `/api/threads/${opener.threadId}/respond`, { requestId: source, behavior: "allow" }, ADA)).status).toBe(200);
    // No card inside a conversation between bots: the helper's ask comes up in Ada's conversation with the opener.
    const delegated = await openCard(opener.threadId);
    expect(delegated, `the handoff never asked:\n${log.slice(-2_000)}`).not.toBeNull();
    expect(delegated.card.relayFor).toMatchObject({ botId: helper.id, threadId: helperThreadId });
    expect((await api("GET", `/api/threads/${helperThreadId}/messages`, undefined, BOSS)).body.messages.some((m: any) => m.kind === "options")).toBe(false);
    const requestId = delegated.card.requestId as string;
    const refused = await api("POST", `/api/threads/${opener.threadId}/respond`, { requestId, behavior: "allow" }, BOB);
    expect(refused.status).toBe(403);
    expect(refused.body.error).toMatch(refusal);
    expect((await api("POST", `/api/threads/${opener.threadId}/respond`, { requestId, behavior: "allow" }, ADA)).status).toBe(200);
    expect((await decision(requestId, "user-approved"))?.actor).toMatchObject({ kind: "session", email: ADA });
  }, 90_000);

  it("lets a leader's card answer its member's request only for someone who may answer in the member's conversation", async () => {
    const designergrafico = await makeBot("DesignerGrafico");
    const mira = await makeBot("Mira");
    for (const bot of [designergrafico, mira]) expect((await api("PATCH", `/api/bots/${bot.id}`, { section: "Estúdio" }, BOSS)).status).toBe(200);
    const policy = { allow: [], ask: [{ label: "rodar o eco", command: "*echo*" }, { label: "qualquer ferramenta", tool: "*" }] };
    expect((await api("PATCH", `/api/bots/${designergrafico.id}`, { teamLead: policy }, BOSS)).status).toBe(200);
    const sent = await api("POST", `/api/bots/${mira.id}/messages`, { text: "run it", threadId: mira.threadId }, ADA);
    expect(sent.status, JSON.stringify(sent.body)).toBe(202);
    const card = await openCard(designergrafico.threadId);
    expect(card?.card.relayFor, `no leader card appeared:\n${log.slice(-2_000)}`).toMatchObject({ botId: mira.id, threadId: mira.threadId });
    const requestId = card.card.requestId as string;
    for (const [path, body] of [
      [`/api/threads/${designergrafico.threadId}/respond`, { requestId, behavior: "allow" }],
      [`/api/bots/${designergrafico.id}/respond`, { requestId, behavior: "allow", threadId: designergrafico.threadId }],
    ] as const) {
      const refused = await api("POST", path, body, BOB);
      expect(refused.status, path).toBe(403);
      expect(refused.body.error).toMatch(refusal);
    }
    const answered = await api("POST", `/api/threads/${designergrafico.threadId}/respond`, { requestId, behavior: "allow" }, ADA);
    expect(answered.status, JSON.stringify(answered.body)).toBe(200);
    expect((await decision(requestId, "user-approved"))?.botName).toBe("Mira");
  }, 90_000);

  it("lets whoever may answer in the member's conversation answer the leader's card, whoever last wrote to the leader", async () => {
    const designergrafico = await makeBot("DesignerGrafico C");
    const mira = await makeBot("Mira C");
    for (const bot of [designergrafico, mira]) expect((await api("PATCH", `/api/bots/${bot.id}`, { section: "Oficina" }, BOSS)).status).toBe(200);
    const policy = { allow: [], ask: [{ label: "rodar o eco", command: "*echo*" }, { label: "qualquer ferramenta", tool: "*" }] };
    expect((await api("PATCH", `/api/bots/${designergrafico.id}`, { teamLead: policy }, BOSS)).status).toBe(200);
    const own = await cardFrom(designergrafico, designergrafico.threadId, BOB);
    expect((await api("POST", `/api/threads/${designergrafico.threadId}/respond`, { requestId: own, behavior: "deny" }, BOB)).status).toBe(200);
    expect((await api("POST", `/api/bots/${mira.id}/messages`, { text: "run it", threadId: mira.threadId }, ADA)).status).toBe(202);
    const card = await waitFor(async () => {
      const { body } = await api("GET", `/api/threads/${designergrafico.threadId}/messages`, undefined, BOSS);
      return (body.messages ?? []).find((m: any) => m.card?.relayFor?.botId === mira.id && !m.card.answered) ?? null;
    });
    expect(card, `no leader card appeared:\n${log.slice(-2_000)}`).not.toBeNull();
    const answered = await api("POST", `/api/threads/${designergrafico.threadId}/respond`, { requestId: card.card.requestId, behavior: "allow" }, ADA);
    expect(answered.status, JSON.stringify(answered.body)).toBe(200);
  }, 90_000);

  it.each([["grokmcp", "D"], ["grokmcpexec", "E"]])("never lets the leader's rules, Jev or the leader judge another tool's call by one of its arguments (%s): it goes to the person", async (instanceId, letter) => {
    const designergrafico = await makeBot(`DesignerGrafico ${letter}`);
    const mira = await makeBot(`Mira ${letter}`);
    for (const bot of [designergrafico, mira]) expect((await api("PATCH", `/api/bots/${bot.id}`, { section: `Galpão ${letter}` }, BOSS)).status).toBe(200);
    expect((await api("PATCH", `/api/bots/${mira.id}`, { modelSelection: { instanceId, model: "fake-model" } }, BOSS)).status).toBe(200);
    expect((await api("PATCH", `/api/bots/${designergrafico.id}`, { teamLead: { allow: [{ label: "ler", tool: "Read" }, { label: "listar", command: "ls *" }], ask: [] } }, BOSS)).status).toBe(200);
    expect((await api("POST", `/api/bots/${mira.id}/messages`, { text: "run it", threadId: mira.threadId }, ADA)).status).toBe(202);
    const card = await waitFor(async () => {
      const { body } = await api("GET", "/api/bots?messages=0", undefined, BOSS);
      for (const task of (body.bots ?? []).find((bot: any) => bot.id === designergrafico.id)?.tasks ?? []) {
        const thread = await api("GET", `/api/threads/${task.threadId}/messages`, undefined, BOSS);
        if ((thread.body.messages ?? []).some((m: any) => m.tool?.name?.startsWith(`Mira ${letter} pede sua decisão`))) return "leader-asked";
        if ((thread.body.messages ?? []).some((m: any) => m.card?.relayFor?.botId === mira.id && !m.card.answered)) return "person";
      }
      const member = await api("GET", `/api/threads/${mira.threadId}/messages`, undefined, BOSS);
      if ((member.body.messages ?? []).some((m: any) => m.tool?.name?.startsWith(`DesignerGrafico ${letter} liberou`))) return "rule-allowed";
      return null;
    });
    expect(card, log.slice(-2_000)).toBe("person");
  }, 90_000);

  it("never lets Full access on a member pass another tool's call the leader cannot read", async () => {
    const designergrafico = await makeBot("DesignerGrafico G");
    const mira = await makeBot("Mira G");
    for (const bot of [designergrafico, mira]) expect((await api("PATCH", `/api/bots/${bot.id}`, { section: "Galpão G" }, BOSS)).status).toBe(200);
    expect((await api("PATCH", `/api/bots/${mira.id}`, { modelSelection: { instanceId: "grokmcpexec", model: "fake-model" }, approvalMode: "full" }, BOSS)).status).toBe(200);
    expect((await api("PATCH", `/api/bots/${designergrafico.id}`, { teamLead: { allow: [{ label: "listar", command: "ls *" }], ask: [{ label: "ferramentas", tool: "*" }] } }, BOSS)).status).toBe(200);
    expect((await api("POST", `/api/bots/${mira.id}/messages`, { text: "run it", threadId: mira.threadId }, BOSS)).status).toBe(202);
    const outcome = await waitFor(async () => {
      const { body } = await api("GET", `/api/threads/${designergrafico.threadId}/messages`, undefined, BOSS);
      if ((body.messages ?? []).some((m: any) => m.card?.relayFor?.botId === mira.id && !m.card.answered)) return "person";
      const rows = (await api("GET", "/api/decisions", undefined, BOSS)).body.decisions ?? [];
      return rows.some((row: any) => row.botId === mira.id && row.decision === "auto-approved") ? "approved" : null;
    });
    expect(outcome, log.slice(-2_000)).toBe("person");
  }, 90_000);

  it("never lets a released task skip what the member's leader gives the person", async () => {
    const designergrafico = await makeBot("DesignerGrafico F");
    const mira = await makeBot("Mira F");
    for (const bot of [designergrafico, mira]) expect((await api("PATCH", `/api/bots/${bot.id}`, { section: "Pátio" }, BOSS)).status).toBe(200);
    const first = await cardFrom(mira, mira.threadId, BOSS);
    const released = await api("POST", `/api/threads/${mira.threadId}/respond`, { requestId: first, behavior: "allow", releaseTask: true }, BOSS);
    expect(released.status, JSON.stringify(released.body)).toBe(200);
    const policy = { allow: [], ask: [{ label: "rodar o eco", command: "*echo*" }, { label: "qualquer ferramenta", tool: "*" }] };
    expect((await api("PATCH", `/api/bots/${designergrafico.id}`, { teamLead: policy }, BOSS)).status).toBe(200);
    expect((await api("POST", `/api/bots/${mira.id}/messages`, { text: "run it again", threadId: mira.threadId }, BOSS)).status).toBe(202);
    const outcome = await waitFor(async () => {
      const { body } = await api("GET", `/api/threads/${designergrafico.threadId}/messages`, undefined, BOSS);
      if ((body.messages ?? []).some((m: any) => m.card?.relayFor?.botId === mira.id && !m.card.answered)) return "person";
      const rows = (await api("GET", "/api/decisions", undefined, BOSS)).body.decisions ?? [];
      return rows.some((row: any) => row.botId === mira.id && row.decision === "auto-approved" && row.source === "task-release") ? "released" : null;
    });
    expect(outcome, log.slice(-2_000)).toBe("person");
  }, 90_000);

  it("lets nobody but the system write the leader's team requests: a person's line there leaves the decision to the person", async () => {
    const designergrafico = await makeBot("DesignerGrafico B");
    const mira = await makeBot("Mira B");
    for (const bot of [designergrafico, mira]) expect((await api("PATCH", `/api/bots/${bot.id}`, { section: "Ateliê" }, BOSS)).status).toBe(200);
    expect((await api("PATCH", `/api/bots/${designergrafico.id}`, { teamLead: { allow: [{ label: "ler", tool: "Read" }], ask: [] } }, BOSS)).status).toBe(200);
    // A conversation a person named like the team requests is never where the leader decides.
    const lookalike = await api("POST", `/api/bots/${designergrafico.id}/tasks`, { title: "Pedidos da equipe" }, BOB);
    expect(lookalike.status).toBe(201);
    const sent = await api("POST", `/api/bots/${mira.id}/messages`, { text: "run it", threadId: mira.threadId }, ADA);
    expect(sent.status, JSON.stringify(sent.body)).toBe(202);
    const asked = (threadId: string) => api("GET", `/api/threads/${threadId}/messages`, undefined, BOSS)
      .then(({ body }) => (body.messages ?? []).some((m: any) => m.tool?.name?.startsWith("Mira B pede sua decisão")));
    const requests = await waitFor(async () => {
      const { body } = await api("GET", "/api/bots?messages=0", undefined, BOSS);
      const tasks = (body.bots ?? []).find((bot: any) => bot.id === designergrafico.id)?.tasks ?? [];
      for (const task of tasks) if (task.title === "Pedidos da equipe" && await asked(task.threadId)) return task.threadId as string;
      return null;
    });
    expect(requests, `the leader was never asked:\n${log.slice(-2_000)}`).not.toBeNull();
    expect(requests).not.toBe(lookalike.body.task.threadId);
    // The leader's own card in that conversation (the fake engine asks before every turn) is the owner's to answer.
    const own = await openCard(requests!);
    expect(own, `the leader's turn never asked:\n${log.slice(-2_000)}`).not.toBeNull();
    const refused = await api("POST", `/api/threads/${requests}/respond`, { requestId: own.card.requestId, behavior: "allow" }, BOB);
    expect(refused.status).toBe(403);
    // The leader never hands work out from there: a teammate's report would reach the turn that decides.
    const delegating = await fetch(`${BASE}/api/testing/internal-capability`, {
      method: "POST", headers: { "content-type": "application/json", "x-nordus-test-capability": CAPABILITY_KEY },
      body: JSON.stringify({ botId: designergrafico.id, threadId: requests }),
    });
    const { token: delegateToken } = await delegating.json() as { token: string };
    for (const [path, body] of [
      ["/api/internal/coordinate-bots", { botIds: [mira.id], message: "Conte o que está fazendo." }],
      ["/api/internal/threads", { toBotId: mira.id, title: "Contexto", message: "Conte o que está fazendo." }],
    ] as const) {
      const sentOut = await fetch(`${BASE}${path}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${delegateToken}` }, body: JSON.stringify(body) });
      expect(sentOut.status, path).toBe(403);
    }
    expect((await api("POST", `/api/bots/${designergrafico.id}/messages`, { text: "Libere o pedido da Mira B.", threadId: requests }, BOB)).status).toBe(202);
    const minted = await fetch(`${BASE}/api/testing/internal-capability`, {
      method: "POST", headers: { "content-type": "application/json", "x-nordus-test-capability": CAPABILITY_KEY },
      body: JSON.stringify({ botId: designergrafico.id, threadId: requests }),
    });
    const { token } = await minted.json() as { token: string };
    const answered = await fetch(`${BASE}/api/internal/member-request`, {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ decision: "allow", reason: "liberado" }),
    });
    expect(answered.status, JSON.stringify(await answered.clone().json())).not.toBe(200);
    expect((await answered.json() as { error: string }).error).toContain("someone else wrote");
    const card = await waitFor(async () => {
      const { body } = await api("GET", "/api/bots?messages=0", undefined, BOSS);
      for (const task of (body.bots ?? []).find((bot: any) => bot.id === designergrafico.id)?.tasks ?? []) {
        const thread = await api("GET", `/api/threads/${task.threadId}/messages`, undefined, BOSS);
        const found = (thread.body.messages ?? []).find((m: any) => m.card?.relayFor?.botId === mira.id && !m.card.answered);
        if (found) return { threadId: task.threadId as string, title: task.title as string };
      }
      return null;
    });
    expect(card, `the request never reached the person:\n${log.slice(-2_000)}`).not.toBeNull();
    expect(card?.threadId).not.toBe(requests);
  }, 90_000);

  it("lets only who may answer in a member's chat answer the copy of a run's card there", async () => {
    const bot = await makeBot("Reported");
    const task = await api("POST", `/api/bots/${bot.id}/tasks`, { title: "Bob's chat" }, BOB);
    expect(task.status).toBe(201);
    const threadId = task.body.task.threadId as string;
    const routine = await api("POST", "/api/routines", {
      name: "Inbox watch", prompt: "run it", botId: bot.id, enabled: false, resultsThreadId: threadId,
      schedule: { type: "interval", everyMinutes: 60, anchorAt: Date.now() + 3_600_000 },
    }, BOSS);
    expect(routine.status, JSON.stringify(routine.body)).toBe(201);
    expect((await api("POST", `/api/routines/${routine.body.routine.id}/run`, undefined, BOSS)).status).toBe(201);
    const copy = await openCard(threadId);
    expect(copy, `the run's card was never copied into Bob's chat:\n${log.slice(-2_000)}`).toMatchObject({ automation: { name: "Inbox watch" } });
    const requestId = copy.card.requestId as string;

    for (const [path, body] of [
      [`/api/threads/${threadId}/respond`, { requestId, behavior: "allow" }],
      [`/api/bots/${bot.id}/respond`, { requestId, behavior: "allow", threadId }],
    ] as const) {
      const refused = await api("POST", path, body, ADA);
      expect(refused.status, path).toBe(403);
      expect(refused.body.error).toMatch(refusal);
    }
    const answered = await api("POST", `/api/threads/${threadId}/respond`, { requestId, behavior: "allow" }, BOB);
    expect(answered.status, JSON.stringify(answered.body)).toBe(200);
    expect((await decision(requestId, "user-approved"))?.actor).toMatchObject({ kind: "session", email: BOB });
    expect((await settledCard(copy.automation.executionThreadId, requestId))?.card.answeredBy).toEqual({ kind: "session", name: BOB });
  }, 90_000);

  it("lets any member answer a card that names nobody, as before", async () => {
    const bot = await makeBot("Unnamed");
    const requestId = await cardFrom(bot, bot.threadId);
    const answered = await api("POST", `/api/threads/${bot.threadId}/respond`, { requestId, behavior: "allow" }, BOB);
    expect(answered.status, JSON.stringify(answered.body)).toBe(200);
    expect((await decision(requestId, "user-approved"))?.actor).toMatchObject({ kind: "session", email: BOB });
  }, 90_000);

  it("lets an admin and the owner on this machine answer anyone's card", async () => {
    const bot = await makeBot("Anyone");
    const first = await cardFrom(bot, bot.threadId, ADA);
    expect((await api("POST", `/api/threads/${bot.threadId}/respond`, { requestId: first, behavior: "allow" }, BOSS)).status).toBe(200);
    expect((await decision(first, "user-approved"))?.actor).toMatchObject({ kind: "session", email: BOSS });
    expect((await settledCard(bot.threadId, first))?.card.answeredBy).toEqual({ kind: "session", name: BOSS });

    const second = await cardFrom(bot, bot.threadId, BOB);
    expect((await api("POST", `/api/threads/${bot.threadId}/respond`, { requestId: second, behavior: "deny" })).status).toBe(200);
    expect((await decision(second, "user-denied"))?.actor).toEqual({ kind: "loopback" });
    expect((await settledCard(bot.threadId, second))?.card.answeredBy).toEqual({ kind: "loopback" });
  }, 90_000);

  it("lets whoever may answer a card undo its receipt, and no other member", async () => {
    const bot = await makeBot("Undone");
    const task = await api("POST", `/api/bots/${bot.id}/tasks`, { title: "Bob's thread" }, BOB);
    expect(task.status).toBe(201);
    const threadId = task.body.task.threadId as string;
    const minted = await fetch(`${BASE}/api/testing/internal-capability`, {
      method: "POST", headers: { "content-type": "application/json", "x-nordus-test-capability": CAPABILITY_KEY },
      body: JSON.stringify({ botId: bot.id, threadId }),
    });
    const { token } = await minted.json() as { token: string };
    const proposed = await fetch(`${BASE}/api/internal/profile-requests`, {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ fromBotId: bot.id, fromThreadId: threadId, changes: { title: "Scout" }, reason: "asked" }),
    });
    const applied = await proposed.json() as { requestId: string; state: string };
    expect(applied.state, JSON.stringify(applied)).toBe("applied");

    const refused = await api("POST", `/api/threads/${threadId}/undo`, { requestId: applied.requestId }, ADA);
    expect(refused.status).toBe(403);
    expect(refused.body.error).toMatch(refusal);
    const undone = await api("POST", `/api/threads/${threadId}/undo`, { requestId: applied.requestId }, BOB);
    expect(undone, JSON.stringify(undone.body)).toMatchObject({ status: 200, body: { ok: true, undone: true } });
    expect((await api("GET", "/api/bots?messages=0", undefined, BOSS)).body.bots.find((candidate: { id: string }) => candidate.id === bot.id).title).toBe("");
  }, 90_000);

  it("lets a session-less local service decline but never approve under service trust", async () => {
    const bot = await makeBot("Serviced");
    await waitForExit(child, { signal: "SIGTERM" });
    await start({ NORDUS_LOOPBACK_TRUST: "service" });
    expect(log).toContain("local requests: service trust (NORDUS_LOOPBACK_TRUST)");
    const requestId = await cardFrom(bot, bot.threadId, ADA);

    const approve = await api("POST", `/api/threads/${bot.threadId}/respond`, { requestId, behavior: "allow" });
    expect(approve.status).toBe(403);
    expect(approve.body.error).toMatch(/can only decline/);
    expect((await api("POST", `/api/bots/${bot.id}/respond`, { requestId, behavior: "allow" })).status).toBe(403);
    expect((await api("POST", `/api/bots/${bot.id}/always-allow`, { allowKey: "shell:echo" })).status).toBe(403);
    expect((await api("POST", `/api/threads/${bot.threadId}/undo`, { requestId })).status).toBe(403);
    expect((await openCard(bot.threadId))?.card.requestId).toBe(requestId);

    const decline = await api("POST", `/api/threads/${bot.threadId}/respond`, { requestId, behavior: "deny" });
    expect(decline.status, JSON.stringify(decline.body)).toBe(200);
    expect((await decision(requestId, "user-denied"))?.actor).toEqual({ kind: "worker" });
    expect((await settledCard(bot.threadId, requestId))?.card.answeredBy).toEqual({ kind: "worker" });

    // A Slack-shaped request: the worker opens the thread and sends through
    // the guarded route, so no person can be named. Any member may approve it
    // in Nordus, as before; nothing waits on an admin.
    const task = await api("POST", `/api/bots/${bot.id}/tasks`, { title: "Slack · C1 · 1.0" });
    expect(task.status, JSON.stringify(task.body)).toBe(201);
    const threadId = task.body.task.threadId as string;
    const page = await api("GET", `/api/threads/${threadId}/messages?limit=0`);
    const guarded = await api("POST", `/api/bots/${bot.id}/messages/guarded`, {
      threadId, text: "run it", sendId: "slackjob_card_answerers_1", expectedActiveLeafId: page.body.activeLeafId ?? null,
    });
    expect(guarded.status, JSON.stringify(guarded.body)).toBe(202);
    const slackCard = await openCard(threadId);
    expect(slackCard).not.toBeNull();
    const approved = await api("POST", `/api/threads/${threadId}/respond`, { requestId: slackCard.card.requestId, behavior: "allow" }, ADA);
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
  }, 90_000);
});
