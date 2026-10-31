import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlNordus } from "../scripts/control-nordus.ts";
import { hostTimeout } from "./testing/host-timeout.ts";

const PLAN = ["Separando o material", "Cortando as pausas", "Entregando o vídeo"];

const stored = (dataDir: string, threadId: string) => (JSON.parse(readFileSync(join(dataDir, "task-journals.json"), "utf8")).journals as any[])
  .find((journal) => journal.threadId === threadId);

it("EDITORDEVIDEO passa o corte ao Logger: o diário da tarefa dela guarda as etapas dos dois, com início e fim, e não a do outro time", async () => {
  const scratch = mkdtempSync(join(tmpdir(), "nordus-task-journal-"));
  const session = await launchVerificationServer(process.env, undefined, undefined, undefined, undefined, { scripted: true });
  const { url, dataDir } = session.info;
  const cli = (...args: string[]) => runControlNordus(args, { env: { NORDUS_URL: url } }) as Promise<any>;
  const api = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${url}${path}`, { method, headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const result = await response.json() as any;
    expect(response.ok, `${method} ${path}: ${JSON.stringify(result)}`).toBe(true);
    return result;
  };
  try {
    const editordevideo = (await cli("new-bot", "--name", "EDITORDEVIDEO", "--section", "QG de VÍDEO")).bot;
    const logger = (await cli("new-bot", "--name", "Logger", "--section", "QG de VÍDEO")).bot;
    const pesquisador = (await cli("new-bot", "--name", "Pesquisador", "--section", "PESQUISA")).bot;
    await api("PATCH", `/api/bots/${pesquisador.id}`, { openTo: ["QG de VÍDEO"], acknowledgePeerScope: true });
    // EDITORDEVIDEO leads the video team: its orders to Logger keep a task of their own; Pesquisador, outside the team, gets the request in its main conversation.
    await api("PATCH", `/api/bots/${editordevideo.id}`, { teamLead: { allow: [{ label: "conferir os arquivos do pedido", command: "ls *" }], ask: [] } });

    const gate = join(scratch, "gate");
    const ready = (name: string) => join(scratch, `${name}.ready`);
    writeFileSync(join(dataDir, "room-plan.json"), JSON.stringify({
      [editordevideo.id]: {
        steps: [
          { tool: "informar_etapa", arguments: { texto: "Separando o material do vídeo", plano: PLAN, passo: 1, onde: "servidor", teto_creditos: 10_000 } },
          { arguments: { bot_ids: [logger.id], message: "Corta as pausas do bruto do vídeo" } },
          { arguments: { bot_ids: [pesquisador.id], message: "Procura referências de abertura" } },
        ],
        reply: "Pedi ao time",
        resumeReply: "O corte está pronto",
      },
      [logger.id]: {
        steps: [{ tool: "informar_etapa", arguments: { texto: "Cortando as pausas pela onda do áudio", passo: 2, creditos: 1_240, onde: "modal" } }],
        readyFile: ready("logger"), gateFile: gate, reply: "Pausas cortadas",
      },
      [pesquisador.id]: {
        steps: [{ tool: "informar_etapa", arguments: { texto: "Pesquisando aberturas de outro time", creditos: 99 } }],
        readyFile: ready("pesquisador"), gateFile: gate, reply: "Três referências",
      },
    }));

    await cli("send", "--bot", editordevideo.id, "--task", editordevideo.activeTaskId, "--text", "Edita o vídeo do bruto novo");
    await expect.poll(() => existsSync(ready("logger")) && existsSync(ready("pesquisador")), { timeout: 30_000 }).toBe(true);

    const journal = async () => {
      const bots = (await api("GET", "/api/bots?messages=0")).bots as any[];
      return bots.find((bot) => bot.id === editordevideo.id).tasks.find((task: any) => task.threadId === editordevideo.activeTaskId)?.journal;
    };
    const working = await journal();
    expect(working.entries.map((entry: any) => [entry.name, entry.text, entry.end === undefined])).toEqual([
      ["EDITORDEVIDEO", "Separando o material do vídeo", false],
      ["Logger", "Cortando as pausas pela onda do áudio", true],
    ]);
    expect(working.progress).toMatchObject({ plan: PLAN, step: 1, credits: 1_240, creditCap: 10_000, where: "modal" });

    writeFileSync(gate, "go");
    await expect.poll(journal, { timeout: 30_000 }).toBeUndefined();
    const done = stored(dataDir, editordevideo.activeTaskId);
    expect(done.closedAt).toBeGreaterThan(0);
    expect(done.entries.map((entry: any) => entry.name)).toEqual(["EDITORDEVIDEO", "Logger"]);
    for (const entry of done.entries) expect(entry.end).toBeGreaterThanOrEqual(entry.at);
    expect(JSON.stringify(done)).not.toContain("Pesquisando");
  } finally {
    await session.close();
    rmSync(scratch, { recursive: true, force: true });
  }
}, 120_000);

it("a tarefa própria da EDITORDEVIDEO fala na conversa de origem, mas o diário fica preso à tarefa: a etapa do Logger aparece no cartão dela e nunca na origem", async () => {
  const scratch = mkdtempSync(join(tmpdir(), "nordus-task-journal-home-"));
  const session = await launchVerificationServer(process.env, undefined, undefined, undefined, undefined, { scripted: true });
  const { url, dataDir } = session.info;
  const planPath = join(dataDir, "room-plan.json");
  const turns = (): any[] => existsSync(`${planPath}.evidence.jsonl`)
    ? readFileSync(`${planPath}.evidence.jsonl`, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];
  const cli = (...args: string[]) => runControlNordus(args, { env: { NORDUS_URL: url } }) as Promise<any>;
  const api = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${url}${path}`, { method, headers: { "content-type": "application/json", origin: url },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const result = await response.json() as any;
    expect(response.ok, `${method} ${path}: ${JSON.stringify(result)}`).toBe(true);
    return result;
  };
  try {
    const editordevideo = (await cli("new-bot", "--name", "EDITORDEVIDEO", "--section", "QG de VÍDEO")).bot;
    const logger = (await cli("new-bot", "--name", "Logger", "--section", "QG de VÍDEO")).bot;
    await api("PATCH", `/api/bots/${editordevideo.id}`, { teamLead: { allow: [{ label: "conferir os arquivos do pedido", command: "ls *" }], ask: [] } });
    const home = editordevideo.activeTaskId;
    const gate = join(scratch, "gate");
    const ready = join(scratch, "logger.ready");
    writeFileSync(planPath, JSON.stringify({
      [editordevideo.id]: { script: [
        { key: "S0", match: ["PEDIDO-VIDEO"], steps: [{ tool: "start_thread", arguments: { title: "Lumon · Reels", message: "TAREFA-VIDEO: edite o bruto." } }], reply: "" },
        { key: "S1", match: ["TAREFA-VIDEO"], steps: [
          { tool: "informar_etapa", arguments: { texto: "Separando o material do vídeo", plano: PLAN, passo: 1, onde: "servidor" } },
          { arguments: { bot_ids: [logger.id], message: "CORTE-VIDEO: corta as pausas do bruto." } },
        ], reply: "S1: o Logger está no corte." },
        { key: "S2", match: ["Your downstream room requests have settled.", "PAUSAS-CORTADAS"], reply: "VIDEO-PRONTO: o corte está pronto." },
      ] },
      [logger.id]: { script: [
        { key: "L1", match: ["CORTE-VIDEO"], steps: [{ tool: "informar_etapa", arguments: { texto: "Cortando as pausas pela onda do áudio", passo: 2, creditos: 1_240, onde: "modal" } }],
          readyFile: ready, gateFile: gate, reply: "PAUSAS-CORTADAS: pronto." },
      ] },
    }));

    await cli("send", "--bot", editordevideo.id, "--task", home, "--text", "PEDIDO-VIDEO: edita o bruto da Lumon.");
    await expect.poll(() => existsSync(ready), { timeout: 30_000 }).toBe(true);
    const job = turns().find((turn) => turn.planKey === "S1")!.threadId;
    expect(job).not.toBe(home);

    const task = async (threadId: string) => ((await api("GET", "/api/bots?messages=0")).bots as any[])
      .find((bot) => bot.id === editordevideo.id).tasks.find((row: any) => row.threadId === threadId);
    const working = (await task(job)).journal;
    expect(working.entries.map((entry: any) => [entry.name, entry.text, entry.end === undefined])).toEqual([
      ["EDITORDEVIDEO", "Separando o material do vídeo", false],
      ["Logger", "Cortando as pausas pela onda do áudio", true],
    ]);
    expect(working.progress).toMatchObject({ plan: PLAN, step: 1, credits: 1_240, where: "modal" });
    expect((await task(home)).journal).toBeUndefined();

    writeFileSync(gate, "go");
    const messages = async (threadId: string): Promise<any[]> => (await api("GET", `/api/threads/${threadId}/messages?limit=200`)).messages;
    await expect.poll(async () => (await messages(home)).some((line) => line.text?.includes("VIDEO-PRONTO") && line.fromTask?.threadId === job), { timeout: 30_000 }).toBe(true);
    await expect.poll(async () => (await task(job)).journal, { timeout: 30_000 }).toBeUndefined();
    const done = stored(dataDir, job);
    expect(done.closedAt).toBeGreaterThan(0);
    expect(done.entries.map((entry: any) => entry.name)).toEqual(["EDITORDEVIDEO", "Logger"]);
    expect((await task(home)).journal).toBeUndefined();
    expect(turns().filter((turn) => turn.unplanned)).toEqual([]);
  } finally {
    await session.close();
    rmSync(scratch, { recursive: true, force: true });
  }
}, hostTimeout(120_000));

