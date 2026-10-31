// Real server; only the provider's planning is scripted.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlNordus } from "../scripts/control-nordus.ts";
import { hostTimeout } from "./testing/host-timeout.ts";

const SETTLED = "Your downstream room requests have settled.";
const APPROVAL_CARD = {
  type: "Card", title: "Lumon · Carrossel", caption: "Versão leve para aprovação.",
  confirm: { label: "Aprovar", action: { type: "aprovar" } }, cancel: { label: "Ajustar", action: { type: "ajustar" } },
};
const QUESTION_CARD = {
  type: "Card", title: "Lumon · Carrossel", caption: "O que você quer ajustar?",
  children: [{ type: "Form", id: "f1", children: [{ type: "Input", name: "ajuste", label: "Ajuste" }] }],
  confirm: { label: "Enviar", action: { type: "ajuste" } },
};

it("a leader's own task brings home what the person must see: the member's card, the leader's card and its result land in the conversation the task was opened from, and the answers there reach the task", async () => {
  const fixture = await launchVerificationServer({}, undefined, undefined, undefined, undefined, { scripted: true });
  const { url, dataDir } = fixture.info;
  const planPath = join(dataDir, "room-plan.json");
  const turns = (): any[] => existsSync(`${planPath}.evidence.jsonl`)
    ? readFileSync(`${planPath}.evidence.jsonl`, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) : [];
  const api = async (method: string, path: string, body?: unknown, status = 200) => {
    const response = await fetch(`${url}${path}`, { method, headers: { "content-type": "application/json", origin: url },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10_000) });
    const result = await response.json() as any;
    expect(response.status, `${method} ${path}: ${JSON.stringify(result)}`).toBe(status);
    return result;
  };
  const cli = (...args: string[]) => runControlNordus([...args, "--url", url]) as Promise<any>;
  const messages = async (threadId: string): Promise<any[]> => (await api("GET", `/api/threads/${threadId}/messages?limit=200`)).messages;
  const liveCards = async (threadId: string) => (await messages(threadId)).filter(message => message.kind === "options" && message.card?.requestId && !message.card.answered);
  const liveWidgets = async (threadId: string) => (await messages(threadId)).filter(message => message.kind === "widget" && !message.widget?.settled);
  const task = async (botId: string, threadId: string) => (await api("GET", "/api/bots")).bots.find((bot: any) => bot.id === botId).tasks.find((row: any) => row.threadId === threadId);
  try {
    const designergrafico = (await cli("new-bot", "--name", "DESIGNERGRAFICO", "--section", "QG")).bot;
    const mira = (await cli("new-bot", "--name", "Mira", "--section", "QG")).bot;
    await api("PATCH", `/api/bots/${designergrafico.id}`, { teamLead: { allow: [{ label: "conferir os arquivos do pedido", command: "ls *" }], ask: [] } });
    await api("PATCH", `/api/bots/${mira.id}`, { approvalMode: "ask" });
    const home = designergrafico.activeTaskId;
    writeFileSync(planPath, JSON.stringify({
      [designergrafico.id]: { script: [
        { key: "R0", match: ["PEDIDO-UM"], steps: [{ tool: "start_thread", arguments: { title: "Lumon · Carrossel", message: "TAREFA-UM: faça o carrossel." } }], reply: "" },
        { key: "R1", match: ["TAREFA-UM"], steps: [{ arguments: { bot_ids: [mira.id], message: "MEMBRO-UM: limpe a pasta de fora." } }], reply: "R1: Mira está nisso." },
        { key: "R2", match: [SETTLED, "RESULTADO-UM"], steps: [{ tool: "show_widget", arguments: { widget: APPROVAL_CARD, fallback_text: "Aprova ou quer ajustar?" } }], reply: "VERSAO-LEVE: pronta para aprovar." },
        { key: "R3", match: ["Ajustar"], steps: [{ tool: "show_widget", arguments: { widget: QUESTION_CARD, fallback_text: "O que você quer ajustar?" } }], reply: "PERGUNTA-AJUSTE: me diga o ajuste." },
        { key: "R4", match: ["AJUSTE-DOIS"], reply: "FEITO-DOIS: ajustei o título." },
      ] },
      [mira.id]: { script: [
        { key: "M1", match: ["MEMBRO-UM"], approve: { tool_name: "Bash", input: { command: "rm -rf /tmp/qg-fora-do-pedido" } },
          reply: "RESULTADO-UM: limpei.", replyIfDenied: "RESULTADO-UM: não limpei." },
      ] },
    }));
    await cli("send", "--bot", designergrafico.id, "--task", home, "--text", "PEDIDO-UM: um carrossel da Lumon.");
    await expect.poll(() => turns().find(turn => turn.planKey === "R1")?.threadId, { timeout: 30_000 }).toBeTruthy();
    const job = turns().find(turn => turn.planKey === "R1")!.threadId;
    expect(job).not.toBe(home);

    // The member's request that only the person may answer: on DESIGNERGRAFICO's card in the conversation the request was born in.
    await expect.poll(async () => (await liveCards(home)).length, { timeout: 30_000 }).toBe(1);
    const [relayed] = await liveCards(home);
    expect(relayed.card.relayFor).toMatchObject({ botId: mira.id });
    expect(await liveCards(job)).toEqual([]);
    expect(await task(designergrafico.id, home)).toMatchObject({ activity: "waiting-on-you" });
    await api("POST", `/api/threads/${home}/respond`, { requestId: relayed.card.requestId, behavior: "allow" });

    // DESIGNERGRAFICO's card for the person: a copy at home, answerable there; nothing in the task waits on the person.
    await expect.poll(async () => (await liveWidgets(home)).length, { timeout: 30_000 }).toBe(1);
    const [approval] = await liveWidgets(home);
    expect(approval.fromTask).toMatchObject({ threadId: job, title: "Lumon · Carrossel" });
    expect((await messages(home)).some(message => message.kind === "text" && message.text?.includes("VERSAO-LEVE") && message.fromTask?.threadId === job)).toBe(true);
    expect(await task(designergrafico.id, home)).toMatchObject({ activity: "waiting-on-you" });
    expect((await task(designergrafico.id, job)).activity).not.toBe("waiting-on-you");

    // Pressed at home, the answer runs in the task, and both copies of the card show it.
    await api("POST", `/api/bots/${designergrafico.id}/messages`, { threadId: home, sendId: "home-press-ajustar-01", widgetAction: { messageId: approval.id, ref: "cancel", rev: 0 } }, 202);
    await expect.poll(() => turns().find(turn => turn.planKey === "R3")?.threadId, { timeout: 30_000 }).toBe(job);
    expect((await messages(home)).find(message => message.id === approval.id).widget.settled).toMatchObject({ ref: "cancel", label: "Ajustar" });
    expect((await messages(job)).find(message => message.id === approval.fromTask.messageId).widget.settled).toMatchObject({ ref: "cancel" });

    // Typed at home while the task's question waits, the words stay at home and the work goes on in the task.
    await expect.poll(async () => (await liveWidgets(home)).length, { timeout: 30_000 }).toBe(1);
    await api("POST", `/api/bots/${designergrafico.id}/messages`, { threadId: home, sendId: "home-typed-ajuste-02", text: "AJUSTE-DOIS: título maior." }, 202);
    await expect.poll(() => turns().find(turn => turn.planKey === "R4")?.threadId, { timeout: 30_000 }).toBe(job);
    expect((await messages(home)).filter(message => message.role === "user" && message.text?.startsWith("AJUSTE-DOIS"))).toHaveLength(1);
    await expect.poll(async () => (await messages(home)).some(message => message.text?.includes("FEITO-DOIS") && message.fromTask?.threadId === job), { timeout: 30_000 }).toBe(true);
    expect((await task(designergrafico.id, home)).activity).not.toBe("waiting-on-you");

    // Work still out with a teammate is not the person's: the task's "Mira is on it" never came home.
    expect((await messages(home)).some(message => message.text?.includes("R1:"))).toBe(false);
    expect(turns().filter(turn => turn.unplanned)).toEqual([]);
  } finally {
    await fixture.close();
  }
}, hostTimeout(120_000));

