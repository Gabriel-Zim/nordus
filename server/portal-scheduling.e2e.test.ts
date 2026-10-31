import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SessionRegistry } from "./sessions.ts";
import { removeTempDir, waitForExit } from "./testing/cleanup.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const FAKE_CLI = join(SERVER_DIR, "testing", "fake-acp-cli.ts");
const HOOK = join(SERVER_DIR, "hooks", "critical-hook.ts");
const PORT = 28800 + Math.floor(Math.random() * 10_000);
const BASE = `http://127.0.0.1:${PORT}`;
const CAPABILITY_KEY = "portal-scheduling-fixture-capability";
const AVERY = "avery@zorg.test";
const FABRIKAM_BLOG = "7390882";
const LUMON_BLOG = "7404832";
const FABRIKAM_AGENT = "c7f2fe43-24fc-4494-ac16-003feec0ddc1";
const LEGENDA = "Todo investimento imobiliário começa em um terreno.";
const posixOnly = describe.skipIf(process.platform === "win32");

let child: ChildProcess;
let home: string;
let log = "";
let token = "";
const bots = { fabrikam: { id: "", threadId: "" }, outro: { id: "", threadId: "" } };

const api = async (method: string, path: string, body?: unknown) => {
  const res = await fetch(`${BASE}${path}`, {
    method, headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) as any };
};

async function start() {
  log = "";
  child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
    cwd: join(SERVER_DIR, ".."),
    env: { PATH: process.env.PATH ?? "", HOME: home, USERPROFILE: home, NORDUS_PORT: String(PORT), NORDUS_WEBHOOK_PORT: String(PORT + 1), NORDUS_TEST_INTERNAL_CAPABILITY_KEY: CAPABILITY_KEY },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout!.on("data", (c) => (log += c));
  child.stderr!.on("data", (c) => (log += c));
  const deadline = Date.now() + 20_000;
  for (;;) {
    if ((await fetch(`${BASE}/api/health`).catch(() => null))?.ok) return;
    if (Date.now() > deadline) throw new Error(`server never came up:\n${log}`);
    await new Promise((r) => setTimeout(r, 150));
  }
}

async function hook(bot: { id: string; threadId: string }, input: Record<string, unknown>) {
  const minted = await fetch(`${BASE}/api/testing/internal-capability`, {
    method: "POST", headers: { "content-type": "application/json", "x-nordus-test-capability": CAPABILITY_KEY },
    body: JSON.stringify({ botId: bot.id, threadId: bot.threadId, kind: "hooks" }),
  });
  const tokenFile = join(home, "hook-token");
  writeFileSync(tokenFile, ((await minted.json()) as { token: string }).token);
  const out = await new Promise<string>((resolve) => {
    const run = spawn(process.execPath, [HOOK], { env: { PATH: process.env.PATH ?? "", NORDUS_HOOK_URL: BASE, NORDUS_HOOK_TOKEN_FILE: tokenFile }, stdio: ["pipe", "pipe", "ignore"] });
    let text = ""; run.stdout.on("data", (chunk) => { text += chunk; });
    run.on("close", () => resolve(text));
    run.stdin.end(JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "mcp__metricool__createScheduledPost", tool_input: input }));
  });
  if (!out) return { ran: true };
  const { permissionDecision, permissionDecisionReason } = JSON.parse(out).hookSpecificOutput;
  return { ran: false, decision: permissionDecision as string, reason: permissionDecisionReason as string };
}

const post = (blogId: string, date = "2026-12-20T10:00:00-03:00", media = ["https://portal.example.com/m/ab12/f1-terreno.jpg"]) => ({
  blogId, date, info: JSON.stringify({ autoPublish: true, draft: false, text: LEGENDA, media }),
});

posixOnly("a social media bot schedules what the portal approved and released, end to end", () => {
  beforeAll(async () => {
    chmodSync(FAKE_CLI, 0o755);
    home = mkdtempSync(join(tmpdir(), "nordus-portal-scheduling-"));
    const data = join(home, ".nordus");
    mkdirSync(data, { recursive: true });
    const portal = join(home, "portal-agendamentos");
    writeFileSync(portal, `#!${process.execPath}\nconst [verbo, agente] = process.argv.slice(2);\n` +
      `const item = { item: "it-1", agendar_para: "2026-12-20T10:00", legenda: ${JSON.stringify(LEGENDA)}, arquivos: [{ arquivo: "f1-terreno.jpg", nome: "terreno.jpg" }] };\n` +
      `process.stdout.write(JSON.stringify({ agent_id: agente, pendentes: verbo === "pendentes" && agente === ${JSON.stringify(FABRIKAM_AGENT)} ? [item] : [] }));\n`);
    chmodSync(portal, 0o755);
    const config = {
      signIn: { admins: [AVERY], members: [] },
      instances: { grok: { driver: "grokAgent", config: { cli: FAKE_CLI, fullAuto: false } } },
    };
    writeFileSync(join(data, "config.json"), JSON.stringify(config));
    const registry = new SessionRegistry({ file: join(data, "sessions.json"), emailScopes: () => ["admin", "client"] });
    token = registry.issue({ label: "avery", email: AVERY, scopes: ["admin", "client"] }).token;
    registry.close();
    await start();
    for (const name of ["fabrikam", "outro"] as const) {
      const created = await api("POST", "/api/bots", { name: name === "fabrikam" ? "FABRIKAM" : "Portal" });
      Object.assign(bots[name], { id: created.body.bot.id, threadId: created.body.bot.threadId });
      await api("PATCH", `/api/bots/${created.body.bot.id}`, { modelSelection: { instanceId: "grok", model: "fake-model" } });
      await api("POST", `/api/bots/${created.body.bot.id}/messages`, { text: "agenda o que o portal liberou", threadId: created.body.bot.threadId });
    }
    child.kill("SIGTERM");
    await waitForExit(child);
    const saved = JSON.parse(readFileSync(join(data, "config.json"), "utf8"));
    saved.portalScheduling = { command: portal, grants: [{ botId: bots.fabrikam.id, blogId: FABRIKAM_BLOG, agentId: FABRIKAM_AGENT }] };
    writeFileSync(join(data, "config.json"), JSON.stringify(saved));
    await start();
  }, 90_000);

  afterAll(async () => {
    child?.kill("SIGTERM");
    if (child) await waitForExit(child);
    if (home) removeTempDir(home);
  });

  it("the client's bot schedules an approved, released item on its own brand without asking, once", async () => {
    expect(await hook(bots.fabrikam, post(FABRIKAM_BLOG))).toEqual({ ran: true });
    const { body } = await api("GET", `/api/threads/${bots.fabrikam.threadId}/messages`);
    expect(body.messages.some((m: any) => m.tool?.name === "Agendado sem perguntar: item it-1 aprovado pelo cliente e liberado no portal")).toBe(true);
    expect((await hook(bots.fabrikam, post(FABRIKAM_BLOG))).ran, "the same item never schedules twice").toBe(false);
  });

  it("another brand, another date, another bot: the bot asks in the conversation", async () => {
    for (const [bot, input] of [
      [bots.fabrikam, post(LUMON_BLOG)],
      [bots.fabrikam, post(FABRIKAM_BLOG, "2026-12-20T11:00:00-03:00")],
      [bots.outro, post(FABRIKAM_BLOG)],
    ] as const) {
      const out = await hook(bot, input);
      expect(out, JSON.stringify(input)).toMatchObject({ ran: false, decision: "deny" });
      expect(out.reason).toContain("precisa do sim de um administrador");
    }
  });
});
