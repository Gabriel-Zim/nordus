// Nordus: a bot opened to another team (openTo) is reached by that team's bots through the real
// coordinate_bots path, and nothing else opens: not its teammates, not the way back, not a third team.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlNordus } from "../scripts/control-nordus.ts";
import { request } from "../scripts/mcp-server.ts";

it("SOCIAL do ZORG pede ao Diretor do QG e recebe a resposta; e falar é livre para todo o resto", async () => {
  const session = await launchVerificationServer({ ...process.env }, undefined, undefined, undefined, undefined, { scripted: true });
  const cli = (...args: string[]) => runControlNordus(args, { env: { NORDUS_URL: session.info.url } }) as Promise<any>;
  const api = (path: string, body?: unknown, method = "POST") =>
    request(path, body === undefined ? {} : { method, body: JSON.stringify(body) }, session.info.url) as Promise<any>;
  // A refused PATCH is the point of some checks, so these read the status instead of throwing.
  const patch = async (botId: string, body: unknown) => {
    const response = await fetch(`${session.info.url}/api/bots/${botId}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() as any };
  };
  try {
    const social = (await cli("new-bot", "--name", "SOCIAL AVERYMERCER.AI", "--section", "ZORG")).bot;
    const diretor = (await cli("new-bot", "--name", "Diretor de Arte", "--section", "QG DE DESIGN")).bot;
    const designer = (await cli("new-bot", "--name", "Designer", "--section", "QG DE DESIGN")).bot;
    const assistentefinanceiro = (await cli("new-bot", "--name", "AssistenteFinanceiro", "--section", "FINANCEIRO")).bot;
    const botState = async (id: string) => (await api("/api/bots?messages=0", undefined, "GET")).bots.find((bot: any) => bot.id === id);

    // The PATCH: 0 to 10 existing team names of 1 to 60 characters, confirmed; null or [] closes it.
    expect((await patch(diretor.id, { openTo: ["ZORG"] })).status).toBe(400);
    expect((await patch(diretor.id, { openTo: ["NAO EXISTE"], acknowledgePeerScope: true })).status).toBe(400);
    expect((await patch(diretor.id, { openTo: Array.from({ length: 11 }, () => "ZORG"), acknowledgePeerScope: true })).status).toBe(400);
    expect((await patch(diretor.id, { openTo: ["x".repeat(61)], acknowledgePeerScope: true })).status).toBe(400);
    expect((await patch(diretor.id, { openTo: "ZORG", acknowledgePeerScope: true })).status).toBe(400);
    expect((await patch(diretor.id, { openTo: [" ZORG "], acknowledgePeerScope: true })).status).toBe(200);
    expect((await botState(diretor.id)).openTo).toEqual(["ZORG"]);
    expect((await patch(diretor.id, { openTo: null })).status).toBe(200);
    expect(await botState(diretor.id)).not.toHaveProperty("openTo");
    expect((await patch(diretor.id, { openTo: ["ZORG"], acknowledgePeerScope: true })).status).toBe(200);
    expect((await patch(diretor.id, { openTo: [] })).status).toBe(200);
    expect(await botState(diretor.id)).not.toHaveProperty("openTo");
    expect((await patch(diretor.id, { openTo: ["ZORG"], acknowledgePeerScope: true })).status).toBe(200);
    // Any team that exists may be named, and null closes it again.
    expect((await patch(designer.id, { openTo: ["FINANCEIRO"], acknowledgePeerScope: true })).status).toBe(200);
    expect((await patch(designer.id, { openTo: null })).status).toBe(200);

    const planPath = join(session.info.dataDir, "room-plan.json");
    const plan: Record<string, any> = {
      [social.id]: {
        steps: [
          { arguments: { bot_ids: [designer.id], message: "Designer, monta o post", consult: true } },
          { arguments: { bot_ids: [diretor.id], message: "OPEN_TO_BRIEF qual paleta uso no post de segunda?", consult: true } },
        ],
        reply: "Perguntei ao Diretor de Arte",
        resumeReply: "O Diretor respondeu",
      },
      [diretor.id]: {
        reply: "OPEN_TO_ANSWER paleta da marca, fundo claro",
      },
      [designer.id]: { reply: "Designer ouviu" },
      [assistentefinanceiro.id]: {
        steps: [{ arguments: { bot_ids: [diretor.id], message: "Diretor, faz um layout para o financeiro", consult: true } }],
        reply: "Pedi ao Diretor",
      },
    };
    writeFileSync(planPath, JSON.stringify(plan));
    const evidence = () => existsSync(`${planPath}.evidence.jsonl`)
      ? readFileSync(`${planPath}.evidence.jsonl`, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) : [];
    const messages = async (threadId: string) => (await api(`/api/threads/${threadId}/messages`, undefined, "GET")).messages;
    const run = async (bot: any, text: string) => {
      await cli("send", "--bot", bot.id, "--task", bot.activeTaskId, "--text", text);
      expect((await cli("wait", "--bot", bot.id, "--task", bot.activeTaskId, "--timeout", "40")).status).toBe("settled");
    };

    await run(social, "Pergunta ao Diretor de Arte qual paleta usar");
    const answered = async () => (await messages(social.activeTaskId)).find((message: any) =>
      String(message.tool?.output ?? message.text ?? "").includes("OPEN_TO_ANSWER"));
    await expect.poll(answered, { timeout: 20_000 }).toBeTruthy();
    expect((await answered()).tool?.name).toBe("Diretor de Arte replied");

    const turnsOf = (id: string) => evidence().filter((turn: any) => turn.botId === id);
    const first = turnsOf(social.id)[0];
    // list_room_targets: what SOCIAL is told it can reach is what coordinate_bots lets through.
    const listed = JSON.parse(first.evidence[1].result.content[0].text).bots.map((bot: any) => bot.id);
    expect(listed).toContain(diretor.id);
    expect(listed).toContain(designer.id);
    expect(listed).toContain(assistentefinanceiro.id);
    const steps = first.evidence.filter((entry: any) => entry.step);
    expect(steps[0].response.result.isError).toBeFalsy();
    expect(steps[1].response.result.isError).toBeFalsy();
    // The Diretor answered, and the Designer of its own team was reached too.
    expect(turnsOf(diretor.id)[0]).toBeTruthy();
    await expect.poll(() => turnsOf(designer.id).length, { timeout: 20_000 }).toBeGreaterThan(0);

    await run(assistentefinanceiro, "Pede um layout ao Diretor de Arte");
    const reached = turnsOf(assistentefinanceiro.id)[0].evidence.find((entry: any) => entry.step).response.result;
    expect(reached.isError).toBeFalsy();
    await expect.poll(() => turnsOf(diretor.id).length, { timeout: 20_000 }).toBeGreaterThan(1);

    // Deleting the team takes it out of openTo, so a new team of that name is not let in.
    const deleted = await fetch(`${session.info.url}/api/sidebar-sections?section=${encodeURIComponent("ZORG")}`, { method: "DELETE" });
    expect(deleted.status).toBe(200);
    expect(await botState(diretor.id)).not.toHaveProperty("openTo");
  } finally {
    await session.close();
  }
}, 120_000);

// A Chief's level flows down only to its own team: reaching a bot through openTo raises nothing.
it("Chief do ZORG em Approve for me eleva o colega do ZORG, mas não o Diretor aberto ao ZORG", async () => {
  const fixture = await launchVerificationServer({}, undefined, undefined, undefined, undefined, { scripted: true });
  const { url, dataDir } = fixture.info;
  const planPath = join(dataDir, "room-plan.json");
  const plans: Record<string, { turns: any[] }> = {};
  const providerTurns = (): any[] => existsSync(`${planPath}.evidence.jsonl`)
    ? readFileSync(`${planPath}.evidence.jsonl`, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) : [];
  const api = async (method: string, path: string, body?: unknown, status = 200) => {
    const response = await fetch(`${url}${path}`, { method, headers: { "content-type": "application/json", origin: url },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10_000) });
    const result = await response.json() as any;
    expect(response.status, `${method} ${path}: ${JSON.stringify(result)}`).toBe(status);
    return result;
  };
  const cli = (...args: string[]) => runControlNordus([...args, "--url", url]) as Promise<any>;
  const messages = async (threadId: string) => (await api("GET", `/api/threads/${threadId}/messages?limit=100`)).messages as any[];
  const persistedTask = (botId: string, threadId: string) => JSON.parse(readFileSync(join(dataDir, "bots.json"), "utf8"))
    .find((bot: any) => bot.id === botId).tasks.find((task: any) => task.threadId === threadId);
  const bringIn = async (chief: any, threadId: string, teammate: any, requestKey: string) => {
    plans[teammate.id] = { turns: [{ reply: `${teammate.name} olhou o pedido.` }] };
    (plans[chief.id] ??= { turns: [] }).turns.push(
      { steps: [{ tool: "coordinate_bots", arguments: { bot_ids: [teammate.id], request_key: requestKey, message: "Olha este pedido e diz o que achou." } }],
        reply: `Pedi a ${teammate.name}.` },
      { reply: `${teammate.name} respondeu.` },
    );
    writeFileSync(planPath, JSON.stringify(plans));
    await cli("send", "--bot", chief.id, "--task", threadId, "--text", `Pede a ${teammate.name} para olhar o pedido.`);
    await expect.poll(() => providerTurns().find(turn => turn.botId === teammate.id), { timeout: 25_000 }).toBeTruthy();
    expect((await cli("wait", "--bot", chief.id, "--task", threadId, "--timeout", "25")).status).toBe("settled");
    return providerTurns().find(turn => turn.botId === teammate.id)!;
  };
  try {
    const chief = (await cli("new-bot", "--name", "Clive", "--section", "ZORG")).bot;
    await api("PATCH", `/api/bots/${chief.id}`, { chiefOfStaff: true });
    const ada = (await cli("new-bot", "--name", "Ada", "--section", "ZORG")).bot;
    const diretor = (await cli("new-bot", "--name", "Diretor de Arte", "--section", "QG DE DESIGN")).bot;
    for (const bot of [ada, diretor]) await api("PATCH", `/api/bots/${bot.id}`, { approvalMode: "ask" });
    await api("PATCH", `/api/bots/${diretor.id}`, { openTo: ["ZORG"], acknowledgePeerScope: true });
    await api("PATCH", `/api/bots/${chief.id}/tasks/${chief.activeTaskId}`, { approvalMode: "auto", acknowledgeLocalAuto: true });

    const adaTurn = await bringIn(chief, chief.activeTaskId, ada, "colega");
    expect(adaTurn.permissionMode).toBe("auto");
    expect(persistedTask(ada.id, adaTurn.threadId)).toMatchObject({ approvalMode: "auto" });

    const diretorTurn = await bringIn(chief, chief.activeTaskId, diretor, "aberto");
    expect(diretorTurn.permissionMode).toBe("default");
    expect(persistedTask(diretor.id, diretorTurn.threadId)?.approvalMode ?? "ask").toBe("ask");
    expect((await messages(diretorTurn.threadId)).some(message => /delegated by/.test(message.tool?.name ?? ""))).toBe(false);
  } finally {
    await fixture.close();
  }
}, 120_000);
