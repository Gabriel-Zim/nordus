// Real server; only the provider's planning is scripted.
import { existsSync, mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlNordus } from "../scripts/control-nordus.ts";
import { hostTimeout } from "./testing/host-timeout.ts";
import { runningCommand } from "../shared/command-words.ts";

const SETTLED = "Your downstream room requests have settled.";

it("a member's approvals go to its team's leader: the leader's rules pass internal work, and the person's things reach the person on the leader's card", async () => {
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
  const cards = async (threadId: string) => (await messages(threadId)).filter(message => message.kind === "options" && message.card?.requestId);
  const decisions = () => {
    const month = new Date().toISOString().slice(0, 7);
    const path = join(dataDir, "decisions", `${month}.ndjson`);
    return existsSync(path) ? readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) : [];
  };
  try {
    const designergrafico = (await cli("new-bot", "--name", "DESIGNERGRAFICO", "--section", "QG")).bot;
    const mira = (await cli("new-bot", "--name", "Mira", "--section", "QG")).bot;
    await api("PATCH", `/api/bots/${mira.id}`, { approvalMode: "ask" });
    // The folder as the system resolves it: a rule names real paths, and the member's paths are resolved before they are compared.
    const entregas = join(realpathSync(dataDir), "qg", "entregas");
    const revisao = join(entregas, "lumon", "pedido", "revisao");
    const final = join(entregas, "lumon", "pedido", "final");
    mkdirSync(join(revisao, "v1"), { recursive: true });
    mkdirSync(final, { recursive: true });
    symlinkSync(final, join(revisao, "escape"));
    const policy = {
      allow: [
        { label: "exportar a versão leve", command: "echo export-preview *" },
        { label: "trocar a versão de revisão antiga", deleteUnder: join(entregas, "*", "*", "revisao") },
      ],
      ask: [{ label: "exportar em alta resolução", command: "*--final*" }],
    };
    expect((await api("PATCH", `/api/bots/${designergrafico.id}`, { teamLead: { allow: [{ label: "x" }] } }, 400)).error).toContain("exactly one of");
    expect((await api("PATCH", `/api/bots/${designergrafico.id}`, { teamLead: { allow: [{ label: "x", command: "*echo *" }] } }, 400)).error).toContain("literal program name");
    expect((await api("PATCH", `/api/bots/${designergrafico.id}`, { teamLead: policy })).bot?.teamLead ?? (await api("GET", "/api/bots")).bots.find((bot: any) => bot.id === designergrafico.id).teamLead).toEqual(policy);
    expect((await api("PATCH", `/api/bots/${mira.id}`, { teamLead: policy }, 409)).error).toContain("DESIGNERGRAFICO already leads QG");
    // A leader of another team cannot move onto a team that has one: the team would have two, and then none.
    const lia = (await cli("new-bot", "--name", "Lia", "--section", "OUTRO")).bot;
    await api("PATCH", `/api/bots/${lia.id}`, { teamLead: policy });
    expect((await api("PATCH", `/api/bots/${lia.id}`, { section: "QG" }, 409)).error).toContain("DESIGNERGRAFICO already leads QG");
    await api("PATCH", `/api/bots/${lia.id}`, { section: "QG", teamLead: null });
    // An archived leader no longer holds its team: a new one can be named.
    const nina = (await cli("new-bot", "--name", "Nina", "--section", "OUTRO")).bot;
    const vera = (await cli("new-bot", "--name", "Vera", "--section", "OUTRO")).bot;
    await api("PATCH", `/api/bots/${nina.id}`, { teamLead: policy });
    expect((await api("PATCH", `/api/bots/${vera.id}`, { teamLead: policy }, 409)).error).toContain("Nina already leads OUTRO");
    await api("PATCH", `/api/bots/${nina.id}`, { hidden: true });
    await api("PATCH", `/api/bots/${vera.id}`, { teamLead: policy });
    expect((await api("PATCH", `/api/bots/${nina.id}`, { hidden: false }, 409)).error).toContain("Vera already leads OUTRO");

    const job = designergrafico.activeTaskId;
    const m2Gate = join(dataDir, "m2-command-ends");
    // A leader on Full access hands its members Approve for me at most, also as its team's Chief: on Full their engines
    // would run without asking.
    await api("PATCH", `/api/bots/${designergrafico.id}`, { chiefOfStaff: true });
    await api("PATCH", `/api/bots/${designergrafico.id}/tasks/${job}`, { approvalMode: "full" });
    writeFileSync(planPath, JSON.stringify({
      [designergrafico.id]: { script: [
        { key: "R0", match: ["JOB-ONE"], steps: [{ arguments: { bot_ids: [mira.id], message: "EXPORT-PREVIEW: replace the old review version and export the new one." } }], reply: "R0: Mira is on it." },
        { key: "R1", match: [SETTLED, "PREVIEW-RESULT"], steps: [{ arguments: { bot_ids: [mira.id], message: "DELETE-FINAL: clear the final folder.", rework: true } }], reply: "R1: asked Mira." },
        { key: "R2", match: [SETTLED, "FINAL-RESULT"], steps: [{ arguments: { bot_ids: [mira.id], message: "LIST-FILES: check what the review folder holds.", rework: true } }], reply: "R2: asked Mira." },
        { key: "R3", match: [SETTLED, "LIST-RESULT"], reply: "LISTED" },
        { key: "R4", match: ["JOB-TWO"], steps: [{ arguments: { bot_ids: [mira.id], message: "FINAL-EXPORT: export the final version.", rework: true } }], reply: "R4: asked Mira." },
        { key: "R5", match: [SETTLED, "EXPORT-FINAL-RESULT"], reply: "ALL-DONE" },
        { key: "RQ", match: ["[Nordus team request", "Mira, a member of your team"], expectContextIncludes: ["Your rules allow: exportar a versão leve; trocar a versão de revisão antiga."],
          steps: [{ tool: "answer_member_request", arguments: { decision: "allow", reason: "conferir a pasta de revisão" } }], reply: "Liberei para a Mira." },
      ] },
      [mira.id]: { script: [
        { key: "M1", match: ["EXPORT-PREVIEW"], approve: { tool_name: "Bash", input: { command: `rm -rf ${revisao}/v1 && echo export-preview v2` } },
          reply: "PREVIEW-RESULT: exported.", replyIfDenied: "PREVIEW-RESULT: denied." },
        { key: "M2", match: ["DELETE-FINAL"], approve: { tool_name: "Bash", input: { command: `rm -rf ${revisao}/escape/` } }, toolLine: true, gateFile: m2Gate,
          reply: "FINAL-RESULT: deleted.", replyIfDenied: "FINAL-RESULT: not deleted." },
        { key: "M3", match: ["LIST-FILES"], approve: { tool_name: "Bash", input: { command: `ls -la ${revisao}` } },
          reply: "LIST-RESULT: listed.", replyIfDenied: "LIST-RESULT: not listed." },
        { key: "M4", match: ["FINAL-EXPORT"], approve: { tool_name: "Bash", input: { command: "echo export-preview --final" } },
          reply: "EXPORT-FINAL-RESULT: exported.", replyIfDenied: "EXPORT-FINAL-RESULT: not exported." },
      ] },
    }));
    await cli("send", "--bot", designergrafico.id, "--task", job, "--text", "JOB-ONE: have Mira refresh the review version.");

    // Internal work: DESIGNERGRAFICO's rules answer at once, nothing reaches the person.
    await expect.poll(() => turns().find(turn => turn.planKey === "M1")?.approval?.behavior, { timeout: 30_000 }).toBe("allow");
    const work = turns().find(turn => turn.planKey === "M1")!.threadId;
    expect(turns().find(turn => turn.planKey === "M1")!.permissionMode).toBe("auto");
    const rows = (await messages(work)).map(message => message.tool?.name).filter(Boolean);
    expect(rows).toContain("DESIGNERGRAFICO liberou: trocar a versão de revisão antiga e exportar a versão leve");
    expect((await messages(work)).find(message => message.tool?.name?.startsWith("DESIGNERGRAFICO liberou:"))?.tool?.approved).toBe(true);
    expect((await messages(work)).find(message => message.tool?.name?.includes("delegated by DESIGNERGRAFICO"))?.tool?.approved).toBeUndefined();
    expect(rows).toContain("Approve for me — delegated by DESIGNERGRAFICO, a Chief of Staff on Full access");
    expect(decisions().find(row => row.threadId === work && row.decision === "auto-approved")).toMatchObject({ source: "team-lead", botName: "Mira" });

    // The person's thing (a link inside the review folder that points outside it, deleted through the link): DESIGNERGRAFICO brings
    // it to the person in her own conversation, which waits on the person without being busy; Mira never waits on the person.
    const relayed = async () => (await cards(job)).find(message => message.card.relayFor && !message.card.answered);
    await expect.poll(relayed, { timeout: 30_000 }).toBeTruthy();
    const card = (await relayed())!;
    expect(card.card).toMatchObject({ relayFor: { botId: mira.id, name: "Mira", threadId: work }, tool: "Bash", heldCode: "approval.held.sensitive" });
    expect(card.card.explanation).toMatch(/^Preciso da sua aprovação aqui: Mira quer /);
    expect(await cards(work)).toEqual([]);
    const fleet = (await api("GET", "/api/bots")).bots.find((bot: any) => bot.id === mira.id);
    expect(fleet.activity).not.toBe("waiting-on-you");
    expect((fleet.tasks ?? []).map((task: any) => task.activity)).not.toContain("waiting-on-you");
    expect((await messages(work)).some(message => message.tool?.name === "DESIGNERGRAFICO levou este pedido a você")).toBe(true);
    const designerGraficoJob = async () => (await api("GET", "/api/bots")).bots.find((bot: any) => bot.id === designergrafico.id).tasks.find((task: any) => task.threadId === job);
    expect(await designerGraficoJob()).toMatchObject({ activity: "waiting-on-you", busy: false });

    // The command shows before its yes, as the CLI orders them; while the person decides, nothing runs yet.
    const miraSteps = async () => (await api("GET", "/api/bots")).bots.find((bot: any) => bot.id === mira.id).tasks.find((task: any) => task.threadId === work)?.steps ?? [];
    expect((await messages(work)).some(message => message.kind === "activity" && message.tool?.name === "Bash" && message.tool.ok === undefined)).toBe(true);
    expect(runningCommand(await messages(work))).toBeNull();
    expect((await miraSteps()).at(-1)).toMatchObject({ tool: "Bash" });
    expect((await miraSteps()).at(-1)?.since).toBeUndefined();

    await api("POST", `/api/threads/${job}/respond`, { requestId: card.card.requestId, behavior: "allow" });
    // Allowed and still open: the command runs, counted from the yes, in the chat and in the steps.
    await expect.poll(async () => runningCommand(await messages(work))?.command, { timeout: 30_000 }).toContain("rm -rf");
    const allowedAt = (await messages(work)).find(message => message.tool?.name?.startsWith("Você liberou"))!.at;
    expect(runningCommand(await messages(work))?.since).toBe(allowedAt);
    await expect.poll(async () => (await miraSteps()).at(-1)?.since, { timeout: 10_000 }).toBe(allowedAt);
    writeFileSync(m2Gate, "done");
    await expect.poll(async () => runningCommand(await messages(work)), { timeout: 10_000 }).toBeNull();
    await expect.poll(() => turns().find(turn => turn.planKey === "M2")?.approval?.behavior, { timeout: 30_000 }).toBe("allow");
    await expect.poll(async () => (await cards(job)).find(message => message.id === card.id)?.card.answered, { timeout: 10_000 }).toBe("allow");
    await expect.poll(async () => (await designerGraficoJob()).activity, { timeout: 10_000 }).not.toBe("waiting-on-you");
    expect(decisions().find(row => row.threadId === work && row.decision === "user-approved")).toMatchObject({ botName: "Mira", source: "user" });
    expect((await messages(work)).find(message => message.tool?.name === "DESIGNERGRAFICO levou este pedido a você")?.tool?.awaitingApproval).toBe(true);
    await expect.poll(async () => (await messages(work)).find(message => message.tool?.approved && message.tool.name.startsWith("Você liberou"))?.tool?.ok, { timeout: 10_000 }).toBe(true);

    // The grey zone with no decision model: DESIGNERGRAFICO decides in her own turn, in her team requests conversation.
    await expect.poll(() => turns().find(turn => turn.planKey === "M3")?.approval?.behavior, { timeout: 30_000 }).toBe("allow");
    const leaderTurn = turns().find(turn => turn.planKey === "RQ")!;
    expect(leaderTurn.botId).toBe(designergrafico.id);
    expect(leaderTurn.threadId).not.toBe(job);
    expect((await messages(leaderTurn.threadId)).some(message => message.tool?.name?.startsWith("Mira pede sua decisão") && message.threadRef?.threadId === work)).toBe(true);
    const listed = (await messages(work)).map(message => message.tool?.name).filter(Boolean);
    expect(listed).toEqual(expect.arrayContaining(["Esperando DESIGNERGRAFICO decidir", "DESIGNERGRAFICO liberou: conferir a pasta de revisão"]));
    expect((await messages(work)).find(message => message.tool?.name === "Esperando DESIGNERGRAFICO decidir")?.tool?.awaitingApproval).toBe(true);
    expect(await cards(work)).toEqual([]);
    expect((await cards(job)).filter(message => !message.card.answered)).toEqual([]);
    expect(decisions().filter(row => row.threadId === work && row.decision === "auto-approved").map(row => row.source)).toEqual(["team-lead", "team-lead-turn"]);

    // Full access on the member never skips what the leader's rules give the person.
    await expect.poll(async () => (await messages(job)).some(message => message.kind === "text" && message.text?.includes("LISTED")), { timeout: 30_000 }).toBe(true);
    await api("PATCH", `/api/bots/${mira.id}`, { approvalMode: "full", applyToAllThreads: true });
    await cli("send", "--bot", designergrafico.id, "--task", job, "--text", "JOB-TWO: have Mira export the final version.");
    await expect.poll(relayed, { timeout: 30_000 }).toBeTruthy();
    const finalCard = (await relayed())!;
    expect(finalCard.card).toMatchObject({ relayFor: { botId: mira.id }, tool: "Bash" });
    expect(turns().find(turn => turn.planKey === "M4")?.approval).toBeUndefined();
    await api("POST", `/api/threads/${job}/respond`, { requestId: finalCard.card.requestId, behavior: "deny" });
    await expect.poll(() => turns().find(turn => turn.planKey === "M4")?.approval?.behavior, { timeout: 30_000 }).toBe("deny");
    expect(decisions().some(row => row.threadId === work && row.decision === "auto-approved" && row.source === "full-access")).toBe(false);
    await expect.poll(async () => (await messages(job)).some(message => message.kind === "text" && message.text?.includes("ALL-DONE")), { timeout: 30_000 }).toBe(true);
  } finally {
    await fixture.close();
  }
}, hostTimeout(120_000));

