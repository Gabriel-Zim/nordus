// A shared workspace with one admin, three members and one guest: who sees which room, who may write to whom, the person an
// agent answers to, and who hears what. The fake ACP CLI asks for permission on every turn, which gives the approval cards.
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
const CAL = "cal@example.test";
const GUS = "gus@example.test";
const PEOPLE = [BOSS, ADA, BOB, CAL, GUS];
const ROOT = "paired-admin-without-address";
const NAMES: Record<string, string> = { [BOSS]: "Boss", [ADA]: "Ada Lima", [BOB]: "Bob", [CAL]: "Cal", [GUS]: "Gus" };
const LONG = 600_000;

type Bot = { id: string; threadId: string; owner?: string };
type Room = { id: string; threadId: string; name: string; people?: string[]; createdBy?: string };

let child: ChildProcess;
let home: string;
let log = "";
const tokens: Record<string, string> = {};
const sessionIds: Record<string, string> = {};
let alpha: Bot;
let beta: Bot;
let gamma: Bot;
let eng: Room;
let open: Room;
let clients: Room;

const api = async (method: string, path: string, body?: unknown, as?: string): Promise<{ status: number; body: any }> => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(as ? { authorization: `Bearer ${tokens[as]}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

async function start() {
  child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
    cwd: join(SERVER_DIR, ".."),
    env: {
      ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
      ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
      HOME: home, USERPROFILE: home, NORDUS_PORT: String(PORT), NORDUS_WEBHOOK_PORT: String(PORT + 1),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout!.on("data", (c) => (log += c));
  child.stderr!.on("data", (c) => (log += c));
  const deadline = Date.now() + 240_000;
  for (;;) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return;
    } catch {
    }
    if (Date.now() > deadline) throw new Error(`server never came up:\n${log}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

async function waitFor<T>(read: () => Promise<T | null | undefined> | T | null | undefined, ms = 120_000): Promise<T | null> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline) return null;
    await new Promise((r) => setTimeout(r, 250));
  }
}
const pause = (ms = 600) => new Promise((r) => setTimeout(r, ms));

function openStream(as: string) {
  const controller = new AbortController();
  const frames: any[] = [];
  const state: { hello: any; ended: boolean } = { hello: null, ended: false };
  void (async () => {
    try {
      const res = await fetch(`${BASE}/api/events`, { headers: { authorization: `Bearer ${tokens[as]}` }, signal: controller.signal });
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let end: number;
        while ((end = buffer.indexOf("\n\n")) >= 0) {
          const chunk = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          for (const line of chunk.split("\n")) {
            if (!line.startsWith("data: ")) continue;
            const frame = JSON.parse(line.slice(6));
            if (frame.kind === "hello") state.hello = frame;
            else if (frame.kind !== "ping") frames.push(frame);
          }
        }
      }
      state.ended = true;
    } catch {
    }
  })();
  return { frames, state, ready: () => waitFor(() => state.hello, 60_000), close: () => controller.abort() };
}
type Stream = ReturnType<typeof openStream>;

async function makeBot(name: string): Promise<Bot> {
  const created = await api("POST", "/api/bots", { name }, BOSS);
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const patched = await api("PATCH", `/api/bots/${created.body.bot.id}`, {
    modelSelection: { instanceId: "grok", model: "fake-model" }, approvalMode: "ask", audience: "internal",
  }, BOSS);
  expect(patched.status, JSON.stringify(patched.body)).toBe(200);
  return created.body.bot as Bot;
}

async function makeRoom(body: Record<string, unknown>, as: string): Promise<Room> {
  const res = await api("POST", "/api/groups", { setup: { bulletin: "", defaultResponder: { kind: "everyone" } }, ...body }, as);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.group as Room;
}

const listing = async (as: string) => (await api("GET", "/api/bots?messages=0", undefined, as)).body;
const roomIds = async (as: string) => ((await listing(as)).groups as Array<{ id: string }>).map((group) => group.id);

