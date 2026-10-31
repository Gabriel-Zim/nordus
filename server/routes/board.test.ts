import { rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import type { BoardMission, BoardTask } from "../../shared/board.ts";
import type { PersonCaller } from "../board/directory.ts";
import { boardFixture, type Visibility } from "../testing/board-fixture.ts";
import { json, readBody } from "../harness/http.ts";
import { requiredScope, type RequestAuth } from "../request-auth.ts";
import { createBoardRoutes } from "./board.ts";
import { dispatchRoutes } from "./table.ts";

const servers: Server[] = [];
const folders: string[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

interface Reply<T = Record<string, unknown>> {
  status: number;
  body: T;
}

async function serve() {
  const f = boardFixture();
  folders.push(f.dataDir);
  f.addBot("dev");
  f.addBot("atlas");
  f.addBot("acme-bot", "client:acme");
  f.addRoom("lounge", ["dev", "atlas"]);
  const members = new Map<string, PersonCaller>();
  const owner = f.person("rafael@zorg.com", { admin: true });
  const callerFor = (auth: RequestAuth): PersonCaller => {
    if (auth.kind === "loopback") return owner;
    return members.get(auth.session.email ?? "") ?? f.person(auth.session.email ?? "", { visible: {} });
  };
  const routes = [createBoardRoutes({ board: f.feature, callerFor })];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const email = req.headers["x-user"];
    const auth: RequestAuth = typeof email === "string"
      ? { kind: "session", via: "bearer", scopes: ["client"], session: { id: "s", tokenHash: "0".repeat(64), label: "t", scopes: ["client"], createdAt: 0, lastSeenAt: 0, expiresAt: 1, email } }
      : { kind: "loopback", scopes: ["admin", "client"] };
    try {
      const handled = await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json, readBody });
      if (!handled) json(res, 404, { from: "inline routes" });
    } catch (error) {
      const status = (error as { status?: number }).status;
      json(res, typeof status === "number" ? status : 500, { error: error instanceof Error ? error.message : String(error) });
    }
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const call = async <T = Record<string, unknown>>(method: string, path: string, options: { as?: string; body?: unknown; raw?: string } = {}): Promise<Reply<T>> => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { ...(options.as ? { "x-user": options.as } : {}), ...(options.body !== undefined || options.raw !== undefined ? { "content-type": "application/json" } : {}) },
      ...(options.raw !== undefined ? { body: options.raw } : options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
    return { status: response.status, body: (await response.json()) as T };
  };
  const member = (email: string, visible: Visibility) => void members.set(email, f.person(email, { visible }));
  return { f, call, member };
}

type TaskReply = { task: BoardTask; dispatch?: { status: string; reason?: string } };

