import { mkdtempSync, rmSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { handleInboxTriage, INBOX_TRIAGE_PATH, inboxToken } from "./inbox-route.ts";

const dataDir = mkdtempSync(join(tmpdir(), "inbox-"));
let server: Server;
let base = "";
let ready = true;
const choose = vi.fn();
const decider = { choose, score: vi.fn(), yesNo: vi.fn() } as any;
const bots = [{ id: "fin", name: "Financeiro", title: "Contas e cobranças" }, { id: "old", name: "Velho", hidden: true }];

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const json = (r: typeof res, status: number, value: unknown) => { r.writeHead(status, { "content-type": "application/json" }); r.end(JSON.stringify(value)); };
    const readBody = async (r: typeof req) => { let raw = ""; for await (const chunk of r) raw += chunk; return JSON.parse(raw); };
    if (!(await handleInboxTriage(req, res, new URL(req.url!, "http://x").pathname, { dataDir, ready: () => ready, decider, bots: () => bots, readBody, json }))) json(res, 404, {});
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", () => done()));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => { server.close(); rmSync(dataDir, { recursive: true, force: true }); });

const post = (body: unknown, token = inboxToken(dataDir)) => fetch(`${base}${INBOX_TRIAGE_PATH}`, {
  method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body),
});
const email = { from: "cliente@lumon.com", subject: "Fatura", text: "Reenviem a fatura de outubro" };
const choice = (choice: string, pTop: number) => ({ ok: true, provider: "jev", latencyMs: 1, answers: { type: "choice", choice, pTop, margin: 0.5, probabilities: { [choice]: pTop } } });

describe("inbox triage entry point", () => {
  it("makes its own token, private to the data folder", () => {
    const token = inboxToken(dataDir)!;
    expect(token.length).toBeGreaterThanOrEqual(32);
    expect(inboxToken(dataDir)).toBe(token);
    expect(statSync(join(dataDir, "inbox-token")).mode & 0o777).toBe(0o600);
  });

  it("refuses a missing or wrong token", async () => {
    expect((await post(email, null)).status).toBe(401);
    expect((await post(email, "x".repeat(43))).status).toBe(401);
  });

  it("refuses a body without a sender", async () => {
    expect((await post({ subject: "x" })).status).toBe(400);
  });

  it("answers a bot's job with the bot, never a hidden one", async () => {
    choose.mockResolvedValueOnce(choice("bot", 0.8)).mockResolvedValueOnce(choice("fin", 0.9));
    const res = await post(email);
    expect(await res.json()).toEqual({ ok: true, category: "bot", botId: "fin", botName: "Financeiro", confidence: 0.8, decidedBy: "jev" });
    expect(Object.keys(choose.mock.calls[1]![2].options)).not.toContain("old");
  });

  it("says off when the switch is off, unavailable when Jev fails", async () => {
    ready = false;
    expect(await (await post(email)).json()).toEqual({ ok: false, reason: "off" });
    ready = true;
    choose.mockResolvedValueOnce({ ok: false, reason: "timeout" });
    expect(await (await post(email)).json()).toEqual({ ok: false, reason: "unavailable" });
  });
});
