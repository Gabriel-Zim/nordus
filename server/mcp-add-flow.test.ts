import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConversationApprovals, type Decision } from "./conversation-approval.ts";
import { addMcpServerByConversation, mcpAddApproval, type McpAddDeps } from "./mcp-add-flow.ts";
import type { McpProbeResult } from "./mcp-probe.ts";

const REMOTE = { name: "notion", url: "https://mcp.notion.com/mcp" };

function harness(decision: Decision, probe: McpProbeResult = { ok: true, tools: [] }, current: Record<string, unknown> = {}) {
  const store = { servers: current };
  const calls = { persist: vi.fn(), probe: vi.fn(), signIn: vi.fn(), decide: vi.fn() };
  const deps: McpAddDeps = {
    current: () => store.servers,
    refusal: () => undefined,
    decide: async (call) => { calls.decide(call); return decision; },
    probe: async (server) => { calls.probe(server); return probe; },
    persist: (next) => { calls.persist(next); store.servers = next; },
    markNeedsSignIn: calls.signIn,
    acquire: () => () => {},
  };
  return { deps, calls, store };
}

describe("addMcpServerByConversation", () => {
  it("without a yes asks the question and saves and tests nothing", async () => {
    const { deps, calls } = harness({ kind: "ask", botText: "Pergunte." });
    expect(await addMcpServerByConversation(deps, REMOTE)).toEqual({ status: 200, body: { needsYes: true, question: "Pergunte." } });
    expect(calls.persist).not.toHaveBeenCalled();
    expect(calls.probe).not.toHaveBeenCalled();
  });

  it("with a yes and a connection that answers saves it already on", async () => {
    const { deps, calls } = harness({ kind: "pass", approval: { by: "Avery", answerId: "m1" } });
    expect(await addMcpServerByConversation(deps, REMOTE)).toEqual({ status: 201, body: { name: "notion", enabled: true, state: "connected" } });
    expect(calls.probe).toHaveBeenCalledOnce();
    expect(calls.persist.mock.calls[0]![0].notion).toMatchObject({ url: REMOTE.url, enabled: true });
    expect(calls.signIn).not.toHaveBeenCalled();
  });

  it("with a yes and a server that wants sign-in saves it on, waiting for the person", async () => {
    const { deps, calls } = harness({ kind: "pass" }, { ok: false, auth: "required", error: "x", kind: "http" });
    expect(await addMcpServerByConversation(deps, REMOTE)).toEqual({ status: 201, body: { name: "notion", enabled: true, state: "needs-sign-in" } });
    expect(calls.persist.mock.calls[0]![0].notion).toMatchObject({ enabled: true });
    expect(calls.signIn).toHaveBeenCalledWith("notion", REMOTE.url);
  });

  it("with a yes and a failed test saves nothing and says why in plain Portuguese", async () => {
    const { deps, calls } = harness({ kind: "pass" }, { ok: false, error: "Could not reach this address. Check the URL and your network.", kind: "unreachable" });
    const out = await addMcpServerByConversation(deps, REMOTE);
    expect(out.status).toBe(422);
    expect(out.body.error).toBe("Não conectei o app Notion. Não consegui falar com o app agora. Não salvei nada.");
    expect(calls.persist).not.toHaveBeenCalled();
  });

  it("on the card path saves it off as before and never tests it", async () => {
    const { deps, calls } = harness({ kind: "card" });
    expect(await addMcpServerByConversation(deps, REMOTE)).toEqual({ status: 201, body: { name: "notion", enabled: false, state: "off" } });
    expect(calls.persist.mock.calls[0]![0].notion).toMatchObject({ enabled: false });
    expect(calls.probe).not.toHaveBeenCalled();
  });

  it("keeps the managed policy, the repeated name and the switch refusal ahead of the question", async () => {
    const refused = harness({ kind: "pass" });
    refused.deps.refusal = () => "Sua organização não permite este app.";
    expect(await addMcpServerByConversation(refused.deps, REMOTE)).toEqual({ status: 403, body: { error: "Sua organização não permite este app.", code: "managed_policy" } });
    const repeated = harness({ kind: "pass" }, undefined, { notion: { url: "https://x.example/mcp", enabled: true } });
    expect((await addMcpServerByConversation(repeated.deps, REMOTE)).status).toBe(409);
    const switched = harness({ kind: "pass" });
    expect((await addMcpServerByConversation(switched.deps, { ...REMOTE, enabled: true })).status).toBe(400);
    for (const h of [refused, repeated, switched]) {
      expect(h.calls.decide).not.toHaveBeenCalled();
      expect(h.calls.persist).not.toHaveBeenCalled();
    }
  });

  it("does not save when another writer took the name during the test", async () => {
    const { deps, calls, store } = harness({ kind: "pass" });
    deps.probe = async () => { store.servers = { notion: { url: "https://other.example/mcp", enabled: false } }; return { ok: true, tools: [] }; };
    expect((await addMcpServerByConversation(deps, REMOTE)).status).toBe(409);
    expect(calls.persist).not.toHaveBeenCalled();
  });

  it("answers busy while another writer holds the lock, after the test", async () => {
    const { deps, calls } = harness({ kind: "pass" });
    deps.acquire = () => null;
    expect((await addMcpServerByConversation(deps, REMOTE)).status).toBe(409);
    expect(calls.persist).not.toHaveBeenCalled();
  });
});

describe("mcpAddApproval", () => {
  const parsed = (body: Record<string, unknown>) => {
    let captured: ReturnType<typeof mcpAddApproval> | undefined;
    return addMcpServerByConversation({ ...harness({ kind: "card" }).deps, decide: async (call) => { captured = call; return { kind: "card" }; } }, body).then(() => captured!);
  };

  it("shows the name and the short domain, never header values, and binds the rest by digest", async () => {
    const a = await parsed({ ...REMOTE, headers: { Authorization: "Bearer topsecret" } });
    expect(a).toMatchObject({ reason: "config", tool: "add_mcp_server", input: { name: "notion", host: "mcp.notion.com" } });
    expect(JSON.stringify(a)).not.toContain("topsecret");
    const sameWithOtherPath = await parsed({ name: "notion", url: "https://mcp.notion.com/other", headers: { Authorization: "Bearer topsecret" } });
    expect((sameWithOtherPath.input as { binding: string }).binding).not.toBe((a.input as { binding: string }).binding);
    expect(((a.input as { binding: string }).binding).length).toBeGreaterThan(80);
  });

  it("shows a local command without flags or secret-looking arguments", async () => {
    const a = await parsed({ name: "notes", command: "npx", args: ["-y", "notes-mcp", "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789"] });
    expect(a.input).toMatchObject({ name: "notes", command: "npx", args: ["notes-mcp"] });
  });
});

describe("with the real conversation approval", () => {
  let dir = "";
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("a first call asks, shows the name and domain to the bot, and saves nothing", async () => {
    dir = mkdtempSync(join(tmpdir(), "mcp-add-"));
    const approvals = new ConversationApprovals(join(dir, "a.json"), { available: () => true });
    const h = harness({ kind: "card" });
    h.deps.decide = (call) => approvals.decide({ ...call, threadId: "t1", botId: "b1" }, [], async () => false);
    const out = await addMcpServerByConversation(h.deps, REMOTE);
    expect(out.status).toBe(200);
    expect(out.body.needsYes).toBe(true);
    expect(out.body.question).toContain("notion");
    expect(out.body.question).toContain("mcp.notion.com");
    expect(h.calls.persist).not.toHaveBeenCalled();
    expect(h.calls.probe).not.toHaveBeenCalled();
  });
});
