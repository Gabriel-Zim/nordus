import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlNordus } from "../scripts/control-nordus.ts";

it("keeps a news-only routine's empty runs out of the conversation and posts the ones with news", async () => {
  const fixture = await launchVerificationServer();
  const evidence: unknown[] = [{ fixture: fixture.info }];
  const api = async (method: string, path: string, body?: unknown, status = 200) => {
    const response = await fetch(`${fixture.info.url}${path}`, {
      method, headers: { "content-type": "application/json", origin: fixture.info.url },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const value = await response.json() as any;
    expect(response.status, `${method} ${path}: ${JSON.stringify(value)}`).toBe(status);
    if (method !== "GET") evidence.push({ method, path, body, status: response.status, result: value });
    return value;
  };
  const runState = async (id: string) => (await api("GET", "/api/routines")).runs.find((run: any) => run.id === id);
  const messages = async (id: string) => (await api("GET", `/api/threads/${id}/messages?limit=200`)).messages as any[];
  const promptsLog = join(fixture.info.dataDir, "prompts.jsonl");
  const promptsSoFar = () => {
    try { return readFileSync(promptsLog, "utf8").trim().split("\n").filter(Boolean); } catch { return []; }
  };
  const runOnce = async (routineId: string) => {
    const before = promptsSoFar().length;
    const { run } = await api("POST", `/api/routines/${routineId}/run`, undefined, 201);
    await expect.poll(async () => (await runState(run.id))?.status, { timeout: 20_000 }).toBe("completed");
    return { run: await runState(run.id), prompt: promptsSoFar().slice(before).join("\n") };
  };
  try {
    const wrapper = join(fixture.info.dataDir, "news-only-claude.mjs");
    writeFileSync(wrapper, [
      "#!/usr/bin/env node",
      `process.env.FAKE_CLAUDE_REPLIES = ${JSON.stringify(JSON.stringify(["NADA_NOVO", "Dois posts novos no portal.", "NADA_NOVO"]))};`,
      `process.env.FAKE_CLAUDE_REPLY_STATE = ${JSON.stringify(join(fixture.info.dataDir, "reply-state"))};`,
      `process.env.FAKE_CLAUDE_PROMPTS = ${JSON.stringify(promptsLog)};`,
      `await import(${JSON.stringify(pathToFileURL(join(process.cwd(), "server/testing/fake-claude-cli.ts")).href)});`,
    ].join("\n"), { mode: 0o700 });
    await api("PATCH", "/api/instances/claude", { cli: wrapper });
    await api("PATCH", "/api/config", { features: { routinesInConversation: true } });
    const { bot } = await runControlNordus(["new-bot", "--name", "Portal watch", "--url", fixture.info.url]) as any;
    const main = (await api("GET", "/api/bots")).bots.find((candidate: any) => candidate.id === bot.id).threadId as string;
    const schedule = { type: "interval", everyMinutes: 10, anchorAt: Date.now() + 3_600_000 };
    const { routine: newsOnly } = await api("POST", "/api/routines", {
      name: "Vigia do portal", prompt: "Olhe o portal e diga o que mudou.", botId: bot.id, enabled: false, schedule, reportOnlyNews: true,
    }, 201);
    expect(newsOnly.reportOnlyNews).toBe(true);

    const quiet = await runOnce(newsOnly.id);
    expect(quiet.prompt).toContain("NADA_NOVO");
    expect(quiet.run).toMatchObject({ status: "completed", quiet: true, output: "Sem novidade.", reportOnlyNews: true });
    expect(quiet.run.threadId).not.toBe(main);
    const afterQuiet = await messages(main);
    expect(afterQuiet.filter((message) => message.routineRun?.runId === quiet.run.id)).toEqual([]);
    expect(JSON.stringify(afterQuiet)).not.toContain("NADA_NOVO");
    expect((await api("GET", "/api/bots")).bots.find((candidate: any) => candidate.id === bot.id)
      .tasks.find((task: any) => task.threadId === main).unread).not.toBe(true);

    const news = await runOnce(newsOnly.id);
    expect(news.run.quiet).toBeUndefined();
    expect(news.run.threadId).not.toBe(main);
    const newsCards = (await messages(main)).filter((message) => message.routineRun?.runId === news.run.id);
    expect(newsCards).toHaveLength(1);
    expect(newsCards[0].routineRun).toMatchObject({ status: "completed", summary: "Dois posts novos no portal." });
    expect(newsCards[0].text).toBe("Rotina “Vigia do portal” concluída\n\nDois posts novos no portal.");

    const { routine: ordinary } = await api("POST", "/api/routines", {
      name: "Relatório", prompt: "Relate o estado.", botId: bot.id, enabled: false, schedule,
    }, 201);
    expect(ordinary.reportOnlyNews).toBeUndefined();
    const plain = await runOnce(ordinary.id);
    expect(plain.prompt).not.toContain("NADA_NOVO");
    expect(plain.run.quiet).toBeUndefined();
    expect(plain.run.threadId).toBe(main);
    expect((await messages(main)).filter((message) => message.routineRun?.runId === plain.run.id)).toHaveLength(1);

    const history = (await api("GET", "/api/routines")).runs.filter((run: any) => run.routineId === newsOnly.id);
    expect(history.map((run: any) => [run.id, run.quiet === true])).toEqual(expect.arrayContaining([[quiet.run.id, true], [news.run.id, false]]));
    evidence.push({ main: await messages(main), history });
  } finally {
    const evidencePath = `${fixture.info.logPath}.report-only-news.json`;
    writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
    console.info(JSON.stringify({ logPath: fixture.info.logPath, evidencePath }));
    await fixture.close();
  }
}, 120_000);