describe("the task board over HTTP, as the owner", () => {
  it("creates a card, starts the agent it is given to, lists it and moves it", async () => {
    const { f, call } = await serve();
    const created = await call<TaskReply>("POST", "/api/board/tasks", { body: { title: "Subir o site", description: "Antes das 18h", assignee: "dev" } });
    expect(created.status).toBe(201);
    expect(created.body.task).toMatchObject({ id: 1, title: "Subir o site", status: "todo", assignee: "dev", createdBy: { kind: "person", id: "rafael@zorg.com" } });
    expect(created.body.dispatch).toEqual({ status: "sent" });
    expect(f.sent).toHaveLength(1);
    expect(f.sent[0]).toMatchObject({ to: "bot", botId: "dev" });
    expect(f.sent[0]!.text).toContain("Tarefa #1: Subir o site");
    expect(f.sent[0]!.text).toContain("Antes das 18h");

    const listed = await call<{ tasks: BoardTask[] }>("GET", "/api/board/tasks");
    expect(listed.body.tasks.map((task) => [task.id, task.status])).toEqual([[1, "todo"]]);

    const moved = await call<TaskReply>("PATCH", "/api/board/tasks/1", { body: { status: "doing", note: "Começando" } });
    expect(moved.status).toBe(200);
    expect(moved.body.task.status).toBe("doing");
    expect(moved.body.dispatch).toBeUndefined();
    expect(f.sent).toHaveLength(1);
    expect(f.taskFrames().map((frame) => frame.kind)).toEqual(["board.task", "board.task", "board.task"]);
  });

  it("reassigning to another agent starts that agent, and a person never starts anything", async () => {
    const { f, call } = await serve();
    await call("POST", "/api/board/tasks", { body: { title: "Revisar", assignee: "dev" } });
    f.sent.length = 0;
    const toAtlas = await call<TaskReply>("PATCH", "/api/board/tasks/1", { body: { assignee: "atlas" } });
    expect(toAtlas.body.dispatch).toEqual({ status: "sent" });
    expect(f.sent.map((message) => message.botId)).toEqual(["atlas"]);
    const toPerson = await call<TaskReply>("PATCH", "/api/board/tasks/1", { body: { assignee: "Nina@Zorg.com" } });
    expect(toPerson.body.task.assignee).toBe("nina@zorg.com");
    expect(toPerson.body.dispatch).toBeUndefined();
    expect(f.sent).toHaveLength(1);
    const cleared = await call<TaskReply>("PATCH", "/api/board/tasks/1", { body: { assignee: null } });
    expect(cleared.body.task.assignee).toBeUndefined();
  });

  it("says why the agent was not reached, without losing the card", async () => {
    const { f, call } = await serve();
    f.script.outcome = "skipped";
    f.script.reason = "o limite de gasto do mês foi atingido.";
    const created = await call<TaskReply>("POST", "/api/board/tasks", { body: { title: "Subir", assignee: "dev" } });
    expect(created.status).toBe(201);
    expect(created.body.dispatch).toEqual({ status: "skipped", reason: "o limite de gasto do mês foi atingido." });
    expect((await call<{ tasks: BoardTask[] }>("GET", "/api/board/tasks")).body.tasks).toHaveLength(1);
  });

  it("deletes a card, and a deleted number is never handed out again", async () => {
    const { call } = await serve();
    await call("POST", "/api/board/tasks", { body: { title: "Um" } });
    expect((await call("DELETE", "/api/board/tasks/1")).body).toEqual({ ok: true });
    expect((await call("DELETE", "/api/board/tasks/1")).status).toBe(404);
    const next = await call<TaskReply>("POST", "/api/board/tasks", { body: { title: "Dois" } });
    expect(next.body.task.id).toBe(2);
  });

  it("lists the people a card can be given to", async () => {
    const { call } = await serve();
    const people = await call<{ people: Array<{ id: string }> }>("GET", "/api/board/people");
    expect(people.body.people.map((person) => person.id)).toEqual(["rafael@zorg.com", "nina@zorg.com", "carla@cliente.com"]);
  });

  it("answers in plain words when the request is wrong", async () => {
    const { call } = await serve();
    const empty = await call<{ error: string }>("POST", "/api/board/tasks", { body: {} });
    expect(empty.status).toBe(400);
    expect(empty.body.error).toBe('Tarefa: confira o campo "title".');
    expect((await call<{ error: string }>("POST", "/api/board/tasks", { body: { title: "x", status: "feito" } })).status).toBe(400);
    expect((await call<{ error: string }>("POST", "/api/board/tasks", { body: { title: "x", createdBy: "outro" } })).status).toBe(400);
    expect((await call<{ error: string }>("POST", "/api/board/tasks", { body: { title: "x", assignee: "ninguem" } })).body.error).toBe("Esse agente não existe.");
    expect((await call<{ error: string }>("POST", "/api/board/tasks", { body: { title: "x", assignee: "acme-bot@" } })).status).toBe(400);
    const badLink = await call<{ error: string }>("POST", "/api/board/tasks", { body: { title: "x", links: [{ url: "javascript:alert(1)" }] } });
    expect(badLink.status).toBe(400);
    expect(badLink.body.error).toBe("Só links http ou https são aceitos.");
    expect((await call("POST", "/api/board/tasks", { raw: "{nope" })).status).toBe(400);
    expect((await call("PATCH", "/api/board/tasks/99", { body: { status: "done" } })).status).toBe(404);
    expect((await call<{ tasks: BoardTask[] }>("GET", "/api/board/tasks")).body.tasks).toEqual([]);
  });

  it("leaves other paths to the next handler", async () => {
    const { call } = await serve();
    expect((await call("GET", "/api/board/unknown")).body).toEqual({ from: "inline routes" });
    expect((await call("PUT", "/api/board/tasks")).body).toEqual({ from: "inline routes" });
    expect((await call("GET", "/api/board/tasks/abc")).body).toEqual({ from: "inline routes" });
    expect((await call("GET", "/api/missionsx")).body).toEqual({ from: "inline routes" });
    expect((await call("GET", "/api/threads")).body).toEqual({ from: "inline routes" });
  });
});

