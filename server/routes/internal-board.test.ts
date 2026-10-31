import { rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import type { BoardTask } from "../../shared/board.ts";
import type { BotCaller } from "../board/directory.ts";
import { boardFixture } from "../testing/board-fixture.ts";
import { json, readBody } from "../harness/http.ts";
import { createInternalBoardRoutes } from "./internal-board.ts";
import { dispatchRoutes } from "./table.ts";

const servers: Server[] = [];
const folders: string[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

interface Reply<T = Record<string, any>> {
  status: number;
  body: T;
}

async function serve() {
  const f = boardFixture();
  folders.push(f.dataDir);
  for (const id of ["dev", "atlas", "nina"]) f.addBot(id);
  f.addBot("acme-bot", "client:acme");
  f.addBot("acme-two", "client:acme");
  f.addBot("beta-bot", "client:beta");
  f.addRoom("lounge", ["dev", "atlas"]);
  const state: { caller: BotCaller; active: boolean } = { caller: f.botCaller("dev"), active: true };
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const routes = [createInternalBoardRoutes({
      board: f.feature,
      caller: () => state.caller,
      readBody: () => readBody(req),
      requireActive: () => {
        if (!state.active) throw Object.assign(new Error("the internal turn capability has expired"), { status: 401 });
      },
    })];
    try {
      const handled = await dispatchRoutes(routes, {
        req, res, url, path: url.pathname, method: req.method ?? "GET", auth: { kind: "loopback", scopes: ["admin", "client"] }, json, readBody,
      });
      if (!handled) json(res, 404, { from: "inline routes" });
    } catch (error) {
      const status = (error as { status?: number }).status;
      json(res, typeof status === "number" ? status : 500, { error: error instanceof Error ? error.message : String(error) });
    }
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (as: BotCaller, method: string, path: string, body?: unknown): Promise<Reply> => {
    state.caller = as;
    const response = await fetch(`${base}/api/internal/board/${path}`, {
      method,
      ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    });
    return { status: response.status, body: (await response.json()) as Record<string, any> };
  };
  const owner = f.person("rafael@zorg.com", { admin: true });
  return { f, state, call, owner };
}

describe("an agent's own cards", () => {
  it("puts a card of its own on the board, moves it live, and the person sees who moved it", async () => {
    const { f, call, owner } = await serve();
    const dev = f.botCaller("dev");
    const created = await call(dev, "POST", "task-create", { title: "Revisar contrato", description: "Cláusula 4" });
    expect(created.status).toBe(200);
    expect(created.body).toEqual({ task: { id: 1, title: "Revisar contrato", status: "todo", assignee: "dev", assigneeName: "Dev", description: "Cláusula 4" } });
    expect(f.feature.tasks.peek(1)).toMatchObject({ createdBy: { kind: "bot", id: "dev" }, source: { threadId: "th-dev" } });

    const framesBefore = f.taskFrames().length;
    const moved = await call(dev, "POST", "task-update", { id: 1, status: "doing", note: "Comecei", link: { url: "https://exemplo.com/contrato", label: "Contrato" } });
    expect(moved.body.task).toMatchObject({ id: 1, status: "doing", links: [{ url: "https://exemplo.com/contrato", label: "Contrato" }] });
    expect(f.taskFrames()).toHaveLength(framesBefore + 1);
    expect(f.taskFrames().at(-1)).toMatchObject({ kind: "board.task", task: { id: 1, status: "doing" } });
    const seen = f.feature.tasks.get(owner, 1);
    expect(seen.history.at(-1)).toMatchObject({ by: { kind: "bot", id: "dev", name: "Dev" }, from: "todo", to: "doing", note: "Comecei" });
    expect(f.sent).toEqual([]);
  });

  it("lists the cards given to it, and the cards of the room it is in", async () => {
    const { f, call, owner } = await serve();
    await f.feature.tasks.create(owner, { title: "Do Dev", assignee: "dev" });
    await f.feature.tasks.create(owner, { title: "Do Atlas na sala", assignee: "atlas", source: { threadId: "th-lounge" } });
    await f.feature.tasks.create(owner, { title: "De outra sala", assignee: "nina" });
    f.sent.length = 0;
    const mine = await call(f.botCaller("dev"), "GET", "tasks");
    expect(mine.body).toMatchObject({ scope: "mine", total: 1 });
    expect(mine.body.tasks.map((task: { title: string }) => task.title)).toEqual(["Do Dev"]);
    const room = await call(f.botCaller("dev", "th-lounge"), "GET", "tasks?scope=room");
    expect(room.body.scope).toBe("room");
    expect(room.body.tasks.map((task: { title: string }) => task.title)).toEqual(["Do Atlas na sala"]);
    const outside = await call(f.botCaller("nina"), "GET", "tasks?scope=room");
    expect(outside.body.tasks).toEqual([]);
  });

  it("only records a card given to another agent, and says how to hand the work over", async () => {
    const { f, call } = await serve();
    const created = await call(f.botCaller("dev", undefined, ["atlas"]), "POST", "task-create", { title: "Escrever o texto", assignee: "atlas" });
    expect(created.status).toBe(200);
    expect(created.body.task).toMatchObject({ assignee: "atlas", assigneeName: "Atlas" });
    expect(created.body.note).toContain("coordinate_bots");
    expect(f.sent).toEqual([]);
    const refused = await call(f.botCaller("dev"), "POST", "task-create", { title: "Outro", assignee: "atlas" });
    expect(refused).toEqual({ status: 403, body: { error: "Você não alcança esse agente." } });
  });

  it("does not let an agent move a card that belongs to another agent, or one it cannot see", async () => {
    const { f, call, owner } = await serve();
    await f.feature.tasks.create(owner, { title: "Do Atlas na sala", assignee: "atlas", source: { threadId: "th-lounge" } });
    const sibling = await call(f.botCaller("dev", "th-lounge"), "POST", "task-update", { id: 1, status: "done" });
    expect(sibling).toEqual({ status: 403, body: { error: "Essa tarefa é de outro agente." } });
    const stranger = await call(f.botCaller("nina"), "POST", "task-update", { id: 1, status: "done" });
    expect(stranger).toEqual({ status: 404, body: { error: "Essa tarefa não existe." } });
    const owner1 = await call(f.botCaller("atlas"), "POST", "task-update", { id: 1, status: "review" });
    expect(owner1.status).toBe(200);
    expect(f.feature.tasks.peek(1)?.status).toBe("review");
  });
});

describe("clients and the house stay apart", () => {
  it("never shows a client's agent the house's cards, or another client's", async () => {
    const { f, call, owner } = await serve();
    await f.feature.tasks.create(owner, { title: "Interno", assignee: "dev" });
    await f.feature.tasks.create(owner, { title: "Da Acme", assignee: "acme-bot" });
    await f.feature.tasks.create(owner, { title: "Da Beta", assignee: "beta-bot" });
    const acme = f.botCaller("acme-bot");
    const mine = await call(acme, "GET", "tasks");
    expect(mine.body.tasks.map((task: { title: string }) => task.title)).toEqual(["Da Acme"]);
    expect((await call(acme, "GET", "tasks?scope=room")).body.tasks).toEqual([]);
    expect((await call(acme, "POST", "task-update", { id: 1, status: "done" })).status).toBe(404);
    expect((await call(acme, "POST", "task-update", { id: 3, status: "done" })).status).toBe(404);
    expect(f.feature.tasks.peek(1)?.status).toBe("todo");
    expect(f.feature.tasks.peek(3)?.status).toBe("todo");
  });

  it("keeps a client's agent from giving cards to the house, to another client or to people", async () => {
    const { f, call } = await serve();
    const acme = f.botCaller("acme-bot", undefined, ["acme-two", "dev", "beta-bot"]);
    expect((await call(acme, "POST", "task-create", { title: "x", assignee: "dev" })).status).toBe(403);
    expect((await call(acme, "POST", "task-create", { title: "x", assignee: "beta-bot" })).status).toBe(403);
    expect((await call(acme, "POST", "task-create", { title: "x", assignee: "rafael@zorg.com" })).status).toBe(403);
    expect((await call(acme, "POST", "task-create", { title: "x", assignee: "acme-two" })).status).toBe(200);
    expect(f.feature.tasks.peek(1)).toMatchObject({ assignee: "acme-two" });
    expect(f.feature.tasks.peek(2)).toBeUndefined();
  });

  it("lets the house's agent give a card to a person who is in the space, and not to a stranger", async () => {
    const { f, call } = await serve();
    const dev = f.botCaller("dev");
    expect((await call(dev, "POST", "task-create", { title: "Para a Nina", assignee: "Nina@zorg.com" })).body.task.assignee).toBe("nina@zorg.com");
    const stranger = await call(dev, "POST", "task-create", { title: "x", assignee: "intruso@fora.com" });
    expect(stranger).toEqual({ status: 400, body: { error: "Essa pessoa não está neste espaço." } });
  });
});

describe("missions through an agent's tools", () => {
  it("opens a mission as its lead, plans it in the room, notes progress and asks the person", async () => {
    const { f, call } = await serve();
    const created = await call(f.botCaller("dev", undefined, ["atlas"]), "POST", "mission-create", { title: "Virar produção", goal: "Sem erro", team_bot_ids: ["atlas"] });
    expect(created.status).toBe(200);
    expect(created.body.mission).toMatchObject({ title: "Virar produção", status: "planning", team: ["dev", "atlas"], room: "room1" });
    const lead = f.botCaller("dev", "th-room1");

    const planned = await call(lead, "POST", "mission-plan", { steps: [{ title: "Preparar", assignee: "atlas" }, { title: "Virar" }] });
    expect(planned.status).toBe(200);
    expect(planned.body.mission.status).toBe("running");
    expect(planned.body.steps.map((step: { id: number; title: string; assignee: string }) => [step.id, step.title, step.assignee])).toEqual([[1, "Preparar", "atlas"], [2, "Virar", "dev"]]);
    expect((await call(lead, "POST", "mission-plan", { steps: [{ title: "Outra vez" }] })).status).toBe(400);

    const note = await call(f.botCaller("atlas", "th-room1"), "POST", "mission-note", { text: "Subi o ambiente" });
    expect(note.body.mission.status).toBe("running");
    const asked = await call(f.botCaller("atlas", "th-room1"), "POST", "mission-ask", { question: "Posso virar agora?", options: ["Sim", "Não"] });
    expect(asked.body.status).toBe("waiting");
    expect(asked.body.note).toContain("Finish your turn");
    expect(f.notices.at(-1)).toMatchObject({ kind: "question", threadId: "th-room1", groupId: "room1" });
    expect(f.notices.at(-1)?.toPersons).toBeUndefined();
  });

  it("refuses mission tools outside a mission room, or to an agent that is not the lead", async () => {
    const { f, call } = await serve();
    await call(f.botCaller("dev", undefined, ["atlas"]), "POST", "mission-create", { title: "Virar", goal: "Sem erro", team_bot_ids: ["atlas"] });
    const outside = await call(f.botCaller("dev"), "POST", "mission-plan", { steps: [{ title: "x" }] });
    expect(outside).toEqual({ status: 400, body: { error: "Esta conversa não é a sala de uma missão." } });
    const notLead = await call(f.botCaller("atlas", "th-room1"), "POST", "mission-plan", { steps: [{ title: "x" }] });
    expect(notLead).toEqual({ status: 403, body: { error: "Só o líder monta o plano." } });
    const stranger = await call(f.botCaller("nina", "th-room1"), "POST", "mission-note", { text: "oi" });
    expect(stranger.status).toBe(403);
  });
});

describe("what the route insists on", () => {
  it("rejects fields it does not know and values out of range, naming the tool", async () => {
    const { f, call } = await serve();
    const dev = f.botCaller("dev");
    expect((await call(dev, "POST", "task-create", { title: "x", createdBy: "outro" })).body.error).toBe("task_create: confira os dados enviados.");
    expect((await call(dev, "POST", "task-create", {})).body.error).toBe('task_create: confira o campo "title".');
    expect((await call(dev, "POST", "task-update", { id: 0 })).status).toBe(400);
    expect((await call(dev, "POST", "task-update", { id: 1, status: "pronto" })).status).toBe(400);
    expect((await call(dev, "POST", "mission-note", { text: "" })).status).toBe(400);
    expect((await call(dev, "POST", "mission-ask", { question: "x", options: Array.from({ length: 7 }, () => "a") })).status).toBe(400);
    expect(f.feature.tasks.list(f.person("rafael@zorg.com", { admin: true }))).toEqual([]);
  });

  it("writes nothing once the turn's capability is gone", async () => {
    const { f, state, call } = await serve();
    state.active = false;
    const refused = await call(f.botCaller("dev"), "POST", "task-create", { title: "Tarde demais" });
    expect(refused.status).toBe(401);
    expect(f.feature.tasks.list(f.person("rafael@zorg.com", { admin: true }))).toEqual([]);
  });

  it("leaves every other path and verb to the next handler", async () => {
    const { f, call } = await serve();
    const dev = f.botCaller("dev");
    expect((await call(dev, "GET", "task-create")).body).toEqual({ from: "inline routes" });
    expect((await call(dev, "POST", "tasks")).body).toEqual({ from: "inline routes" });
    expect((await call(dev, "POST", "nothing", {})).body).toEqual({ from: "inline routes" });
  });

  it("only ever lists a bounded number of cards, shortened", async () => {
    const { f, call, owner } = await serve();
    const list = await f.feature.tasks.create(owner, { title: "Longa", assignee: "dev", description: "d".repeat(2_000) });
    const reply = await call(f.botCaller("dev"), "GET", "tasks");
    const task = reply.body.tasks[0] as BoardTask;
    expect(list.task.id).toBe(1);
    expect(task.description).toHaveLength(600);
  });
});
