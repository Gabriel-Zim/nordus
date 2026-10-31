import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlNordus } from "../scripts/control-nordus.ts";
import { WIDGET_SAMPLES } from "../shared/widget-samples.ts";
import { hostTimeout } from "./testing/host-timeout.ts";

const SETTLED = "Your downstream room requests have settled.";
const GUIDANCE = "DESIGNERGRAFICO, who leads your team, answers your questions in this work";

async function team(test: (f: any) => Promise<void>, mira: Record<string, unknown>, designerGraficoSettled: Record<string, unknown>) {
  const fixture = await launchVerificationServer({}, undefined, undefined, undefined, undefined, { scripted: true });
  const { url, dataDir } = fixture.info;
  const planPath = join(dataDir, "room-plan.json");
  const turns = (): any[] => existsSync(`${planPath}.evidence.jsonl`)
    ? readFileSync(`${planPath}.evidence.jsonl`, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) : [];
  const turn = (key: string) => turns().find(candidate => candidate.planKey === key);
  const api = async (method: string, path: string, body?: unknown, status = 200) => {
    const response = await fetch(`${url}${path}`, { method, headers: { "content-type": "application/json", origin: url },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10_000) });
    const result = await response.json() as any;
    expect(response.status, `${method} ${path}: ${JSON.stringify(result)}`).toBe(status);
    return result;
  };
  const cli = (...args: string[]) => runControlNordus([...args, "--url", url]) as Promise<any>;
  const messages = async (threadId: string): Promise<any[]> => (await api("GET", `/api/threads/${threadId}/messages?limit=200`)).messages;
  const said = async (threadId: string, text: string) => (await messages(threadId)).some(message => message.kind === "text" && message.text?.includes(text));
  const task = async (botId: string, threadId: string) => ((await api("GET", "/api/bots")).bots as any[])
    .find(bot => bot.id === botId)?.tasks.find((candidate: any) => candidate.threadId === threadId);
  const assignments = (): any[] => {
    const path = join(dataDir, "runtime.db");
    if (!existsSync(path)) return [];
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      return (db.prepare("SELECT json FROM assignments ORDER BY created_at, id").all() as Array<{ json: string }>).map(row => JSON.parse(row.json));
    } finally {
      db.close();
    }
  };
  const decisions = () => {
    const path = join(dataDir, "decisions", `${new Date().toISOString().slice(0, 7)}.ndjson`);
    return existsSync(path) ? readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) : [];
  };
  try {
    await api("PATCH", "/api/config", { features: { chiefEscalations: true } });
    const clive = (await cli("new-bot", "--name", "Clive", "--section", "QG")).bot;
    const designergrafico = (await cli("new-bot", "--name", "DESIGNERGRAFICO", "--section", "QG")).bot;
    const member = (await cli("new-bot", "--name", "Mira", "--section", "QG")).bot;
    await api("PATCH", `/api/bots/${clive.id}`, { chiefOfStaff: true });
    await api("PATCH", `/api/bots/${designergrafico.id}`, { teamLead: { allow: [{ label: "listar", command: "ls *" }], ask: [] } });
    await api("PATCH", `/api/bots/${member.id}`, { approvalMode: "ask" });
    writeFileSync(planPath, JSON.stringify({
      [designergrafico.id]: { script: [
        { key: "R1", match: ["JOB"], steps: [{ arguments: { bot_ids: [member.id], message: "BRIEF: get the photo of the Austin tower for l03." } }], reply: "R1: asked Mira." },
        { key: "RS", match: [SETTLED], ...designerGraficoSettled },
      ] },
      [member.id]: { script: [{ key: "M1", match: ["BRIEF"], ...mira }] },
      [clive.id]: { script: [{ key: "CE", match: ["Escalation notice"], repeat: true, reply: "Noted." }] },
    }));
    const job = designergrafico.activeTaskId;
    await cli("send", "--bot", designergrafico.id, "--task", job, "--text", "JOB: have Mira get the tower photo.");
    await test({ api, clive, designergrafico, mira: member, job, turns, turn, messages, said, task, assignments, decisions });
  } finally {
    await fixture.close();
  }
}

