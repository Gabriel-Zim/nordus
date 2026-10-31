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
const CAPABILITY_KEY = "conversation-approval-fixture-capability";
const AVERY = "avery@zorg.test";
const JORDAN = "jordan@zorg.test";
const RONNY = "ronny@zorg.test";
const INVOICE = { cliente: "LUMON", para: "fulano@cliente.test", valor: 2000, descricao: "Invoice de outubro" };
const QUESTION = "Vou mandar a invoice da LUMON de US$ 2.000 para fulano@cliente.test. Posso?";
const posixOnly = describe.skipIf(process.platform === "win32");

let child: ChildProcess;
let home: string;
let replyFile: string;
let log = "";
const tokens: Record<string, string> = {};
const bot = { id: "", threadId: "" };

const api = async (method: string, path: string, body?: unknown, as?: string) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(as ? { authorization: `Bearer ${tokens[as]}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) as any };
};

async function waitFor<T>(read: () => Promise<T | null | undefined>, ms = 20_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out\n${log.slice(-3_000)}`);
    await new Promise((r) => setTimeout(r, 150));
  }
}

const messages = async () => (await api("GET", `/api/threads/${bot.threadId}/messages`, undefined, AVERY)).body.messages as Array<{ id: string; role: string; kind: string; text?: string; tool?: { name: string } }>;

/** Someone writes in the bot's conversation; the fixture bot answers with whatever the reply file holds. */
async function say(as: string | undefined, text: string, botAnswers: string): Promise<number> {
  writeFileSync(replyFile, botAnswers);
  const before = (await messages()).length;
  const sent = await api("POST", `/api/bots/${bot.id}/messages`, { text, threadId: bot.threadId }, as);
  if (sent.status !== 202) return sent.status;
  await waitFor(async () => {
    const now = await messages();
    return now.length > before && now.slice(before).some((m) => m.role === "bot" && m.kind === "text" && m.text === botAnswers);
  });
  return sent.status;
}

/** Runs the real hook process, exactly as Claude Code would, with this turn's hook capability. */
async function hook(tool: string, input: Record<string, unknown>): Promise<{ ran: boolean; decision?: string; reason?: string }> {
  const minted = await fetch(`${BASE}/api/testing/internal-capability`, {
    method: "POST", headers: { "content-type": "application/json", "x-nordus-test-capability": CAPABILITY_KEY },
    body: JSON.stringify({ botId: bot.id, threadId: bot.threadId, kind: "hooks" }),
  });
  expect(minted.status).toBe(201);
  const tokenFile = join(home, "hook-token");
  writeFileSync(tokenFile, ((await minted.json()) as { token: string }).token);
  const out = await new Promise<string>((resolve) => {
    const run = spawn(process.execPath, [HOOK], { env: { PATH: process.env.PATH ?? "", NORDUS_HOOK_URL: BASE, NORDUS_HOOK_TOKEN_FILE: tokenFile }, stdio: ["pipe", "pipe", "ignore"] });
    let text = ""; run.stdout.on("data", (chunk) => { text += chunk; });
    run.on("close", () => resolve(text));
    run.stdin.end(JSON.stringify({ hook_event_name: "PreToolUse", tool_name: tool, tool_input: input }));
  });
  if (!out) return { ran: true };
  const { permissionDecision, permissionDecisionReason } = JSON.parse(out).hookSpecificOutput;
  return { ran: false, decision: permissionDecision, reason: permissionDecisionReason };
}
const sendInvoice = (input: Record<string, unknown> = INVOICE) => hook("mcp__financeiro__send_invoice", input);