it("a leader's own approval and questions inside its task are asked at home, answered there live or late they reach the task, and a vanished task refuses a late answer", async () => {
  const fixture = await launchVerificationServer({}, undefined, undefined, undefined, undefined, { scripted: true });
  const { url, dataDir } = fixture.info;
  const planPath = join(dataDir, "room-plan.json");
  const turns = (): any[] => existsSync(`${planPath}.evidence.jsonl`)
    ? readFileSync(`${planPath}.evidence.jsonl`, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) : [];
  const api = async (method: string, path: string, body?: unknown, status = 200) => {
    const response = await fetch(`${url}${path}`, { method, headers: { "content-type": "application/json", origin: url },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10_000) });
    const result = await response.json() as any;
    expect(response.status, `${method} ${path}: ${JSON.stringify(result)}`).toBe(status);
    return result;
  };
  const cli = (...args: string[]) => runControlNordus([...args, "--url", url]) as Promise<any>;
  const messages = async (threadId: string): Promise<any[]> => (await api("GET", `/api/threads/${threadId}/messages?limit=200`)).messages;
  const liveCards = async (threadId: string) => (await messages(threadId)).filter(message => message.kind === "options" && message.card?.requestId && !message.card.answered);
  const task = async (botId: string, threadId: string) => (await api("GET", "/api/bots")).bots.find((bot: any) => bot.id === botId).tasks.find((row: any) => row.threadId === threadId);
  try {
    const designergrafico = (await cli("new-bot", "--name", "DESIGNERGRAFICO", "--section", "QG")).bot;
    await cli("new-bot", "--name", "Mira", "--section", "QG");
    await api("PATCH", `/api/bots/${designergrafico.id}`, { teamLead: { allow: [{ label: "conferir os arquivos do pedido", command: "ls *" }], ask: [] }, approvalMode: "ask" });
    const home = designergrafico.activeTaskId;
    writeFileSync(planPath, JSON.stringify({
      [designergrafico.id]: { script: [
        { key: "R0", match: ["PEDIDO-UM"], steps: [{ tool: "start_thread", arguments: { title: "Lumon · Post", message: "TAREFA-UM: faça o post." } }], reply: "" },
        { key: "R1", match: ["TAREFA-UM"], approve: { tool_name: "Bash", input: { command: "touch /tmp/qg-teste-lider-proprio" } },
          reply: "COMANDO-OK: feito.", replyIfDenied: "COMANDO-NAO: não fiz." },
        { key: "R2", match: ["PEDIDO-DOIS"], steps: [{ tool: "start_thread", arguments: { title: "Fabrikam · Post", message: "TAREFA-DOIS: faça o post." } }], reply: "" },
        { key: "R3", match: ["TAREFA-DOIS"], approve: { tool_name: "AskUserQuestion", input: { questions: [{ question: "Qual foto usar?", header: "Foto",
          options: [{ label: "Real", description: "A foto real" }, { label: "Gerada", description: "Imagem gerada" }], multiSelect: false }] } },
          reply: "PERGUNTA-OK.", replyIfDenied: "PERGUNTA-RESPONDIDA." },
        { key: "R4", match: ["FOTO-REAL-TARDIA"], reply: "TARDIA-OK: segui com a foto real." },
        { key: "R5", match: ["PEDIDO-TRES"], steps: [{ tool: "start_thread", arguments: { title: "EVERGREEN · Post", message: "TAREFA-TRES: faça o post." } }], reply: "" },
        { key: "R6", match: ["TAREFA-TRES"], approve: { tool_name: "AskUserQuestion", input: { questions: [{ question: "Qual foto usar na EVERGREEN?", header: "Foto",
          options: [{ label: "Real", description: "A foto real" }, { label: "Gerada", description: "Imagem gerada" }], multiSelect: false }] } },
          reply: "AO-VIVO-OK: segui com a escolhida.", replyIfDenied: "AO-VIVO-RESPONDIDA: segui com a escolhida." },
        { key: "R7", match: ["PEDIDO-QUATRO"], steps: [{ tool: "start_thread", arguments: { title: "Fabrikam · Capa", message: "TAREFA-QUATRO: faça a capa." } }], reply: "" },
        { key: "R8", match: ["TAREFA-QUATRO"], approve: { tool_name: "AskUserQuestion", input: { questions: [{ question: "Qual capa?", header: "Capa",
          options: [{ label: "A", description: "Capa A" }, { label: "B", description: "Capa B" }], multiSelect: false }] } },
          reply: "QUATRO-OK.", replyIfDenied: "QUATRO-RESPONDIDA." },
      ] },
    }));

    await cli("send", "--bot", designergrafico.id, "--task", home, "--text", "PEDIDO-UM: um post da Lumon.");
    await expect.poll(async () => (await liveCards(home)).length, { timeout: 30_000 }).toBe(1);
    const job = turns().find(turn => turn.planKey === "R0") && (await api("GET", "/api/bots")).bots.find((bot: any) => bot.id === designergrafico.id).tasks.find((row: any) => row.title === "Lumon · Post").threadId;
    const [approval] = await liveCards(home);
    expect(approval.card).toMatchObject({ relayFor: { botId: designergrafico.id, threadId: job }, tool: "Bash" });
    const homeLines = await messages(home);
    expect(homeLines[homeLines.findIndex(line => line.id === approval.id) - 1]?.text).toBe('Sobre a tarefa "Lumon · Post":');
    expect(await liveCards(job)).toEqual([]);
    expect(await task(designergrafico.id, home)).toMatchObject({ activity: "waiting-on-you" });
    expect((await task(designergrafico.id, job)).activity).not.toBe("waiting-on-you");
    await api("POST", `/api/threads/${home}/respond`, { requestId: approval.card.requestId, behavior: "allow" });
    await expect.poll(() => turns().find(turn => turn.planKey === "R1")?.approval?.behavior, { timeout: 30_000 }).toBe("allow");
    await expect.poll(async () => (await messages(home)).some(message => message.text?.includes("COMANDO-OK") && message.fromTask?.threadId === job), { timeout: 30_000 }).toBe(true);
    expect((await task(designergrafico.id, home)).activity).not.toBe("waiting-on-you");

    await cli("send", "--bot", designergrafico.id, "--task", home, "--text", "PEDIDO-DOIS: um post da Fabrikam.");
    await expect.poll(async () => (await liveCards(home)).length, { timeout: 30_000 }).toBe(1);
    const second = (await api("GET", "/api/bots")).bots.find((bot: any) => bot.id === designergrafico.id).tasks.find((row: any) => row.title === "Fabrikam · Post").threadId;
    const [question] = await liveCards(home);
    expect(question.card.relayFor).toMatchObject({ botId: designergrafico.id, threadId: second });
    expect(question.card.questionRequest?.questions?.[0]?.question).toBe("Qual foto usar?");
    // Stopped before the person answered: the question stays open at home, and its late answer runs in the task.
    await api("POST", `/api/bots/${designergrafico.id}/interrupt`, { threadId: second });
    await expect.poll(async () => (await task(designergrafico.id, second)).busy, { timeout: 30_000 }).toBeFalsy();
    expect((await messages(home)).find(line => line.id === question.id).card).toMatchObject({ requestId: question.card.requestId });
    expect((await messages(home)).find(line => line.id === question.id).card.dismissed).not.toBe(true);
    expect(await task(designergrafico.id, home)).toMatchObject({ activity: "waiting-on-you" });
    const late = await api("POST", `/api/threads/${home}/respond`, { requestId: question.card.requestId, behavior: "answer", message: "FOTO-REAL-TARDIA" });
    expect(late).toMatchObject({ outcome: "answered", late: true });
    await expect.poll(() => turns().find(turn => turn.planKey === "R4")?.threadId, { timeout: 30_000 }).toBe(second);
    expect((await messages(home)).find(line => line.id === question.id).card).toMatchObject({ answered: "answer", answeredText: "FOTO-REAL-TARDIA" });
    await expect.poll(async () => (await task(designergrafico.id, home)).activity, { timeout: 30_000 }).not.toBe("waiting-on-you");

    // Answered while the task's request is still live: the answer reaches the task's engine and the card closes.
    await cli("send", "--bot", designergrafico.id, "--task", home, "--text", "PEDIDO-TRES: um post da EVERGREEN.");
    await expect.poll(async () => (await liveCards(home)).length, { timeout: 30_000 }).toBe(1);
    const third = (await api("GET", "/api/bots")).bots.find((bot: any) => bot.id === designergrafico.id).tasks.find((row: any) => row.title === "EVERGREEN · Post").threadId;
    const [live] = await liveCards(home);
    expect(live.card.relayFor).toMatchObject({ botId: designergrafico.id, threadId: third });
    await api("POST", `/api/threads/${home}/respond`, { requestId: live.card.requestId, behavior: "answer", message: "Gerada" });
    await expect.poll(() => turns().find(turn => turn.planKey === "R6")?.approval, { timeout: 30_000 }).toBeTruthy();
    expect(JSON.stringify(turns().find(turn => turn.planKey === "R6")!.approval)).toContain("Gerada");
    await expect.poll(async () => (await messages(home)).some(line => line.text?.includes("segui com a escolhida") && line.fromTask?.threadId === third), { timeout: 30_000 }).toBe(true);
    expect(await liveCards(home)).toEqual([]);

    // The task that asked is gone: the late answer is refused and the card closes, never a turn without the question.
    await cli("send", "--bot", designergrafico.id, "--task", home, "--text", "PEDIDO-QUATRO: uma capa da Fabrikam.");
    await expect.poll(async () => (await liveCards(home)).length, { timeout: 30_000 }).toBe(1);
    const fourth = (await api("GET", "/api/bots")).bots.find((bot: any) => bot.id === designergrafico.id).tasks.find((row: any) => row.title === "Fabrikam · Capa").threadId;
    const [orphan] = await liveCards(home);
    await api("POST", `/api/bots/${designergrafico.id}/interrupt`, { threadId: fourth });
    await expect.poll(async () => (await task(designergrafico.id, fourth)).busy, { timeout: 30_000 }).toBeFalsy();
    await api("DELETE", `/api/bots/${designergrafico.id}/tasks/${fourth}`);
    const refused = await api("POST", `/api/threads/${home}/respond`, { requestId: orphan.card.requestId, behavior: "answer", message: "A" }, 409);
    expect(refused.error).toBe("the task that asked this question no longer exists");
    await expect.poll(async () => (await task(designergrafico.id, home)).activity, { timeout: 30_000 }).not.toBe("waiting-on-you");
    expect((await messages(home)).find(line => line.id === orphan.id).card).toMatchObject({ dismissed: true });
    expect(turns().filter(turn => turn.botId === designergrafico.id).map(turn => turn.planKey)).not.toContain(undefined);
    expect(turns().filter(turn => turn.unplanned)).toEqual([]);
  } finally {
    await fixture.close();
  }
}, hostTimeout(120_000));