describe("the task board over HTTP, as a member", () => {
  it("shows only the cards of what the member can see, and hides the rest as if they did not exist", async () => {
    const { call, member } = await serve();
    member("nina@zorg.com", { bots: ["dev"], threads: ["th-dev"] });
    await call("POST", "/api/board/tasks", { body: { title: "Do Dev", assignee: "dev" } });
    await call("POST", "/api/board/tasks", { body: { title: "Do Atlas na sala", assignee: "atlas", source: { threadId: "th-lounge" } } });
    await call("POST", "/api/board/tasks", { body: { title: "Para Nina", assignee: "nina@zorg.com" } });
    await call("POST", "/api/board/tasks", { body: { title: "Sem dono" } });

    const mine = await call<{ tasks: BoardTask[] }>("GET", "/api/board/tasks", { as: "nina@zorg.com" });
    expect(mine.body.tasks.map((task) => task.title).sort()).toEqual(["Do Dev", "Para Nina"]);

    expect((await call("PATCH", "/api/board/tasks/2", { as: "nina@zorg.com", body: { status: "done" } })).status).toBe(404);
    expect((await call("DELETE", "/api/board/tasks/2", { as: "nina@zorg.com" })).status).toBe(404);
    expect((await call("PATCH", "/api/board/tasks/4", { as: "nina@zorg.com", body: { status: "done" } })).status).toBe(404);
    expect((await call<{ tasks: BoardTask[] }>("GET", "/api/board/tasks")).body.tasks).toHaveLength(4);
  });

  it("moves a visible card, but only its creator or an admin deletes it", async () => {
    const { call, member } = await serve();
    member("nina@zorg.com", { bots: ["dev"] });
    await call("POST", "/api/board/tasks", { body: { title: "Do Dev", assignee: "dev" } });
    const moved = await call<TaskReply>("PATCH", "/api/board/tasks/1", { as: "nina@zorg.com", body: { status: "review" } });
    expect(moved.status).toBe(200);
    expect(moved.body.task.history.at(-1)).toMatchObject({ by: { kind: "person", id: "nina@zorg.com" }, from: "todo", to: "review" });
    const refused = await call<{ error: string }>("DELETE", "/api/board/tasks/1", { as: "nina@zorg.com" });
    expect(refused.status).toBe(403);
    expect(refused.body.error).toContain("Só quem criou");

    const own = await call<TaskReply>("POST", "/api/board/tasks", { as: "nina@zorg.com", body: { title: "Minha", assignee: "dev" } });
    expect(own.status).toBe(201);
    expect(own.body.task.createdBy).toMatchObject({ kind: "person", id: "nina@zorg.com" });
    expect((await call("DELETE", `/api/board/tasks/${own.body.task.id}`, { as: "nina@zorg.com" })).status).toBe(200);
  });

  it("refuses to give a card to an agent, or take one from a conversation, the member cannot see", async () => {
    const { f, call, member } = await serve();
    member("nina@zorg.com", { bots: ["dev"] });
    const agent = await call<{ error: string }>("POST", "/api/board/tasks", { as: "nina@zorg.com", body: { title: "x", assignee: "atlas" } });
    expect(agent).toEqual({ status: 400, body: { error: "Esse agente não existe." } });
    const room = await call<{ error: string }>("POST", "/api/board/tasks", { as: "nina@zorg.com", body: { title: "x", source: { threadId: "th-lounge" } } });
    expect(room).toEqual({ status: 400, body: { error: "Essa conversa não existe." } });
    const stranger = await call<{ error: string }>("POST", "/api/board/tasks", { as: "nina@zorg.com", body: { title: "x", assignee: "intruso@fora.com" } });
    expect(stranger).toEqual({ status: 400, body: { error: "Essa pessoa não está neste espaço." } });
    expect(f.sent).toEqual([]);
    expect((await call<{ tasks: BoardTask[] }>("GET", "/api/board/tasks")).body.tasks).toEqual([]);
  });

  it("starts the agent as the member who gave the card, never as the owner", async () => {
    const { f, call, member } = await serve();
    member("nina@zorg.com", { bots: ["dev"] });
    const created = await call<TaskReply>("POST", "/api/board/tasks", { as: "nina@zorg.com", body: { title: "Revisar", assignee: "dev" } });
    expect(created.body.dispatch).toEqual({ status: "sent" });
    expect(f.sent).toHaveLength(1);
    expect(f.sent[0]!.text).toContain("Tarefa #1: Revisar");
    expect(f.sent[0]!.identity).toEqual({ sender: { name: "nina" }, trigger: { kind: "user", email: "nina@zorg.com" }, personPresent: true });
  });

  it("lists only the people a member already shares a card with", async () => {
    const { call, member } = await serve();
    member("nina@zorg.com", { bots: ["dev"] });
    await call("POST", "/api/board/tasks", { body: { title: "Para Nina", assignee: "nina@zorg.com" } });
    await call("POST", "/api/board/tasks", { body: { title: "Para Carla", assignee: "carla@cliente.com" } });
    const people = await call<{ people: Array<{ id: string }> }>("GET", "/api/board/people", { as: "nina@zorg.com" });
    expect(people.body.people.map((person) => person.id)).toEqual(["nina@zorg.com", "rafael@zorg.com"]);
  });

  it("sends the live frame of a card only to someone who can see it, and withdraws it once they lose sight of it", async () => {
    const { f, call, member } = await serve();
    member("nina@zorg.com", { bots: ["dev"] });
    await call("GET", "/api/board/tasks", { as: "nina@zorg.com" });
    const created = await call<TaskReply>("POST", "/api/board/tasks", { body: { title: "Do Dev", assignee: "dev" } });
    const frame = f.taskFrames().at(-1)!;
    expect(f.feature.memberFrame("nina@zorg.com", frame)).toBe(frame);
    await call("PATCH", `/api/board/tasks/${created.body.task.id}`, { body: { assignee: "atlas" } });
    const after = f.taskFrames().at(-1)!;
    expect(f.feature.memberFrame("nina@zorg.com", after)).toEqual({ kind: "board.task.deleted", id: 1 });
    expect(f.feature.memberFrame("nina@zorg.com", after)).toBeUndefined();
  });
});

