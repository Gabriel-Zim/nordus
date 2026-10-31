import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const HOOK = join(import.meta.dirname, "critical-hook.ts");
const dir = mkdtempSync(join(tmpdir(), "crit-"));
const tokenFile = join(dir, "token");
writeFileSync(tokenFile, "tok");
let server: Server;
let url = "";
let answer: unknown = { critical: false };
let delayMs = 0;
let calls: Array<{ auth?: string; body: any }> = [];

beforeAll(async () => {
  server = createServer(async (req, res) => {
    let raw = ""; for await (const chunk of req) raw += chunk;
    calls.push({ auth: req.headers.authorization, body: JSON.parse(raw) });
    if (delayMs) await new Promise((done) => setTimeout(done, delayMs));
    res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(answer));
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", () => done()));
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => { server.close(); rmSync(dir, { recursive: true, force: true }); });

function run(tool: string, command?: string, env: Record<string, string> = { NORDUS_HOOK_URL: url, NORDUS_HOOK_TOKEN_FILE: tokenFile }, input?: Record<string, unknown>): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [HOOK], { env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "ignore"] });
    let out = ""; child.stdout.on("data", (chunk) => { out += chunk; });
    child.on("close", () => resolve(out));
    child.stdin.end(JSON.stringify({ hook_event_name: "PreToolUse", tool_name: tool, tool_input: input ?? (command ? { command } : {}) }));
  });
}
const hookEnv = () => ({ NORDUS_HOOK_URL: url, NORDUS_HOOK_TOKEN_FILE: tokenFile });

describe("critical-action hook with the decision model", () => {
  it("a settings change Jev calls routine goes ahead", async () => {
    answer = { critical: false }; calls = [];
    expect(await run("Bash", "systemctl restart my-preview")).toBe("");
    expect(calls[0]).toMatchObject({ auth: "Bearer tok", body: { reason: "config", tool: "Bash", command: "systemctl restart my-preview" } });
  });

  it("Jev saying critical, or no answer, asks the person", async () => {
    answer = { critical: true };
    expect(await run("Bash", "sudo ufw disable")).toContain('"permissionDecision":"ask"');
    expect(await run("Bash", "git push origin main", {})).toContain('"permissionDecision":"ask"');
  });

  it("deleting for good asks the server too, which decides how the person is asked", async () => {
    answer = { critical: true, conversation: "Pergunte antes de apagar." }; calls = [];
    const out = await run("Bash", "rm -rf /etc/x");
    expect(out).toContain('"permissionDecision":"deny"');
    expect(out).toContain("Pergunte antes de apagar.");
    expect(calls[0]).toMatchObject({ body: { reason: "delete", tool: "Bash", command: "rm -rf /etc/x" } });
  });

  it("the server's conversation text reaches the bot as the reason the tool did not run", async () => {
    answer = { critical: true, conversation: "Não rodou: pergunte na conversa se pode mandar para fulano@cliente.com." };
    const out = JSON.parse(await run("mcp__financeiro__send_invoice", undefined, hookEnv(), { para: "fulano@cliente.com" }));
    expect(out.hookSpecificOutput).toEqual({
      hookEventName: "PreToolUse", permissionDecision: "deny",
      permissionDecisionReason: "Não rodou: pergunte na conversa se pode mandar para fulano@cliente.com.",
    });
  });

  it("an empty or oversized conversation text falls back to the card", async () => {
    for (const conversation of ["", " ", "x".repeat(2_001), 42]) {
      answer = { critical: true, conversation };
      expect(await run("Bash", "git push origin main"), JSON.stringify(conversation)).toContain('"permissionDecision":"ask"');
    }
  });

  it("waits long enough for the server to read the portal (about 1.4 s there), and asks when it takes too long", async () => {
    answer = { critical: false };
    delayMs = 2_500;
    expect(await run("mcp__metricool__createScheduledPost", undefined, hookEnv(), { blogId: "7390882" })).toBe("");
    delayMs = 3_600;
    expect(await run("mcp__metricool__createScheduledPost", undefined, hookEnv(), { blogId: "7390882" })).toContain('"permissionDecision":"ask"');
    delayMs = 0;
  }, 15_000);

  it("sends the whole input, and says when it could not", async () => {
    answer = { critical: false }; calls = [];
    const invoice = { para: "fulano@cliente.com", valor: 2000, corpo: "a".repeat(5_000) };
    expect(await run("mcp__financeiro__send_invoice", undefined, hookEnv(), invoice)).toBe("");
    expect(calls[0]!.body).toMatchObject({ reason: "send", inputComplete: true });
    expect(JSON.parse(calls[0]!.body.input)).toEqual(invoice);
    calls = [];
    await run("mcp__financeiro__send_invoice", undefined, hookEnv(), { corpo: "a".repeat(200_001) });
    expect(calls[0]!.body.inputComplete).toBe(false);
  });

  it("after the person said no several times in a row, the hook stops the bot instead of asking", async () => {
    answer = { critical: true, stop: true };
    const out = await run("Bash", "git push origin main");
    expect(out).toContain('"permissionDecision":"deny"');
    expect(out).toContain("Parei");
  });

  it("a harmless command passes without a call", async () => {
    calls = [];
    expect(await run("Bash", "ls -la")).toBe("");
    expect(calls).toHaveLength(0);
  });
});
