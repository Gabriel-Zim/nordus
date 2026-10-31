import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlNordus } from "../scripts/control-nordus.ts";
import { removeTempDir } from "./testing/cleanup.ts";

it("saves a client's lesson to that client's ficha on Make it a rule, never to MEMORY.md, and refuses a client without a ficha", async () => {
  const gates = mkdtempSync(join(tmpdir(), "nordus-client-rules-gate-"));
  const work = mkdtempSync(join(tmpdir(), "nordus-client-rules-qg-"));
  mkdirSync(join(work, "fichas", "lumon"), { recursive: true });
  writeFileSync(join(work, "fichas", "lumon", "regras.md"), "# Lumon\n\n## Regras\n- Logo nunca em selo (01/10/2026)\n");
  const gate = join(gates, "finish");
  const fixture = await launchVerificationServer({ FAKE_CLAUDE_MODE: "slow", FAKE_CLAUDE_SLOW_FINISH_GATE: gate });
  const evidence: unknown[] = [];
  const api = async (method: string, path: string, body?: unknown, expected = 200, token?: string) => {
    const response = await fetch(fixture.info.url + path, {
      method, headers: { "content-type": "application/json", origin: fixture.info.url,
        ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result = await response.json() as any;
    evidence.push({ method, path, body, status: response.status, result });
    expect(response.status, JSON.stringify(result)).toBe(expected);
    return result;
  };
  try {
    const bot = (await api("POST", "/api/bots", { name: "Diretor fixture" }, 201)).bot;
    await api("PATCH", `/api/bots/${bot.id}`, { cwd: work });
    expect((await api("GET", "/api/bots?messages=0")).bots.find((candidate: any) => candidate.id === bot.id).cwd).toBe(work);
    await runControlNordus(["send", "--bot", bot.id, "--task", bot.threadId, "--text", "Aprendi uma regra da Lumon.", "--url", fixture.info.url]);
    let token = "";
    await expect.poll(() => {
      try { token = JSON.parse(readFileSync(fixture.fixtureDumpPath, "utf8")).mcpConfig.mcpServers.agents.env.NORDUS_COMMS_TOKEN; }
      catch { return false; }
      return Boolean(token);
    }, { timeout: 15_000 }).toBe(true);
    const propose = (body: Record<string, unknown>, expected = 201) => api("POST", "/api/internal/lesson-proposals", {
      fromBotId: bot.id, fromThreadId: bot.threadId, ...body,
    }, expected, token);

    const forClient = await propose({ lesson: "Título nunca em itálico", why: "A Lumon recusou o post", client: "lumon" });
    expect(forClient).toMatchObject({ status: "proposed" });
    const noFicha = await propose({ lesson: "Cor sempre azul", client: "valora" }, 400);
    expect(noFicha.error).toContain("este cliente ainda não tem ficha");
    const badSlug = await propose({ lesson: "Cor sempre azul", client: "../lumon" }, 400);
    expect(badSlug.error).toContain("../lumon");
    const blank = await propose({ lesson: "Cor sempre azul", client: "   " }, 400);
    expect(blank.error).toContain("cliente vazio");
    const own = await propose({ lesson: "Responder em frases curtas" });

    const transcript = await api("GET", `/api/threads/${bot.threadId}/messages`);
    const clientCard = transcript.messages.find((message: any) => message.card?.requestId === forClient.requestId)?.card;
    expect(clientCard.subtitle).toBe("Regra da LUMON: Título nunca em itálico\n\nA Lumon recusou o post");
    expect(clientCard.lessonRequest).toEqual({ lesson: "Título nunca em itálico", client: "lumon" });
    const ownCard = transcript.messages.find((message: any) => message.card?.requestId === own.requestId)?.card;
    expect(ownCard.subtitle).toBe("Responder em frases curtas");
    expect(ownCard.lessonRequest).toEqual({ lesson: "Responder em frases curtas" });

    writeFileSync(gate, "finish");
    await expect.poll(async () => (await api("GET", "/api/bots?messages=0")).bots.find((candidate: any) => candidate.id === bot.id).busy,
      { timeout: 15_000 }).toBe(false);

    await api("POST", `/api/threads/${bot.threadId}/respond`, { requestId: forClient.requestId, behavior: "allow" });
    const rules = readFileSync(join(work, "fichas", "lumon", "regras.md"), "utf8");
    expect(rules).toMatch(/^# Lumon\n\n## Regras\n- Título nunca em itálico \(\d{2}\/\d{2}\/\d{4}\)\n- Logo nunca em selo \(01\/10\/2026\)\n$/);
    const memoryAfterClient = await api("GET", `/api/bots/${bot.id}/memory/file`);
    expect(memoryAfterClient.text).not.toContain("Título nunca em itálico");

    await api("POST", `/api/threads/${bot.threadId}/respond`, { requestId: own.requestId, behavior: "allow" });
    const memory = await api("GET", `/api/bots/${bot.id}/memory/file`);
    expect(memory.text).toContain("## Regras\n- Responder em frases curtas");
    expect(memory.text).not.toContain("Título nunca em itálico");
    expect(readFileSync(join(work, "fichas", "lumon", "regras.md"), "utf8")).not.toContain("Responder em frases curtas");
  } finally {
    const evidencePath = `${fixture.info.logPath}.client-rules.json`;
    writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
    console.info(JSON.stringify({ evidencePath, logPath: fixture.info.logPath }));
    await fixture.close();
    await removeTempDir(gates);
    await removeTempDir(work);
  }
}, 60_000);