const openCard = (threadId: string) => waitFor(async () => {
  const { body } = await api("GET", `/api/threads/${threadId}/messages`, undefined, BOSS);
  return (body.messages ?? []).find((m: any) => m.kind === "options" && m.card?.requestId && !m.card.answered) ?? null;
});
async function cardFrom(bot: Bot, text: string, as: string): Promise<string> {
  const sent = await api("POST", `/api/bots/${bot.id}/messages`, { text, threadId: bot.threadId }, as);
  expect(sent.status, JSON.stringify(sent.body)).toBe(202);
  const card = await openCard(bot.threadId);
  expect(card, `no approval card appeared:\n${log.slice(-2_000)}`).not.toBeNull();
  return card.card.requestId as string;
}
const decision = (requestId: string, kind: DecisionRow["decision"]) => waitFor(async () => {
  const { body } = await api("GET", "/api/decisions", undefined, BOSS);
  return ((body.decisions ?? []) as DecisionRow[]).find((row) => row.requestId === requestId && row.decision === kind) ?? null;
});
const notifications = async (as: string) => ((await api("GET", "/api/notifications", undefined, as)).body.notifications ?? []) as any[];

posixOnly("people on a shared workspace", () => {
  beforeAll(async () => {
    chmodSync(FAKE_CLI, 0o755);
    home = mkdtempSync(join(tmpdir(), "nordus-people-e2e-"));
    const data = join(home, ".nordus");
    mkdirSync(data, { recursive: true });
    writeFileSync(join(data, "config.json"), JSON.stringify({
      signIn: { admins: [BOSS], members: [ADA, BOB, CAL], guests: [GUS] },
      instances: { grok: { driver: "grokAgent", environment: { FAKE_ACP_MODE: "permission" }, config: { cli: FAKE_CLI, fullAuto: false } } },
    }));
    const role = (email: string) => (email === BOSS ? ["admin", "client"] as const : ["client"] as const);
    const registry = new SessionRegistry({
      file: join(data, "sessions.json"), emailScopes: (email) => [...role(email)], emailGuestSnapshot: () => (email) => email === GUS,
    });
    for (const email of PEOPLE) {
      const issued = registry.issue({ label: `${NAMES[email]}'s laptop`, email, name: NAMES[email], scopes: [...role(email)] });
      tokens[email] = issued.token;
      sessionIds[email] = issued.session.id;
    }
    const paired = registry.issue({ label: "Paired by an admin", scopes: ["admin", "client"] });
    tokens[ROOT] = paired.token;
    registry.close();
    await start();

    alpha = await makeBot("Alpha");
    beta = await makeBot("Beta");
    gamma = await makeBot("Gamma");
    expect(alpha.owner).toBeUndefined();
    expect((await api("PATCH", `/api/bots/${alpha.id}`, { owner: ADA }, BOSS)).body.bot.owner).toBe(ADA);
    expect((await api("PATCH", `/api/bots/${beta.id}`, { owner: BOB }, BOSS)).body.bot.owner).toBe(BOB);
    eng = await makeRoom({ memberIds: [alpha.id], name: "Engenharia", people: [ADA, BOB] }, BOSS);
    open = await makeRoom({ memberIds: [alpha.id], name: "Aberta" }, BOSS);
    clients = await makeRoom({ memberIds: [gamma.id], name: "Clientes", people: [GUS, ADA] }, BOSS);
  }, LONG);

  afterAll(async () => {
    await waitForExit(child, { signal: "SIGTERM" });
    await removeTempDir(home);
  }, 60_000);

  it("lists everyone with a role to a member, and a guest only the people who share a room with them", async () => {
    const asMember = await api("GET", "/api/people/directory", undefined, ADA);
    expect(asMember.status).toBe(200);
    expect(asMember.body).toEqual([
      { email: ADA, name: "Ada Lima", role: "member" },
      { email: BOB, name: "Bob", role: "member" },
      { email: BOSS, name: "Boss", role: "admin" },
      { email: CAL, name: "Cal", role: "member" },
      { email: GUS, name: "Gus", role: "guest" },
    ]);
    expect((await api("GET", "/api/people/directory", undefined, BOSS)).body).toEqual(asMember.body);
    expect((await api("GET", "/api/people/directory", undefined, GUS)).body).toEqual([
      { email: ADA, name: "Ada Lima", role: "member" },
      { email: BOSS, name: "Boss", role: "admin" },
      { email: GUS, name: "Gus", role: "guest" },
    ]);
    expect((await api("GET", "/api/people/directory")).status).toBe(200);
  }, LONG);

  it("shows a room limited to named people to those people and the admins only", async () => {
    const general = (await listing(BOSS)).groups.find((group: any) => group.general);
    expect(general, "the shared room should exist once two agents do").toBeTruthy();
    const boss = await roomIds(BOSS);
    expect(boss).toEqual(expect.arrayContaining([eng.id, open.id, clients.id, general.id]));
    expect(await roomIds(ADA)).toEqual(expect.arrayContaining([eng.id, open.id, clients.id, general.id]));
    const bob = await roomIds(BOB);
    expect(bob).toEqual(expect.arrayContaining([eng.id, open.id, general.id]));
    expect(bob).not.toContain(clients.id);
    const cal = await roomIds(CAL);
    expect(cal).toEqual(expect.arrayContaining([open.id, general.id]));
    expect(cal).not.toContain(eng.id);
    expect(cal).not.toContain(clients.id);
    expect(JSON.stringify(await listing(CAL))).not.toMatch(/Engenharia|Clientes/);

    for (const [method, path, body] of [
      ["GET", `/api/threads/${eng.threadId}/messages`],
      ["POST", `/api/groups/${eng.id}/messages`, { text: "estou aqui?" }],
      ["POST", `/api/groups/${eng.id}/read`],
      ["PATCH", `/api/groups/${eng.id}`, { name: "Minha agora" }],
    ] as const) {
      const refused = await api(method, path, body, CAL);
      expect(refused.status, `${method} ${path}: ${JSON.stringify(refused.body)}`).toBe(404);
    }
    expect((await api("GET", `/api/threads/${eng.threadId}/messages`, undefined, BOB)).status).toBe(200);
    expect(((await listing(BOB)).groups as Array<any>).find((group) => group.id === eng.id)).toMatchObject({ people: [ADA, BOB, BOSS], createdBy: BOSS });
  }, LONG);

  it("lets whoever opened a room choose its people, keeps them in it, and lets nobody else", async () => {
    const vendas = await makeRoom({ memberIds: [alpha.id], name: "Vendas", people: [BOB] }, ADA);
    expect(vendas).toMatchObject({ people: [BOB, ADA], createdBy: ADA });
    expect(await roomIds(CAL)).not.toContain(vendas.id);

    const refused = await api("PUT", `/api/people/rooms/${vendas.id}/people`, { people: [BOB, CAL] }, BOB);
    expect(refused.status).toBe(403);
    expect((await api("PUT", `/api/people/rooms/${vendas.id}/people`, { people: [CAL] }, CAL)).status).toBe(404);

    const widened = await api("PUT", `/api/people/rooms/${vendas.id}/people`, { people: [BOB, CAL] }, ADA);
    expect(widened.status, JSON.stringify(widened.body)).toBe(200);
    expect(widened.body.group.people).toEqual([BOB, CAL, ADA]);
    expect(await roomIds(CAL)).toContain(vendas.id);
    expect((await api("PUT", `/api/people/rooms/${vendas.id}/people`, { people: [CAL] }, CAL)).status).toBe(403);

    const narrowed = await api("PUT", `/api/people/rooms/${vendas.id}/people`, { people: [CAL] }, BOSS);
    expect(narrowed.body.group.people).toEqual([CAL, ADA]);
    expect(await roomIds(BOB)).not.toContain(vendas.id);

    expect((await api("PUT", `/api/people/rooms/${vendas.id}/people`, { people: [ADA, "stranger@example.test"] }, ADA)).status).toBe(400);
    const everyone = await api("PUT", `/api/people/rooms/${vendas.id}/people`, { people: null }, ADA);
    expect(everyone.status).toBe(200);
    expect(everyone.body.group.people).toBeUndefined();
    expect(await roomIds(BOB)).toContain(vendas.id);
    expect(await roomIds(GUS)).not.toContain(vendas.id);

    const general = (await listing(BOSS)).groups.find((group: any) => group.general);
    expect((await api("PUT", `/api/people/rooms/${general.id}/people`, { people: [ADA] }, BOSS)).status).toBe(400);
  }, LONG);

  it("keeps a guest to the rooms that list them and the agents in those rooms", async () => {
    const seen = await listing(GUS);
    expect((seen.groups as Array<{ id: string }>).map((group) => group.id)).toEqual([clients.id]);
    const faces = seen.bots as Array<Record<string, unknown>>;
    expect(faces.map((bot) => bot.id)).toEqual([gamma.id]);
    expect(faces[0]).toMatchObject({ hidden: true, name: "Gamma" });
    expect(faces[0]).not.toHaveProperty("owner");
    expect(faces[0]).not.toHaveProperty("soul");
    expect(JSON.stringify(seen)).not.toMatch(/Alpha|Beta|Engenharia|Aberta|Geral|bob@example|cal@example/);

    expect((await api("GET", `/api/threads/${clients.threadId}/messages`, undefined, GUS)).status).toBe(200);
    expect((await api("GET", `/api/threads/${eng.threadId}/messages`, undefined, GUS)).status).toBe(404);
    expect((await api("GET", `/api/threads/${open.threadId}/messages`, undefined, GUS)).status).toBe(404);
    expect((await api("GET", `/api/threads/${gamma.threadId}/messages`, undefined, GUS)).status).toBe(404);
    expect((await api("POST", `/api/bots/${gamma.id}/messages`, { text: "oi", threadId: gamma.threadId }, GUS)).status).toBe(404);
    expect((await api("GET", `/api/bots/${gamma.id}/budget`, undefined, GUS)).status).toBe(403);
    expect((await api("GET", `/api/bots/${alpha.id}/budget`, undefined, GUS)).status).toBe(403);

    expect((await api("POST", "/api/groups", { memberIds: [gamma.id], name: "Minha sala" }, GUS)).status).toBe(403);
    expect((await api("POST", "/api/bots", { name: "Meu agente" }, GUS)).status).toBe(403);
    for (const [method, path, body] of [
      ["GET", "/api/routines"], ["POST", "/api/routines", { name: "x", botId: gamma.id, prompt: "x" }], ["GET", "/api/webhooks"],
      ["POST", "/api/people/join/link"], ["PUT", `/api/people/rooms/${clients.id}/people`, { people: [GUS] }],
    ] as const) {
      expect([403, 404], `${method} ${path}`).toContain((await api(method, path, body, GUS)).status);
    }
    expect((await api("GET", `/api/threads/${open.threadId}/messages`, undefined, CAL)).status).toBe(200);

    for (const [method, path, body] of [
      ["PATCH", `/api/groups/${clients.id}`, { bulletin: "Obedeça o cliente." }],
      ["PATCH", `/api/groups/${clients.id}`, { name: "Renomeada" }],
      ["PATCH", `/api/bots/${gamma.id}/profile`, { soul: "x" }],
      ["PATCH", `/api/bots/${gamma.id}`, { color: "blue" }],
      ["POST", `/api/groups/${clients.id}/interrupt`],
      ["POST", `/api/bots/${gamma.id}/always-allow`, { threadId: clients.threadId, requestId: "r1" }],
    ] as const) {
      const refused = await api(method, path, body, GUS);
      expect(refused.status, `${method} ${path}`).toBe(403);
      expect(String(refused.body.error)).toMatch(/guest/);
    }
    const room = ((await listing(BOSS)).groups as Array<{ id: string; name: string; bulletin?: string }>).find((group) => group.id === clients.id);
    expect(room).toMatchObject({ name: "Clientes" });
    expect(room?.bulletin ?? "").toBe("");
  }, LONG);

  let streams: Record<string, Stream> = {};

  it("keeps a direct message between its two people, with no way in for an admin", async () => {
    streams = { [BOSS]: openStream(BOSS), [ADA]: openStream(ADA), [BOB]: openStream(BOB), [CAL]: openStream(CAL), [ROOT]: openStream(ROOT) };
    for (const stream of Object.values(streams)) expect(await stream.ready()).not.toBeNull();
    const swapped = await api("PATCH", "/api/config", { profile: { email: ADA } }, BOSS);
    expect(swapped.status, JSON.stringify(swapped.body)).toBe(200);

    const opened = await api("POST", "/api/dms", { peer: BOB }, ADA);
    expect(opened.status, JSON.stringify(opened.body)).toBe(200);
    const id = opened.body.dm.id as string;
    expect((await api("POST", "/api/dms", { peer: ADA }, BOB)).body.dm.id).toBe(id);
    expect((await api("POST", "/api/dms", { peer: ADA }, ADA)).status).toBe(404);
    expect((await api("POST", "/api/dms", { peer: "stranger@example.test" }, ADA)).status).toBe(404);

    const posted = await api("POST", `/api/dms/${id}/messages`, { text: "Bob, almoço hoje? @Bob" }, ADA);
    expect(posted.status, JSON.stringify(posted.body)).toBe(201);
    expect(await waitFor(() => streams[BOB]!.frames.find((frame) => frame.kind === "dm.message" && frame.dmId === id), 60_000)).not.toBeNull();
    expect(await waitFor(() => streams[BOB]!.frames.find((frame) => frame.kind === "notify" && frame.notification.threadId === `dm:${id}`), 60_000)).not.toBeNull();
    await pause();

    const heardBy = (who: string, kind: string) => streams[who]!.frames.filter((frame) => frame.kind === kind && (frame.dmId === id || frame.dm?.id === id || frame.notification?.threadId === `dm:${id}`));
    expect(heardBy(ADA, "dm.message")).toHaveLength(1);
    expect(heardBy(ADA, "notify")).toHaveLength(0);
    expect(heardBy(BOB, "dm.message")).toHaveLength(1);
    expect(heardBy(BOB, "dm").at(-1).dm).toMatchObject({ id, peer: ADA, unread: true, last: { text: "Bob, almoço hoje? @Bob" } });
    const bobNotice = heardBy(BOB, "notify")[0].notification;
    expect(bobNotice).toMatchObject({ kind: "mention", toPersons: [BOB], groupId: id, title: "Ada Lima" });
    for (const outsider of [BOSS, CAL, ROOT]) {
      for (const kind of ["dm", "dm.message", "notify"]) expect(heardBy(outsider, kind), `${outsider} ${kind}`).toHaveLength(0);
    }

    for (const outsider of [BOSS, CAL]) {
      expect((await api("GET", "/api/dms", undefined, outsider)).body.dms).toEqual([]);
      for (const [method, path, body] of [
        ["GET", `/api/dms/${id}/messages`], ["POST", `/api/dms/${id}/messages`, { text: "intruso" }], ["POST", `/api/dms/${id}/read`],
      ] as const) {
        const refused = await api(method, path, body, outsider);
        expect(refused.status, `${outsider} ${method} ${path}`).toBe(404);
      }
    }
    for (const [method, path, body] of [
      ["GET", "/api/dms"], ["POST", "/api/dms", { peer: BOB }], ["GET", `/api/dms/${id}/messages`], ["POST", `/api/dms/${id}/messages`, { text: "intruso" }], ["POST", `/api/dms/${id}/read`],
    ] as const) {
      const refused = await api(method, path, body, ROOT);
      expect(refused.status, `an admin session with no address: ${method} ${path}`).toBe(403);
      expect(JSON.stringify(refused.body)).not.toContain("almoço");
    }
    expect((await notifications(ROOT)).filter((entry) => String(entry.threadId).startsWith("dm:"))).toEqual([]);
    expect((await api("PATCH", "/api/config", { profile: { email: "" } }, BOSS)).status).toBe(200);
    expect((await api("GET", "/api/dms")).status).toBe(403);

    const wide = JSON.stringify([
      await listing(BOSS), (await api("GET", `/api/search?q=${encodeURIComponent("almoço")}`, undefined, BOSS)).body, await notifications(BOSS),
      (await api("GET", "/api/threads/search?q=almo%C3%A7o", undefined, BOSS)).body,
    ]);
    expect(wide).not.toContain("almoço hoje");
    expect((await notifications(BOSS)).filter((entry) => String(entry.threadId).startsWith("dm:"))).toEqual([]);
    expect((await notifications(CAL)).filter((entry) => String(entry.threadId).startsWith("dm:"))).toEqual([]);
    expect((await notifications(BOB)).filter((entry) => entry.threadId === `dm:${id}`)).toEqual([]);
    expect((await notifications(ADA)).filter((entry) => entry.threadId === `dm:${id}`)).toEqual([]);

    const theirs = await api("GET", "/api/dms", undefined, BOB);
    expect(theirs.body.dms).toHaveLength(1);
    expect(theirs.body.dms[0]).toMatchObject({ id, unread: true, peerName: "Ada Lima" });
    expect((await api("GET", `/api/dms/${id}/messages`, undefined, BOB)).body.messages.map((m: any) => m.text)).toEqual(["Bob, almoço hoje? @Bob"]);
    expect((await api("POST", `/api/dms/${id}/read`, undefined, BOB)).body.dm.unread).toBe(false);
    expect((await api("GET", "/api/dms", undefined, ADA)).body.dms[0]).toMatchObject({ id, unread: false, peerName: "Bob" });

    expect((await api("POST", "/api/dms", { peer: BOB }, GUS)).status).toBe(404);
    expect((await api("POST", "/api/dms", { peer: ADA }, GUS)).status).toBe(200);

    const noticesBefore = heardBy(BOB, "notify").length;
    for (const text of ["de novo", "e mais uma"]) expect((await api("POST", `/api/dms/${id}/messages`, { text }, ADA)).status).toBe(201);
    expect(await waitFor(() => (heardBy(BOB, "dm.message").length >= 3 ? true : null), 60_000)).not.toBeNull();
    await pause();
    expect(heardBy(BOB, "dm.message")).toHaveLength(3);
    expect(heardBy(BOB, "notify")).toHaveLength(noticesBefore);

    const flood = (await api("POST", "/api/dms", { peer: ADA }, CAL)).body.dm.id as string;
    const statuses: number[] = [];
    for (let line = 0; line < 31; line++) statuses.push((await api("POST", `/api/dms/${flood}/messages`, { text: `linha ${line}` }, CAL)).status);
    const refusedAt = statuses.indexOf(429);
    expect(refusedAt, statuses.join(",")).toBeGreaterThanOrEqual(25);
    expect(statuses.slice(0, refusedAt).every((status) => status === 201), statuses.join(",")).toBe(true);
    expect(statuses.slice(refusedAt).every((status) => status === 429), statuses.join(",")).toBe(true);
  }, LONG);

  it("lets the person an agent answers to change its settings and its limit, and nothing more", async () => {
    expect((await api("PATCH", `/api/bots/${alpha.id}`, { soul: "Responda sempre curto." }, ADA)).status).toBe(200);
    expect((await api("PATCH", `/api/bots/${alpha.id}`, { name: "Alfa", notifications: true }, ADA)).body.bot.name).toBe("Alfa");
    for (const forbidden of [{ visibility: "admins" }, { owner: ADA }, { owner: null }, { client: "acme" }, { audience: "client" }, { approvalMode: "auto" }]) {
      const refused = await api("PATCH", `/api/bots/${alpha.id}`, forbidden, ADA);
      expect(refused.status, JSON.stringify(forbidden)).toBe(403);
    }
    expect((await api("PATCH", `/api/bots/${alpha.id}`, { soul: "Vou mandar." }, CAL)).status).toBe(403);
    expect((await api("PATCH", `/api/bots/${alpha.id}`, { soul: "Vou mandar." }, BOB)).status).toBe(403);
    expect((await api("PATCH", `/api/bots/${beta.id}`, { soul: "Vou mandar." }, ADA)).status).toBe(403);
    expect((await api("PATCH", `/api/bots/${alpha.id}`, { owner: "nonsense" }, BOSS)).status).toBe(400);

    for (const stranger of [BOB, CAL, GUS]) {
      const refused = await api("PATCH", `/api/bots/${alpha.id}/profile`, { soul: `Instruções de ${stranger}` }, stranger);
      expect(refused.status, `${stranger}: ${JSON.stringify(refused.body)}`).toBe(403);
    }
    expect((await api("PATCH", `/api/bots/${beta.id}/profile`, { soul: "Do Bob." }, ADA)).status).toBe(403);
    const soulOf = async () => ((await listing(BOSS)).bots as Array<{ id: string; soul?: string }>).find((bot) => bot.id === alpha.id)?.soul;
    expect(await soulOf()).toBe("Responda sempre curto.");
    expect((await api("PATCH", `/api/bots/${alpha.id}/profile`, { soul: "Responda em duas linhas." }, ADA)).status).toBe(200);
    expect(await soulOf()).toBe("Responda em duas linhas.");
    expect((await api("PATCH", `/api/bots/${alpha.id}/profile`, { visibility: "admins" }, ADA)).status).toBe(403);
    expect((await api("PATCH", `/api/bots/${alpha.id}/profile`, { soul: "Do chefe." }, BOSS)).status).toBe(200);

    const mine = await api("GET", `/api/bots/${alpha.id}/budget`, undefined, ADA);
    expect(mine.status).toBe(200);
    expect(mine.body).not.toHaveProperty("spentUsd");
    expect(mine.body).toMatchObject({ botId: alpha.id, monthlyUsd: null, percent: null, exceeded: false });
    const limited = await api("PUT", `/api/bots/${alpha.id}/budget`, { monthlyUsd: 5 }, ADA);
    expect(limited.status).toBe(200);
    expect(limited.body).toMatchObject({ monthlyUsd: 5 });
    expect(limited.body).not.toHaveProperty("spentUsd");
    expect((await api("PUT", `/api/bots/${alpha.id}/budget`, { monthlyUsd: -1 }, ADA)).status).toBe(400);
    const admins = await api("GET", `/api/bots/${alpha.id}/budget`, undefined, BOSS);
    expect(admins.body).toMatchObject({ monthlyUsd: 5, spentUsd: 0 });
    for (const stranger of [BOB, CAL]) {
      expect((await api("GET", `/api/bots/${alpha.id}/budget`, undefined, stranger)).status, stranger).toBe(403);
      expect((await api("PUT", `/api/bots/${alpha.id}/budget`, { monthlyUsd: 999 }, stranger)).status, stranger).toBe(403);
    }
    expect((await api("PUT", `/api/bots/${alpha.id}/budget`, { monthlyUsd: 999 }, GUS)).status).toBe(403);
    expect((await api("GET", `/api/bots/${beta.id}/budget`, undefined, ADA)).status).toBe(403);
    expect((await api("GET", "/api/budget/month", undefined, ADA)).status).toBe(403);
    expect((await api("GET", "/api/usage", undefined, ADA)).status).toBe(403);
    expect((await api("GET", `/api/bots/${alpha.id}/budget`, undefined, BOSS)).body.monthlyUsd).toBe(5);
    expect((await api("PUT", `/api/bots/${alpha.id}/budget`, { monthlyUsd: null }, ADA)).body.monthlyUsd).toBeNull();
  }, LONG);

  it("lets that person decide their agent's cards, tells only them and the admins, and refuses every other member", async () => {
    const requestId = await cardFrom(alpha, "run it", BOSS);
    expect(await waitFor(() => streams[ADA]!.frames.find((frame) => frame.kind === "notify" && frame.notification.requestId === requestId), 90_000)).not.toBeNull();
    expect(await waitFor(() => streams[BOSS]!.frames.find((frame) => frame.kind === "notify" && frame.notification.requestId === requestId), 90_000)).not.toBeNull();
    await pause();
    const heard = (who: string) => streams[who]!.frames.filter((frame) => frame.kind === "notify" && frame.notification.requestId === requestId);
    expect(heard(ADA)[0].notification).toMatchObject({ kind: "approval", botId: alpha.id });
    expect(heard(ADA)[0].notification.toPersons).toEqual(expect.arrayContaining([ADA, BOSS]));
    for (const outsider of [BOB, CAL]) expect(heard(outsider), outsider).toHaveLength(0);
    expect((await notifications(ADA)).some((entry) => entry.requestId === requestId)).toBe(true);
    expect((await notifications(BOSS)).some((entry) => entry.requestId === requestId)).toBe(true);
    for (const outsider of [BOB, CAL, GUS]) expect((await notifications(outsider)).some((entry) => entry.requestId === requestId), outsider).toBe(false);

    for (const who of [BOB, CAL]) {
      for (const [path, body] of [
        [`/api/threads/${alpha.threadId}/respond`, { requestId, behavior: "allow" }],
        [`/api/threads/${alpha.threadId}/respond`, { requestId, behavior: "deny" }],
        [`/api/bots/${alpha.id}/respond`, { requestId, behavior: "allow", threadId: alpha.threadId }],
      ] as const) {
        const refused = await api("POST", path, body, who);
        expect(refused.status, `${who} ${path}`).toBe(403);
      }
    }
    expect((await openCard(alpha.threadId))?.card.requestId).toBe(requestId);

    const answered = await api("POST", `/api/threads/${alpha.threadId}/respond`, { requestId, behavior: "allow" }, ADA);
    expect(answered.status, JSON.stringify(answered.body)).toBe(200);
    const row = await decision(requestId, "user-approved");
    expect(row?.actor).toMatchObject({ kind: "session", sessionId: sessionIds[ADA], email: ADA });

    const other = await cardFrom(beta, "run it too", BOSS);
    expect((await api("POST", `/api/threads/${beta.threadId}/respond`, { requestId: other, behavior: "allow" }, ADA)).status).toBe(403);
    const byOwner = await api("POST", `/api/bots/${beta.id}/respond`, { requestId: other, behavior: "deny", threadId: beta.threadId }, BOB);
    expect(byOwner.status, JSON.stringify(byOwner.body)).toBe(200);
    expect((await decision(other, "user-denied"))?.actor).toMatchObject({ kind: "session", email: BOB });
  }, LONG);

  it("notifies the colleague a message names, and nobody who cannot see the room", async () => {
    const before = Object.fromEntries(Object.entries(streams).map(([who, stream]) => [who, stream.frames.length]));
    const posted = await api("POST", `/api/groups/${eng.id}/messages`, { text: "@Bob olha isso quando puder. @Cal também." }, ADA);
    expect(posted.status, JSON.stringify(posted.body)).toBe(202);
    const mention = (who: string) => streams[who]!.frames.slice(before[who]).filter((frame) => frame.kind === "notify" && frame.notification.kind === "mention");
    expect(await waitFor(() => mention(BOB)[0], 60_000)).not.toBeNull();
    await pause(1_000);
    expect(mention(BOB)[0].notification).toMatchObject({
      toPersons: [BOB], groupId: eng.id, threadId: eng.threadId, title: "Ada Lima mencionou você em Engenharia",
    });
    expect(mention(BOB)).toHaveLength(1);
    for (const outsider of [ADA, CAL, BOSS]) expect(mention(outsider), outsider).toHaveLength(0);
    expect(streams[CAL]!.frames.slice(before[CAL]!).some((frame) => JSON.stringify(frame).includes(eng.threadId))).toBe(false);
    expect((await notifications(BOB)).some((entry) => entry.kind === "mention" && entry.groupId === eng.id)).toBe(true);
    for (const outsider of [CAL, BOSS, ADA]) expect((await notifications(outsider)).some((entry) => entry.kind === "mention" && entry.groupId === eng.id), outsider).toBe(false);
  }, LONG);

  it("lets a guest answer a card in their room only by declining it", async () => {
    streams[GUS] = openStream(GUS);
    expect(await streams[GUS].ready()).not.toBeNull();
    const sent = await api("POST", `/api/groups/${clients.id}/messages`, { text: "rode isso para mim" }, GUS);
    expect(sent.status, JSON.stringify(sent.body)).toBe(202);
    const card = await openCard(clients.threadId);
    expect(card, `no approval card appeared in the guest's room:\n${log.slice(-2_000)}`).not.toBeNull();
    const requestId = card.card.requestId as string;
    const refused = await api("POST", `/api/threads/${clients.threadId}/respond`, { requestId, behavior: "allow" }, GUS);
    expect(refused.status).toBe(403);
    expect(String(refused.body.error)).toMatch(/guest/i);
    expect((await openCard(clients.threadId))?.card.requestId).toBe(requestId);
    const always = await api("POST", `/api/bots/${gamma.id}/always-allow`, { requestId, threadId: clients.threadId }, GUS);
    expect(always.status).toBe(403);
    expect((await openCard(clients.threadId))?.card.requestId).toBe(requestId);
    const declined = await api("POST", `/api/threads/${clients.threadId}/respond`, { requestId, behavior: "deny" }, GUS);
    expect(declined.status, JSON.stringify(declined.body)).toBe(200);
    expect(await waitFor(() => (JSON.stringify(streams[ADA]!.frames).includes("costUsd") ? true : null), 90_000), "a member's stream should carry the turn's usage").not.toBeNull();
    expect(streams[GUS]!.frames.length).toBeGreaterThan(0);
    expect(JSON.stringify(streams[GUS]!.frames)).not.toContain("costUsd");
    for (const stream of Object.values(streams)) stream.close();
  }, LONG);

  it("never sends a guest what a turn cost in a page either, though a member still reads it", async () => {
    const seenBy = async (as: string) => JSON.stringify([
      ((await listing(as)).groups as Array<{ id: string }>).find((group) => group.id === clients.id),
      (await api("GET", `/api/threads/${clients.threadId}/messages`, undefined, as)).body,
    ]);
    expect(await seenBy(ADA), "a member should see the room's usage").toContain("costUsd");
    expect(await seenBy(GUS)).not.toContain("costUsd");
  }, LONG);

  it("does not open an agent kept for admins to the person it answers to", async () => {
    const delta = await makeBot("Delta");
    const patched = await api("PATCH", `/api/bots/${delta.id}`, { visibility: "admins", owner: BOB }, BOSS);
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);
    expect(patched.body.bot.owner).toBe(BOB);
    expect(((await listing(BOB)).bots as Array<{ id: string }>).map((bot) => bot.id)).not.toContain(delta.id);
    for (const [method, path, body] of [
      ["GET", `/api/threads/${delta.threadId}/messages`],
      ["POST", `/api/bots/${delta.id}/messages`, { text: "oi", threadId: delta.threadId }],
      ["GET", `/api/bots/${delta.id}/budget`],
      ["PUT", `/api/bots/${delta.id}/budget`, { monthlyUsd: 999 }],
      ["PATCH", `/api/bots/${delta.id}`, { soul: "meu" }],
      ["PATCH", `/api/bots/${delta.id}/profile`, { soul: "meu" }],
    ] as const) {
      const refused = await api(method, path, body, BOB);
      expect(refused.status, `${method} ${path}`).toBe(404);
    }
    expect((await api("GET", `/api/bots/${delta.id}/budget`, undefined, BOSS)).status).toBe(200);
  }, LONG);
});