it("o vigia para a EDITORDEVIDEO calada no meio da etapa: a etapa termina, o cartão sai do Agora e o diário fecha", async () => {
  const scratch = mkdtempSync(join(tmpdir(), "nordus-task-journal-stall-"));
  const session = await launchVerificationServer({ ...process.env, NORDUS_TURN_STALL_MS: "60000" }, undefined, undefined, undefined, undefined, { scripted: true });
  const { url, dataDir } = session.info;
  const cli = (...args: string[]) => runControlNordus(args, { env: { NORDUS_URL: url } }) as Promise<any>;
  try {
    const editordevideo = (await cli("new-bot", "--name", "EDITORDEVIDEO", "--section", "QG de VÍDEO")).bot;
    const ready = join(scratch, "editordevideo.ready");
    writeFileSync(join(dataDir, "room-plan.json"), JSON.stringify({
      [editordevideo.id]: {
        steps: [{ tool: "informar_etapa", arguments: { texto: "Renderizando a versão final", plano: PLAN, passo: 3, onde: "modal" } }],
        readyFile: ready, gateFile: join(scratch, "never"), reply: "Renderizei",
      },
    }));
    await cli("send", "--bot", editordevideo.id, "--task", editordevideo.activeTaskId, "--text", "Renderiza o vídeo final");
    await expect.poll(() => existsSync(ready), { timeout: 30_000 }).toBe(true);
    const task = async () => ((await (await fetch(`${url}/api/bots?messages=0`)).json() as any).bots as any[])
      .find((bot) => bot.id === editordevideo.id).tasks.find((row: any) => row.threadId === editordevideo.activeTaskId);
    expect((await task()).journal.entries.map((entry: any) => [entry.text, entry.end])).toEqual([["Renderizando a versão final", undefined]]);

    await expect.poll(async () => (await task()).busy, { timeout: 150_000, interval: 1_000 }).toBe(false);
    await expect.poll(async () => (await task()).journal, { timeout: 10_000 }).toBeUndefined();
    const done = stored(dataDir, editordevideo.activeTaskId);
    expect(done.closedAt).toBeGreaterThan(0);
    expect(done.entries[0].end).toBeGreaterThan(done.entries[0].at);
  } finally {
    await session.close();
    rmSync(scratch, { recursive: true, force: true });
  }
}, hostTimeout(210_000));
