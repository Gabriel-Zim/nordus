import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlNordus, verificationServerArgs, verificationServerEnvironment } from "../scripts/control-nordus.ts";
import { waitForExit } from "./testing/cleanup.ts";

// The private second brain holds every client and the owner's own context. A conversation a member can read
// (Carol here) must never run with it, even on an internal bot; one only admins read keeps it.
it("keeps the second brain out of every bot a member can read, and in the bots only admins read", async () => {
  const fixture = await launchVerificationServer();
  const { dataDir, url, logPath } = fixture.info;
  let restarted: ChildProcess | undefined;
  const api = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${url}${path}`, {
      method, headers: { "content-type": "application/json", origin: url },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(5_000),
    });
    return { status: response.status, body: await response.json() as any };
  };
  try {
    const adminsOnly = (await api("POST", "/api/bots", { name: "Admins fixture" })).body.bot;
    const carols = (await api("POST", "/api/bots", { name: "Carol fixture" })).body.bot;
    const everyone = (await api("POST", "/api/bots", { name: "Everyone fixture" })).body.bot;
    for (const bot of [adminsOnly, carols, everyone]) expect((await api("PATCH", `/api/bots/${bot.id}`, { audience: "internal" })).status).toBe(200);
    expect((await api("PATCH", `/api/bots/${adminsOnly.id}`, { visibility: "admins" })).status).toBe(200);
    expect((await api("PATCH", `/api/bots/${carols.id}`, { visibility: { people: ["carol@nordus-lab.test"] } })).status).toBe(200);

    await waitForExit(fixture.child, { signal: "SIGTERM" });
    const configPath = join(dataDir, "config.json");
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    config.mcpServers = { "second-brain": { command: "node", args: ["brain-fixture.js"], enabled: true } };
    config.signIn = { admins: ["boss@nordus-lab.test"], members: ["carol@nordus-lab.test"] };
    writeFileSync(configPath, JSON.stringify(config));
    const env = verificationServerEnvironment(process.env, dataDir, Number(new URL(url).port));
    env.FAKE_CLAUDE_DUMP = fixture.fixtureDumpPath;
    const log = openSync(logPath, "a", 0o600);
    restarted = spawn(process.execPath, verificationServerArgs(env), {
      cwd: fileURLToPath(new URL("..", import.meta.url)), env, stdio: ["ignore", log, log],
    });
    closeSync(log);
    await expect.poll(async () => {
      try { return (await api("GET", "/api/bots")).status; } catch { return 0; }
    }, { timeout: 20_000 }).toBe(200);

    const turnFor = async (bot: { id: string; threadId: string }) => {
      rmSync(fixture.fixtureDumpPath, { force: true });
      expect((await api("POST", `/api/bots/${bot.id}/messages`, { text: "Brain fixture", threadId: bot.threadId })).status).toBeLessThan(300);
      await expect.poll(() => existsSync(fixture.fixtureDumpPath), { timeout: 15_000 }).toBe(true);
      const dump = JSON.parse(readFileSync(fixture.fixtureDumpPath, "utf8")) as { mcpConfig: { mcpServers?: Record<string, unknown> } | null; systemPrompt: string | null };
      expect((await runControlNordus(["wait", "--bot", bot.id, "--timeout", "30", "--url", url]) as { status: string }).status).toBe("settled");
      return { servers: Object.keys(dump.mcpConfig?.mcpServers ?? {}), prompt: dump.systemPrompt ?? "" };
    };

    const carolTurn = await turnFor(carols);
    expect(carolTurn.servers, "a bot Carol reads gets no second brain").not.toContain("second-brain");
    expect(carolTurn.prompt).not.toMatch(/second-brain|second brain/i);

    const everyoneTurn = await turnFor(everyone);
    expect(everyoneTurn.servers, "with members signed in, an everyone bot is one Carol reads").not.toContain("second-brain");
    expect(everyoneTurn.prompt).not.toMatch(/second-brain|second brain/i);

    const adminsTurn = await turnFor(adminsOnly);
    expect(adminsTurn.servers, "a bot only admins read keeps the second brain").toContain("second-brain");
  } finally {
    await waitForExit(restarted, { signal: "SIGTERM" });
    await fixture.close();
  }
}, 90_000);