it("a level a Chief delegated before the team had a leader drops to Approve for me once it has one, and a leader that is no Chief hands that at most", async () => {
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
  const rows = async (threadId: string): Promise<string[]> =>
    (await api("GET", `/api/threads/${threadId}/messages?limit=200`)).messages.map((message: any) => message.tool?.name).filter(Boolean);
  const persistedTask = (botId: string, threadId: string) => JSON.parse(readFileSync(join(dataDir, "bots.json"), "utf8"))
    .find((bot: any) => bot.id === botId).tasks.find((task: any) => task.threadId === threadId);
  const turn = async (key: string) => {
    await expect.poll(() => turns().find(candidate => candidate.planKey === key), { timeout: 30_000 }).toBeTruthy();
    return turns().find(candidate => candidate.planKey === key)!;
  };
  try {
    const clive = (await cli("new-bot", "--name", "Clive", "--section", "QG")).bot;
    const bea = (await cli("new-bot", "--name", "Bea", "--section", "QG")).bot;
    await api("PATCH", `/api/bots/${clive.id}`, { chiefOfStaff: true });
    await api("PATCH", `/api/bots/${bea.id}`, { approvalMode: "ask" });
    await api("PATCH", `/api/bots/${clive.id}/tasks/${clive.activeTaskId}`, { approvalMode: "full" });
    writeFileSync(planPath, JSON.stringify({
      [clive.id]: { script: [
        { key: "C1", match: ["JOB-A"], steps: [{ arguments: { bot_ids: [bea.id], message: "WORK-A: check the report." } }], reply: "C1: asked Bea." },
        { key: "C2", match: ["JOB-B"], steps: [{ arguments: { bot_ids: [bea.id], message: "WORK-B: check it again.", rework: true } }], reply: "C2: asked Bea." },
        { key: "CS", match: [SETTLED], reply: "Bea answered." },
      ] },
      [bea.id]: { script: [
        { key: "B1", match: ["WORK-A"], reply: "A-DONE" },
        { key: "BD", match: ["DIRECT"], reply: "DIRECT-DONE" },
        { key: "B2", match: ["WORK-B"], reply: "B-DONE" },
        { key: "B3", match: ["WORK-C"], reply: "C-DONE" },
      ] },
    }));

    // Before the team has a leader, the Chief hands its Full access on.
    await cli("send", "--bot", clive.id, "--task", clive.activeTaskId, "--text", "JOB-A: have Bea check the report.");
    const first = await turn("B1");
    expect(first.permissionMode).toBe("bypassPermissions");
    expect(await rows(first.threadId)).toContain("Full access — delegated by Clive, a Chief of Staff on Full access");
    expect((await cli("wait", "--bot", clive.id, "--task", clive.activeTaskId, "--timeout", "25")).status).toBe("settled");

    // The team gains a leader that is no Chief: Bea's conversation no longer runs on the Chief's Full access.
    const designergrafico = (await cli("new-bot", "--name", "DESIGNERGRAFICO", "--section", "QG")).bot;
    await api("PATCH", `/api/bots/${designergrafico.id}`, { teamLead: { allow: [{ label: "listar", command: "ls *" }], ask: [] } });
    await cli("send", "--bot", bea.id, "--task", first.threadId, "--text", "DIRECT: one more look.");
    expect((await turn("BD")).permissionMode).toBe("auto");
    expect((await cli("wait", "--bot", bea.id, "--task", first.threadId, "--timeout", "25")).status).toBe("settled");

    // The next delegation rewrites the level it left there, saying what the Chief is on.
    await cli("send", "--bot", clive.id, "--task", clive.activeTaskId, "--text", "JOB-B: have Bea check it again.");
    const second = await turn("B2");
    expect(second.threadId).toBe(first.threadId);
    expect(second.permissionMode).toBe("auto");
    expect(persistedTask(bea.id, first.threadId)).toMatchObject({ approvalMode: "auto" });
    expect(await rows(first.threadId)).toContain("Approve for me — delegated by Clive, a Chief of Staff on Full access");
    expect((await cli("wait", "--bot", clive.id, "--task", clive.activeTaskId, "--timeout", "25")).status).toBe("settled");

    // The leader itself, on Full access and no Chief, hands Approve for me at most.
    const job = designergrafico.activeTaskId;
    await api("PATCH", `/api/bots/${designergrafico.id}/tasks/${job}`, { approvalMode: "full" });
    const plans = JSON.parse(readFileSync(planPath, "utf8"));
    plans[designergrafico.id] = { script: [
      { key: "R1", match: ["JOB-C"], steps: [{ arguments: { bot_ids: [bea.id], message: "WORK-C: list the folder." } }], reply: "R1: asked Bea." },
      { key: "RS", match: [SETTLED], reply: "Bea answered." },
    ] };
    writeFileSync(planPath, JSON.stringify(plans));
    await cli("send", "--bot", designergrafico.id, "--task", job, "--text", "JOB-C: have Bea list the folder.");
    const third = await turn("B3");
    expect(third.permissionMode).toBe("auto");
    expect(await rows(third.threadId)).toContain("Approve for me — delegated by DESIGNERGRAFICO, the team's leader on Full access");
  } finally {
    await fixture.close();
  }
}, hostTimeout(120_000));