it("a member's closing NEEDS INPUT goes to the leader of its team, who is resumed to decide it: nothing parks on the person", () => team(async (f) => {
  const child = () => f.assignments().find((row: any) => row.parentId && row.assignee.botId === f.mira.id);
  await expect.poll(() => ["completed", "needs_input", "failed"].includes(child()?.status), { timeout: 30_000 }).toBe(true);
  expect(child()).toMatchObject({ status: "completed", outcome: "done", requester: { botId: f.designergrafico.id, lead: true } });
  await expect.poll(() => f.said(f.job, "ONE-DONE"), { timeout: 30_000 }).toBe(true);
  expect(f.turn("RS")).toMatchObject({ resumed: true });
  expect(JSON.stringify(f.turn("M1").prompt)).toContain("@DESIGNERGRAFICO leads your team and makes the decisions in this work");
  expect((await f.messages(f.job)).some((message: any) => message.tool?.name?.includes("needs your input"))).toBe(false);
  expect((await f.task(f.mira.id, f.turn("M1").threadId))?.unread).not.toBe(true);
  expect((await f.api("GET", "/api/bots")).bots.find((bot: any) => bot.id === f.clive.id).tasks.some((candidate: any) => candidate.title === "Team escalations")).toBe(false);
  expect(f.turns().filter((record: any) => record.botId === f.clive.id)).toEqual([]);
}, { reply: "RESULT: found two photos.\nNEEDS INPUT: Aprova gerar a imagem genérica da torre de Austin para a l03, ou prefere outra foto real?" },
{ match: [SETTLED, "RESULT", "It ended on a question for you, who lead its team"], reply: "ONE-DONE" }), hostTimeout(90_000));

it("a question tool from a member working for the leader of its team is answered with the way to the leader: no card, nothing waits on the person", () => team(async (f) => {
  await expect.poll(() => f.turn("M1")?.approval, { timeout: 30_000 }).toBeTruthy();
  expect(JSON.stringify(f.turn("M1").approval)).toContain(GUIDANCE);
  await expect.poll(() => f.said(f.job, "TWO-DONE"), { timeout: 30_000 }).toBe(true);
  const work = f.turn("M1").threadId;
  for (const threadId of [work, f.job]) expect((await f.messages(threadId)).filter((message: any) => message.kind === "options")).toEqual([]);
  expect((await f.task(f.mira.id, work))?.activity).not.toBe("waiting-on-you");
  expect(f.decisions().find((row: any) => row.threadId === work && row.tool === "AskUserQuestion"))
    .toMatchObject({ decision: "auto-denied", source: "team-lead", botName: "Mira" });
}, { approve: { tool_name: "AskUserQuestion", input: { questions: [{ question: "Qual foto usar na l03?", header: "Foto",
  options: [{ label: "Real", description: "A foto real" }, { label: "Gerada", description: "Imagem gerada" }], multiSelect: false }] } },
reply: "RESULT: asked.", replyIfDenied: "RESULT: denied." },
{ reply: "TWO-DONE" }), hostTimeout(90_000));

it("show_widget from a member working for the leader of its team is refused with the way to the leader", () => team(async (f) => {
  await expect.poll(() => f.said(f.job, "THREE-DONE"), { timeout: 30_000 }).toBe(true);
  const refused = f.turn("M1").evidence.find((entry: any) => entry.step?.tool === "show_widget").response.result;
  expect(refused).toMatchObject({ isError: true, content: [{ text: expect.stringContaining(GUIDANCE) }] });
  expect((await f.messages(f.turn("M1").threadId)).filter((message: any) => message.kind === "widget")).toEqual([]);
}, { steps: [{ tool: "show_widget", arguments: { widget: WIDGET_SAMPLES.dinnerChoice }, expectError: true }], reply: "RESULT: the widget was refused." },
{ match: [SETTLED, "RESULT: the widget was refused."], reply: "THREE-DONE" }), hostTimeout(90_000));