describe("missions over HTTP", () => {
  type MissionReply = { mission: BoardMission; receipt?: { agents: unknown[] } };

  it("opens a mission with its own room, shows it, pauses it, resumes it and deletes it", async () => {
    const { f, call } = await serve();
    const created = await call<MissionReply>("POST", "/api/missions", { body: { title: "Virar produção", goal: "Sem erro", leadBotId: "dev", teamBotIds: ["atlas"] } });
    expect(created.status).toBe(201);
    expect(created.body.mission).toMatchObject({ title: "Virar produção", status: "planning", leadBotId: "dev", teamBotIds: ["dev", "atlas"], groupId: "room1" });
    expect(Object.keys(created.body.mission)).not.toContain("runner");
    const id = created.body.mission.id;

    const listed = await call<{ missions: BoardMission[] }>("GET", "/api/missions");
    expect(listed.body.missions.map((mission) => mission.id)).toEqual([id]);
    const one = await call<MissionReply>("GET", `/api/missions/${id}`);
    expect(one.body.mission.id).toBe(id);
    expect(one.body.receipt).toMatchObject({ agents: [] });

    const paused = await call<MissionReply>("POST", `/api/missions/${id}/pause`);
    expect(paused.body.mission).toMatchObject({ status: "paused", pausedBy: "person" });
    expect((await call<MissionReply>("POST", `/api/missions/${id}/resume`)).body.mission.status).toBe("planning");
    expect((await call<{ error: string }>("POST", `/api/missions/${id}/answer`, { body: { answer: "Sim" } })).status).toBe(400);

    expect((await call("DELETE", `/api/missions/${id}`)).body).toEqual({ ok: true });
    expect((await call("GET", `/api/missions/${id}`)).status).toBe(404);
    expect(f.taskFrames().at(-1)).toEqual({ kind: "board.mission.deleted", id });
  });

  it("refuses a team that mixes a client with the house, and bad input", async () => {
    const { call } = await serve();
    const mixed = await call<{ error: string }>("POST", "/api/missions", { body: { title: "x", goal: "y", leadBotId: "dev", teamBotIds: ["acme-bot"] } });
    expect(mixed.status).toBe(400);
    expect(mixed.body.error).toContain("clientes diferentes");
    expect((await call("POST", "/api/missions", { body: { title: "x", goal: "y" } })).status).toBe(400);
    expect((await call("POST", "/api/missions", { body: { title: "x", goal: "y", leadBotId: "ninguem" } })).status).toBe(400);
    expect((await call("POST", "/api/missions", { body: { title: "x", goal: "y", leadBotId: "dev", extra: 1 } })).status).toBe(400);
    expect((await call<{ missions: BoardMission[] }>("GET", "/api/missions")).body.missions).toEqual([]);
  });

  it("lets a member open a mission with agents they see, and keeps it from members who do not see its room", async () => {
    const { f, call, member } = await serve();
    member("nina@zorg.com", { bots: ["dev", "atlas"] });
    member("carla@cliente.com", {});
    const created = await call<MissionReply>("POST", "/api/missions", { as: "nina@zorg.com", body: { title: "Virar", goal: "Sem erro", leadBotId: "dev" } });
    expect(created.status).toBe(201);
    const id = created.body.mission.id;
    expect(created.body.mission.createdBy).toMatchObject({ kind: "person", id: "nina@zorg.com" });

    expect((await call<{ missions: BoardMission[] }>("GET", "/api/missions", { as: "nina@zorg.com" })).body.missions).toHaveLength(1);
    expect((await call<{ missions: BoardMission[] }>("GET", "/api/missions", { as: "carla@cliente.com" })).body.missions).toEqual([]);
    expect((await call("GET", `/api/missions/${id}`, { as: "carla@cliente.com" })).status).toBe(404);
    expect((await call("POST", `/api/missions/${id}/pause`, { as: "carla@cliente.com" })).status).toBe(404);
    expect((await call("DELETE", `/api/missions/${id}`, { as: "carla@cliente.com" })).status).toBe(404);

    const asMember = await call<MissionReply>("GET", `/api/missions/${id}`, { as: "nina@zorg.com" });
    expect(JSON.stringify(asMember.body.receipt)).not.toContain("costUsd");
    expect(f.feature.missions.peek(id)?.status).toBe("planning");
  });

  it("tells a member only that a limit stopped the mission, and an administrator which one", async () => {
    const { f, call, member } = await serve();
    member("nina@zorg.com", { bots: ["dev", "atlas"] });
    f.script.block = { code: "spend_cap" };
    const created = await call<MissionReply>("POST", "/api/missions", { as: "nina@zorg.com", body: { title: "Virar", goal: "Sem erro", leadBotId: "dev" } });
    const id = created.body.mission.id;
    f.clock.now += 10_000;
    await f.feature.runner.tick();
    await expect.poll(() => f.feature.missions.peek(id)?.status).toBe("paused");
    const asMember = await call<MissionReply>("GET", `/api/missions/${id}`, { as: "nina@zorg.com" });
    expect(asMember.body.mission).toMatchObject({ status: "paused", pausedReason: "um limite de uso foi atingido." });
    expect(asMember.body.mission).not.toHaveProperty("pausedDetail");
    const listed = await call<{ missions: BoardMission[] }>("GET", "/api/missions", { as: "nina@zorg.com" });
    expect(JSON.stringify(listed.body)).not.toContain("gasto");
    const asOwner = await call<MissionReply>("GET", `/api/missions/${id}`);
    expect(asOwner.body.mission.pausedDetail).toBe("o limite de gasto do mês foi atingido.");
  });

  it("takes the answer to a decision, and only from the person who opened the mission or an admin", async () => {
    const { f, call, member } = await serve();
    member("nina@zorg.com", { bots: ["dev", "atlas"], groups: ["room1"] });
    member("carla@cliente.com", { bots: ["dev", "atlas"], groups: ["room1"] });
    const created = await call<MissionReply>("POST", "/api/missions", { as: "nina@zorg.com", body: { title: "Virar", goal: "Sem erro", leadBotId: "dev" } });
    const id = created.body.mission.id;
    f.feature.missions.plan(f.botCaller("dev", "th-room1"), [{ title: "Passo" }]);
    f.feature.missions.ask(f.botCaller("dev", "th-room1"), "Posso virar?", ["Sim", "Não"]);

    const stranger = await call<{ error: string }>("POST", `/api/missions/${id}/answer`, { as: "carla@cliente.com", body: { answer: "Sim" } });
    expect(stranger.status).toBe(403);
    expect((await call("POST", `/api/missions/${id}/answer`, { as: "nina@zorg.com", body: {} })).status).toBe(400);
    const answered = await call<MissionReply>("POST", `/api/missions/${id}/answer`, { as: "nina@zorg.com", body: { answer: "Sim, pode virar" } });
    expect(answered.status).toBe(200);
    expect(answered.body.mission).toMatchObject({ status: "running", pendingDecision: { answer: "Sim, pode virar" } });
  });
});

