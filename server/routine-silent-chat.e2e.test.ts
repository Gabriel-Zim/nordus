import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlNordus } from "../scripts/control-nordus.ts";

it.each([
  ["reportOnlyNews NADA_NOVO", true, "NADA_NOVO"],
  ["ordinary routine [SILENT]", false, "[SILENT]"],
])("leaves nothing in the robot's conversation for a routine with nothing new (%s)", async (_label, reportOnlyNews, reply) => {
  const fixture = await launchVerificationServer();
  const api = async (method: string, path: string, body?: unknown, status = 200) => {
    const response = await fetch(`${fixture.info.url}${path}`, {
      method, headers: { "content-type": "application/json", origin: fixture.info.url },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const value = await response.json() as any;
    expect(response.status, `${method} ${path}: ${JSON.stringify(value)}`).toBe(status);
    return value;
  };
  try {
    const wrapper = join(fixture.info.dataDir, "quiet-claude.mjs");
    writeFileSync(wrapper, [
      "#!/usr/bin/env node",
      `process.env.FAKE_CLAUDE_REPLIES = ${JSON.stringify(JSON.stringify([reply]))};`,
      `process.env.FAKE_CLAUDE_REPLY_STATE = ${JSON.stringify(join(fixture.info.dataDir, "reply-state"))};`,
      `await import(${JSON.stringify(pathToFileURL(join(process.cwd(), "server/testing/fake-claude-cli.ts")).href)});`,
    ].join("\n"), { mode: 0o700 });
    await api("PATCH", "/api/instances/claude", { cli: wrapper });
    await api("PATCH", "/api/config", { features: { routinesInConversation: true } });
    const { bot } = await runControlNordus(["new-bot", "--name", "Portal", "--url", fixture.info.url]) as any;
    const main = (await api("GET", "/api/bots")).bots.find((c: any) => c.id === bot.id).threadId as string;
    const { routine } = await api("POST", "/api/routines", {
      name: "Portal: ajustes do cliente", prompt: "Olhe o portal.", botId: bot.id, enabled: false,
      schedule: { type: "interval", everyMinutes: 10, anchorAt: Date.now() + 3_600_000 },
      ...(reportOnlyNews ? { reportOnlyNews: true } : {}),
    }, 201);
    const { run } = await api("POST", `/api/routines/${routine.id}/run`, undefined, 201);
    await expect.poll(async () => (await api("GET", "/api/routines")).runs.find((r: any) => r.id === run.id)?.status, { timeout: 20_000 }).toBe("completed");
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    const messages = (await api("GET", `/api/threads/${main}/messages?limit=200`)).messages as any[];
    expect(messages.filter((m) => m.kind === "routine.run" || /Sem novidade/.test(JSON.stringify(m)))).toEqual([]);
    expect((await api("GET", "/api/bots")).bots.find((c: any) => c.id === bot.id).tasks.find((t: any) => t.threadId === main).unread).not.toBe(true);
  } finally {
    await fixture.close();
  }
}, 120_000);
