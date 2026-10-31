// The task board and the missions end to end: the real server, and the scripted fake engine calling the board tools
// through the real agents MCP proxy, so the catalog, the capability token and the internal routes are all in the loop.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";

import { launchVerificationServer, runControlNordus, type VerificationServer } from "../scripts/control-nordus.ts";
import type { BoardMission, BoardTask, MissionReceipt } from "../shared/board.ts";
import { openSse, type SseRecorder } from "./testing/sse.ts";

let fixture: VerificationServer | undefined;
let events: SseRecorder | undefined;
afterEach(async () => {
  events?.close();
  if (fixture) {
    console.info(JSON.stringify({ logPath: fixture.info.logPath }));
    await fixture.close();
  }
  fixture = events = undefined;
});

type ScriptEntry = {
  key: string; match: string[]; reply: string;
  steps?: Array<{ tool: string; arguments: Record<string, unknown> }>;
};

async function server() {
  fixture = await launchVerificationServer({ NORDUS_VERIFICATION_READY_MS: "90000", ...process.env }, undefined, undefined, undefined, undefined, { scripted: true });
  const { url, dataDir } = fixture.info;
  const api = async (method: string, path: string, body?: unknown, status?: number) => {
    const response = await fetch(`${url}${path}`, {
      method, headers: { "content-type": "application/json", origin: url },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const value = await response.json() as any;
    if (status === undefined) expect(response.status, `${method} ${path}: ${JSON.stringify(value)}`).toBeLessThan(300);
    else expect(response.status, `${method} ${path}: ${JSON.stringify(value)}`).toBe(status);
    return value;
  };
  const cli = (...args: string[]) => runControlNordus([...args, "--url", url]) as Promise<any>;
  const bot = async (name: string) => (await cli("new-bot", "--name", name)).bot as { id: string; name: string; activeTaskId: string };
  const planPath = join(dataDir, "room-plan.json");
  const script = (plan: Record<string, ScriptEntry[]>) => writeFileSync(planPath, JSON.stringify(
    Object.fromEntries(Object.entries(plan).map(([id, entries]) => [id, { script: entries }]))));
  events = await openSse(`${url}/api/events`, { origin: url });
  const tasks = async () => (await api("GET", "/api/board/tasks")).tasks as BoardTask[];
  const mission = async (id: string) => (await api("GET", `/api/missions/${id}`)) as { mission: BoardMission; receipt: MissionReceipt };
  const messages = async (threadId: string) => (await api("GET", `/api/threads/${threadId}/messages?limit=200`)).messages as any[];
  const turns = () => existsSync(`${planPath}.evidence.jsonl`)
    ? readFileSync(`${planPath}.evidence.jsonl`, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as { botId: string; planKey?: string; unplanned?: boolean; evidence?: any[] })
    : [];
  const frames = (kind: string) => events!.frames.filter((frame) => frame.kind === kind);
  return { url, api, cli, bot, script, tasks, mission, messages, turns, frames };
}

it("starts an agent from a card, and the agent's own task_update moves the card live", async () => {
  const s = await server();
  const dev = await s.bot("Dev");
  s.script({
    [dev.id]: [{
      key: "card",
      match: ["Tarefa #1: Subir o site"],
      steps: [
        { tool: "task_update", arguments: { id: 1, status: "doing", note: "Comecei" } },
        { tool: "task_update", arguments: { id: 1, status: "done", link: { url: "https://exemplo.com/site", label: "Site" } } },
      ],
      reply: "Cartão #1 pronto.",
    }],
  });

  const created = await s.api("POST", "/api/board/tasks", { title: "Subir o site", description: "Antes das 18h", assignee: dev.id }, 201);
  expect(created.task).toMatchObject({ id: 1, status: "todo", assignee: dev.id });
  expect(created.dispatch).toEqual({ status: "sent" });

  await expect.poll(async () => (await s.tasks()).find((task) => task.id === 1)?.status, { timeout: 60_000 }).toBe("done");
  const card = (await s.tasks()).find((task) => task.id === 1)!;
  expect(card.links).toEqual([{ url: "https://exemplo.com/site", label: "Site" }]);
  expect(card.thread).toMatchObject({ threadId: dev.activeTaskId, botId: dev.id });
  const moves = card.history.filter((entry) => entry.to !== undefined && entry.from !== undefined);
  expect(moves.map((entry) => [entry.by.kind, entry.from, entry.to])).toEqual([["bot", "todo", "doing"], ["bot", "doing", "done"]]);
  expect(moves[0]!.note).toBe("Comecei");

  const asked = (await s.messages(dev.activeTaskId)).find((message) => message.role === "user");
  expect(asked?.text).toContain("Tarefa #1: Subir o site");
  expect(asked?.text).toContain("Antes das 18h");
  expect(String(asked?.text).startsWith("[Card from the Nordus task board")).toBe(true);
  expect(asked?.relayed, "a card is relayed, never the person's own line").toBe(true);
  expect(asked?.sender ?? {}).not.toHaveProperty("admin");
  await expect.poll(async () => (await s.messages(dev.activeTaskId)).some((message) => message.role === "bot" && String(message.text).includes("Cartão #1 pronto.")), { timeout: 30_000 }).toBe(true);

  const seen: string[] = [];
  for (const frame of s.frames("board.task")) if (frame.task.id === 1 && seen.at(-1) !== frame.task.status) seen.push(frame.task.status);
  expect(seen).toEqual(["todo", "doing", "done"]);

  const turn = s.turns().find((entry) => entry.botId === dev.id && entry.planKey === "card");
  expect(turn?.evidence?.[0]?.result?.tools?.map((tool: { name: string }) => tool.name)).toEqual(expect.arrayContaining(["task_create", "task_update", "task_list"]));
  for (const step of (turn?.evidence ?? []).filter((entry: any) => entry.step)) expect(step.response.result.isError).toBeFalsy();
  expect(s.turns().filter((entry) => entry.unplanned)).toEqual([]);
}, 120_000);

it("runs a mission from the plan to the closing summary, waiting for the person's decision on the way", async () => {
  const s = await server();
  const dev = await s.bot("Dev");
  const atlas = await s.bot("Atlas");
  s.script({
    [dev.id]: [
      {
        key: "plan",
        match: ["Monte o plano agora com mission_plan"],
        steps: [{
          tool: "mission_plan",
          arguments: { steps: [
            { title: "Preparar o ambiente", description: "Subir o ambiente de teste", assignee: atlas.id },
            { title: "Virar a produção", description: "Trocar o apontamento" },
          ] },
        }],
        reply: "Plano montado.",
      },
      {
        key: "ask",
        match: ["Passo 2 de 2"],
        steps: [
          { tool: "task_update", arguments: { id: 2, status: "doing" } },
          { tool: "mission_ask", arguments: { question: "Posso virar a produção agora?", options: ["Sim", "Não"] } },
        ],
        reply: "Esperando a sua resposta.",
      },
      {
        key: "answered",
        match: ["respondeu à sua pergunta"],
        steps: [{ tool: "task_update", arguments: { id: 2, status: "done", note: "Virei" } }],
        reply: "Virei a produção.",
      },
      {
        key: "close",
        match: ["Registre o resumo final"],
        steps: [{ tool: "mission_note", arguments: { text: "Produção virada. Nenhum erro em 1 hora." } }],
        reply: "Missão encerrada.",
      },
    ],
    [atlas.id]: [{
      key: "prepare",
      match: ["Passo 1 de 2"],
      steps: [
        { tool: "task_update", arguments: { id: 1, status: "doing" } },
        { tool: "mission_note", arguments: { text: "Ambiente de teste no ar" } },
        { tool: "task_update", arguments: { id: 1, status: "done" } },
      ],
      reply: "Passo 1 pronto.",
    }],
  });

  const mix = { title: "Virar produção", goal: "Virar a produção sem erro", leadBotId: dev.id, teamBotIds: [atlas.id] };
  const refused = await s.api("POST", "/api/missions", mix, 400);
  expect(refused.error, "two agents nobody marked as the house's are kept apart, as each could serve a different client").toMatch(/clientes diferentes/);
  for (const id of [dev.id, atlas.id]) await s.api("PATCH", `/api/bots/${id}`, { audience: "internal" });

  const opened = await s.api("POST", "/api/missions", mix, 201);
  const id = opened.mission.id as string;
  expect(opened.mission).toMatchObject({ status: "planning", leadBotId: dev.id, teamBotIds: [dev.id, atlas.id] });
  const roomThread = opened.mission.threadId as string;

  await expect.poll(async () => (await s.mission(id)).mission.status, { timeout: 90_000 }).toBe("waiting");
  const waiting = (await s.mission(id)).mission;
  expect(waiting.stepIds).toEqual([1, 2]);
  expect(waiting.pendingDecision).toMatchObject({ question: "Posso virar a produção agora?", options: ["Sim", "Não"], askedBy: dev.id });
  expect(waiting.feed.map((entry) => entry.text)).toEqual(expect.arrayContaining([
    "Plano montado: 2 passos, 2 agentes.", "Ambiente de teste no ar", "Passo 1 de 2 concluído: Preparar o ambiente", "Posso virar a produção agora?",
  ]));
  const steps = (await s.tasks()).filter((task) => task.missionId === id).sort((a, b) => a.id - b.id);
  expect(steps.map((task) => [task.id, task.assignee, task.status])).toEqual([[1, atlas.id, "done"], [2, dev.id, "doing"]]);

  const asked = async () => (await s.messages(roomThread)).filter((message) => message.role === "user").length;
  await expect.poll(async () => (await s.messages(roomThread)).some((message) => message.role === "bot" && String(message.text).includes("Esperando a sua resposta.")), { timeout: 60_000 }).toBe(true);
  const askedBefore = await asked();
  await new Promise((resolve) => setTimeout(resolve, 3_000));
  expect(await asked(), "the runner sends nothing while the mission waits for the person").toBe(askedBefore);
  expect(s.frames("notify").some((frame) => frame.notification.kind === "question" && frame.notification.threadId === roomThread)).toBe(true);

  await s.api("POST", `/api/missions/${id}/answer`, { answer: "Sim, pode virar" });
  await expect.poll(async () => (await s.mission(id)).mission.status, { timeout: 90_000 }).toBe("done");

  const { mission: done, receipt } = await s.mission(id);
  expect(done.finishedAt).toBeGreaterThan(done.startedAt ?? 0);
  expect(done.feed.at(-1)).toMatchObject({ kind: "done", text: "Produção virada. Nenhum erro em 1 hora. Missão concluída." });
  expect(done.feed.some((entry) => entry.kind === "decision" && entry.text === "Resposta: Sim, pode virar")).toBe(true);
  expect((await s.tasks()).filter((task) => task.missionId === id).every((task) => task.status === "done")).toBe(true);
  expect(receipt.from).toBeLessThanOrEqual(receipt.to);

  const room = await s.messages(roomThread);
  const runnerLines = room.filter((message) => message.role === "user");
  expect(runnerLines.filter((message) => String(message.text).startsWith("@Atlas [Mission from the Nordus board") && String(message.text).includes("Passo 1 de 2")).length).toBe(1);
  expect(runnerLines.filter((message) => String(message.text).startsWith("@Dev [Mission from the Nordus board") && String(message.text).includes("Passo 2 de 2")).length).toBe(1);
  for (const line of runnerLines) {
    expect(line.via, "the runner speaks through the API, not as the person").toBe("api");
    expect(line.sender).toMatchObject({ name: "Nordus", notOwner: true });
    expect(line.sender).not.toHaveProperty("admin");
  }
  expect(s.frames("notify").some((frame) => frame.notification.kind === "done" && frame.notification.threadId === roomThread)).toBe(true);
  expect(s.frames("board.mission").at(-1)?.mission.status).toBe("done");
  expect(s.turns().filter((entry) => entry.unplanned)).toEqual([]);
}, 240_000);