describe("who may reach the board", () => {
  it("lets members use the board and the missions, and keeps every other verb or path admin only", () => {
    for (const [method, path] of [
      ["GET", "/api/board/tasks"], ["POST", "/api/board/tasks"], ["PATCH", "/api/board/tasks/12"], ["DELETE", "/api/board/tasks/12"],
      ["GET", "/api/board/people"], ["GET", "/api/missions"], ["POST", "/api/missions"], ["GET", "/api/missions/m-1a"], ["DELETE", "/api/missions/m-1a"],
      ["POST", "/api/missions/m-1a/pause"], ["POST", "/api/missions/m-1a/resume"], ["POST", "/api/missions/m-1a/answer"],
    ] as const) expect(requiredScope(method, path), `${method} ${path}`).toBe("client");
    for (const [method, path] of [
      ["PUT", "/api/board/tasks"], ["POST", "/api/board/tasks/12"], ["GET", "/api/board/tasks/12"], ["POST", "/api/board/people"],
      ["PATCH", "/api/missions/m-1a"], ["POST", "/api/missions/m-1a/delete"], ["GET", "/api/board/export"], ["GET", "/api/internal/board/tasks"],
    ] as const) expect(requiredScope(method, path), `${method} ${path}`).toBe("admin");
  });
});
