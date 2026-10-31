import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlNordus, verificationServerArgs, verificationServerEnvironment } from "../scripts/control-nordus.ts";
import { KeyVault } from "./key-vault.ts";
import { OAuthAppStore } from "./oauth-apps.ts";
import { waitForExit } from "./testing/cleanup.ts";

// The rule under test: a client's bot sees only its own client. This machine's Claude Code MCP setup (claude.ai
// connectors such as Gmail, Drive and Calendar arrive through it) and the accounts connected for every bot reach
// internal bots only; the skills reach every bot, a client's bot with only its own brand.
it("never hands a client's bot this machine's Claude Code connectors, ZORG's own accounts or another client's brand, while internal bots keep them", async () => {
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
    const internal = (await api("POST", "/api/bots", { name: "Internal fixture" })).body.bot;
    const client = (await api("POST", "/api/bots", { name: "Client fixture" })).body.bot;
    const marked = await api("PATCH", `/api/bots/${internal.id}`, { audience: "internal" });
    expect(marked.status).toBe(200);
    expect(marked.body.bot.audience).toBe("internal");
    expect((await api("PATCH", `/api/bots/${client.id}`, { audience: "everyone" })).status).toBe(400);
    expect((await api("PATCH", `/api/bots/${client.id}`, { client: "../fabrikam" })).status).toBe(400);
    expect((await api("PATCH", `/api/bots/${client.id}`, { client: "evergreen" })).body.bot.client).toBe("evergreen");

    await waitForExit(fixture.child, { signal: "SIGTERM" });
    const configPath = join(dataDir, "config.json");
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    config.features = { ...config.features, claudeUserMcp: true, claudeUserSkills: true };
    config.mcpServers = { "second-brain": { command: "node", args: ["brain-fixture.js"], enabled: true }, trello: { command: "node", args: ["trello-fixture.js"], enabled: true } };
    writeFileSync(configPath, JSON.stringify(config));
    const accounts = new OAuthAppStore(dataDir);
    accounts.set("google", "google-client", "google-secret");
    accounts.addAccount("google", { access: "google-token", account: "member@example.com", connectedAt: 1 });
    accounts.addAccount("google", { access: "google-token-2", account: "admin@example.com", connectedAt: 2 });
    accounts.set("github", "github-client", "github-secret");
    accounts.addAccount("github", { access: "github-token", account: "zorgcontent", connectedAt: 3 });
    new KeyVault(dataDir).addAccount("figma", { token: "figma-token" }, "member@example.com");
    const env = verificationServerEnvironment(process.env, dataDir, Number(new URL(url).port));
    env.FAKE_CLAUDE_DUMP = fixture.fixtureDumpPath;
    for (const brand of ["evergreen", "fabrikam"]) mkdirSync(join(env.HOME ?? dataDir, ".claude", "skills", "design-premium", "marcas", brand), { recursive: true });
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
      expect((await api("POST", `/api/bots/${bot.id}/messages`, { text: "Isolation fixture", threadId: bot.threadId })).status).toBeLessThan(300);
      await expect.poll(() => existsSync(fixture.fixtureDumpPath), { timeout: 15_000 }).toBe(true);
      const dump = JSON.parse(readFileSync(fixture.fixtureDumpPath, "utf8")) as { argv: string[]; mcpConfig: { mcpServers?: Record<string, unknown> } | null; systemPrompt: string | null };
      expect((await runControlNordus(["wait", "--bot", bot.id, "--timeout", "30", "--url", url]) as { status: string }).status).toBe("settled");
      return { argv: dump.argv, servers: Object.keys(dump.mcpConfig?.mcpServers ?? {}), mcp: JSON.stringify(dump.mcpConfig ?? {}), prompt: dump.systemPrompt ?? "" };
    };

    const clientTurn = await turnFor(client);
    expect(clientTurn.argv, "claude.ai connectors and user-scope MCP servers stay out").toContain("--strict-mcp-config");
    const skillsDir = clientTurn.argv[clientTurn.argv.indexOf("--add-dir") + 1]!;
    expect(skillsDir, "a client's bot gets the skills through its own view").toContain(join("claude-client-skills", "evergreen"));
    expect(readdirSync(join(skillsDir, ".claude", "skills", "design-premium", "marcas")), "only its own brand").toEqual(["evergreen"]);
    expect(clientTurn.servers.filter((name) => /^(google|github|figma|second-brain)/.test(name))).toEqual([]);
    expect(clientTurn.mcp).not.toMatch(/google-token|github-token|figma-token|zorgcontent/);
    expect(clientTurn.prompt).not.toMatch(/zorgcontent|second-brain/);
    expect(clientTurn.servers, "ZORG's own connections stay out of a client's bot without a list").not.toContain("trello");
    expect(clientTurn.prompt).not.toMatch(/trello/i);

    expect((await api("PATCH", `/api/bots/${client.id}`, { mcpServers: ["trello"] })).status).toBe(200);
    expect((await turnFor(client)).servers, "a client's bot gets a connection its own list names").toContain("trello");
    expect((await api("PATCH", `/api/bots/${client.id}`, { mcpServers: null })).status).toBe(200);
    const clearedTurn = await turnFor(client);
    expect(clearedTurn.servers, "clearing a client's list leaves it with none of ZORG's connections").not.toContain("trello");
    expect(clearedTurn.prompt).not.toMatch(/trello/i);

    const internalTurn = await turnFor(internal);
    expect(internalTurn.argv, "an internal bot still inherits this machine's Claude Code MCP servers").not.toContain("--strict-mcp-config");
    expect(internalTurn.argv.join(" ")).toContain("claude-user-skills");
    expect(internalTurn.servers).toEqual(expect.arrayContaining(["google-member-example-com", "google-admin-example-com", "github", "figma", "second-brain", "trello"]));
  } finally {
    await waitForExit(restarted, { signal: "SIGTERM" });
    await fixture.close();
  }
}, 60_000);