posixOnly("critical actions approved in the conversation, end to end", () => {
  beforeAll(async () => {
    chmodSync(FAKE_CLI, 0o755);
    home = mkdtempSync(join(tmpdir(), "nordus-conversation-approval-"));
    replyFile = join(home, "bot-reply.txt");
    writeFileSync(replyFile, "Anotado.");
    const data = join(home, ".nordus");
    mkdirSync(data, { recursive: true });
    writeFileSync(join(data, "config.json"), JSON.stringify({
      signIn: { admins: [AVERY, JORDAN], members: [RONNY] },
      safetyFloor: { enabled: true },
      instances: { grok: { driver: "grokAgent", environment: { FAKE_ACP_TEXT_REPLY_FILE: replyFile }, config: { cli: FAKE_CLI, fullAuto: false } } },
    }));
    const role = (email: string) => (email === RONNY ? ["client"] as const : ["admin", "client"] as const);
    const registry = new SessionRegistry({ file: join(data, "sessions.json"), emailScopes: (email) => [...role(email)] });
    for (const email of [AVERY, JORDAN, RONNY]) tokens[email] = registry.issue({ label: `${email.split("@")[0]}'s phone`, email, scopes: [...role(email)] }).token;
    registry.close();
    child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
      cwd: join(SERVER_DIR, ".."),
      env: { PATH: process.env.PATH ?? "", HOME: home, USERPROFILE: home, NORDUS_PORT: String(PORT), NORDUS_WEBHOOK_PORT: String(PORT + 1), NORDUS_TEST_INTERNAL_CAPABILITY_KEY: CAPABILITY_KEY },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout!.on("data", (c) => (log += c));
    child.stderr!.on("data", (c) => (log += c));
    await waitFor(async () => (await fetch(`${BASE}/api/health`).catch(() => null))?.ok);
    const created = await api("POST", "/api/bots", { name: "AssistenteFinanceiro Teste", visibility: { people: [RONNY] } }, AVERY);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    Object.assign(bot, { id: created.body.bot.id, threadId: created.body.bot.threadId });
    expect((await api("PATCH", `/api/bots/${bot.id}`, { modelSelection: { instanceId: "grok", model: "fake-model" } }, AVERY)).status).toBe(200);
  }, 60_000);

  afterAll(async () => {
    child?.kill("SIGTERM");
    if (child) await waitForExit(child);
    if (home) removeTempDir(home);
  });

  it("holds the action until an admin's yes, and only for the exact parameters asked about", async () => {
    await say(AVERY, "manda a invoice da LUMON pro fulano", "Anotado.");

    const first = await sendInvoice();
    expect(first).toMatchObject({ ran: false, decision: "deny" });
    expect(first.reason).toContain("fulano@cliente.test");
    expect(first.reason).toContain("2.000");

    await say(RONNY, "oi", QUESTION);
    const noReply = await sendInvoice();
    expect(noReply, "no human reply after the question").toMatchObject({ ran: false, decision: "deny" });
    expect(noReply.reason).toContain("ainda não há resposta");

    const loopback = await say(undefined, "pode", "pode");
    expect([202, 401, 403]).toContain(loopback);
    expect(await sendInvoice(), "a bot's own \"pode\" and an unsigned local caller").toMatchObject({ ran: false, decision: "deny" });

    await say(RONNY, "pode", "Anotado.");
    const byMember = await sendInvoice();
    expect(byMember, "a member's \"pode\"").toMatchObject({ ran: false, decision: "deny" });
    expect(byMember.reason).toContain("não pode liberar");

    await say(AVERY, "pode", "Anotado.");
    const changed = await sendInvoice({ ...INVOICE, para: "outro@golpe.test" });
    expect(changed, "parameters changed after the yes").toMatchObject({ ran: false, decision: "deny" });
    expect(changed.reason).toContain("outro@golpe.test");
  });

  it("the never-list reads the whole command, however long, and never turns it into a question", async () => {
    expect(await hook("Bash", { command: `echo ${"a".repeat(4_100)}; sudo rm -rf /` })).toMatchObject({ ran: false, decision: "ask" });
  });

  it("an admin's yes frees exactly the action asked about, once, and the chat records it", async () => {
    expect(await sendInvoice(), "Avery's pode, for the parameters he was asked about").toEqual({ ran: true });
    expect(await sendInvoice(), "the same yes never runs a second action").toMatchObject({ ran: false, decision: "deny" });
    await say(RONNY, "e aí?", QUESTION);
    await say(JORDAN, "manda", "Anotado.");
    expect(await sendInvoice(), "Jordan, an admin, said manda").toEqual({ ran: true });
    expect(await sendInvoice()).toMatchObject({ ran: false, decision: "deny" });
    const freed = (await messages()).filter((m) => m.kind === "activity" && m.tool?.name === "Liberado na conversa: pagamento no Financeiro");
    expect(freed).toHaveLength(2);
    const saved = JSON.parse(readFileSync(join(home, ".nordus", "conversation-approvals.json"), "utf8")) as { proposals: Array<{ consumed?: { by: string } }> };
    expect(saved.proposals.filter((p) => p.consumed).map((p) => p.consumed!.by)).toEqual([AVERY, JORDAN]);
  });
});
