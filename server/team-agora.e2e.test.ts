// Nordus: the person talks to the team's lead only. A teammate working on what the lead sent gets its plain working
// line, the lead's "Agora" reads it from the wire, and the handoff pills between teammates are the ones simple mode hides.
// A bot of another team the lead reached through openTo works too, but never shows in the lead's "Agora".
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlNordus } from "../scripts/control-nordus.ts";
import { DECIDER_JOBS } from "../shared/decider-jobs.ts";
import { isTeamHandoff, teammateWork } from "../shared/team-work.ts";

it("DESIGNERGRAFICO delega ao Designer: o Agora dela mostra a linha do Designer, sem pílula de repasse e sem o bot de outro time", async () => {
  const scratch = mkdtempSync(join(tmpdir(), "nordus-team-agora-"));
  const routes = join(scratch, "routes.json");
  writeFileSync(routes, JSON.stringify({
    'Pedido: """Diagrama a lâmina 3': JSON.stringify({ fazendo: "Diagramando a lâmina 3 da Lumon", objeto: "a lâmina 3 da Lumon" }),
    'Pedido: """Procura referências': JSON.stringify({ fazendo: "Pesquisando referências de capa", objeto: "" }),
  }));
  const session = await launchVerificationServer({ ...process.env, FAKE_CLAUDE_TEXT_ROUTES: routes }, undefined, undefined, undefined, undefined, { scripted: true });
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
    const designergrafico = (await cli("new-bot", "--name", "DESIGNERGRAFICO", "--section", "QG de DESIGN")).bot;
    const designer = (await cli("new-bot", "--name", "Designer", "--section", "QG de DESIGN")).bot;
    const pesquisador = (await cli("new-bot", "--name", "Pesquisador", "--section", "PESQUISA")).bot;
    // DESIGNERGRAFICO leads her team: what she sends a member is that member's own task (a colleague who is not led gets it in its main conversation).
    await api("PATCH", `/api/bots/${designergrafico.id}`, { teamLead: { allow: [{ label: "conferir os arquivos do pedido", command: "ls *" }], ask: [] } });
    await api("PATCH", `/api/bots/${pesquisador.id}`, { openTo: ["QG de DESIGN"], acknowledgePeerScope: true });
    // The working line is the decision model's job; the model is never called for it, so a closed loopback address will do.
    // Every other job off: none of them should reach out in this check.
    const jobs = Object.fromEntries(DECIDER_JOBS.map((job) => [job, job === "workingLine"]));
    await api("PATCH", "/api/config", { decider: { baseUrl: "http://127.0.0.1:9", jobs } });
    await api("PATCH", "/api/config", { decider: { key: "tsk_fixture_only_team_agora", jobs } });

    const planPath = join(dataDir, "room-plan.json");
    const gate = join(scratch, "gate");
    const ready = (name: string) => join(scratch, `${name}.ready`);
    writeFileSync(planPath, JSON.stringify({
      [designergrafico.id]: {
        steps: [
          { arguments: { bot_ids: [designer.id], message: "Diagrama a lâmina 3 da Lumon com a foto nova" } },
          { arguments: { bot_ids: [pesquisador.id], message: "Procura referências de capa para a Lumon" } },
        ],
        reply: "Pedi ao time",
        resumeReply: "A lâmina 3 está pronta",
      },
      [designer.id]: { readyFile: ready("designer"), gateFile: gate, reply: "Lâmina 3 diagramada" },
      [pesquisador.id]: { readyFile: ready("pesquisador"), gateFile: gate, reply: "Três referências" },
    }));

    await cli("send", "--bot", designergrafico.id, "--task", designergrafico.activeTaskId, "--text", "Faz a lâmina 3 da Lumon");
    await expect.poll(() => existsSync(ready("designer")) && existsSync(ready("pesquisador")), { timeout: 30_000 }).toBe(true);

    const bots = async () => (await api("GET", "/api/bots?messages=0")).bots as any[];
    const workOf = (all: any[], botId: string) => all.find((bot) => bot.id === botId).tasks.find((task: any) => task.openedBy?.botId === designergrafico.id);
    // Both delegated turns get their line, one light call each.
    await expect.poll(async () => workOf(await bots(), designer.id)?.doing, { timeout: 20_000 }).toBe("Diagramando a lâmina 3 da Lumon");
    // Another team's bot gets the request in its main conversation, with its line there, and no task of its own.
    const mainOf = (all: any[]) => all.find((bot) => bot.id === pesquisador.id).tasks.find((task: any) => task.threadId === pesquisador.activeTaskId);
    await expect.poll(async () => mainOf(await bots())?.doing, { timeout: 20_000 }).toBe("Pesquisando referências de capa");
    expect(workOf(await bots(), pesquisador.id)).toBeUndefined();

    const live = await bots();
    const lead = { ...live.find((bot) => bot.id === designergrafico.id), threadId: designergrafico.activeTaskId };
    expect(teammateWork(lead, live)).toEqual([expect.objectContaining({ botId: designer.id, name: "Designer", doing: "Diagramando a lâmina 3 da Lumon" })]);

    const messages = async () => (await api("GET", `/api/threads/${designergrafico.activeTaskId}/messages?limit=100`)).messages as any[];
    const pill = (all: any[], name: string) => all.find((message) => message.tool?.name === name);
    const sent = await messages();
    expect(isTeamHandoff(pill(sent, "Sent to Designer"), lead, live)).toBe(true);
    expect(isTeamHandoff(pill(sent, "Sent to Pesquisador"), lead, live)).toBe(false);

    writeFileSync(gate, "go");
    await expect.poll(async () => {
      const all = await messages();
      return Boolean(pill(all, "Designer replied") && pill(all, "Pesquisador replied"));
    }, { timeout: 30_000 }).toBe(true);
    const replied = await messages();
    expect(isTeamHandoff(pill(replied, "Designer replied"), lead, live)).toBe(true);
    expect(isTeamHandoff(pill(replied, "Pesquisador replied"), lead, live)).toBe(false);
    // The line goes with the turn, and the lead's "Agora" with it.
    await expect.poll(async () => workOf(await bots(), designer.id)?.doing ?? null, { timeout: 20_000 }).toBeNull();
    const after = await bots();
    expect(teammateWork({ ...after.find((bot) => bot.id === designergrafico.id), threadId: designergrafico.activeTaskId }, after)).toEqual([]);
  } finally {
    await session.close();
    rmSync(scratch, { recursive: true, force: true });
  }
}, 120_000);
