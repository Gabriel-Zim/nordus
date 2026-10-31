import { afterEach, describe, expect, it, vi } from "vitest";

import type { AppConfig } from "../config.ts";
import { checkOutboundLeak, outboundLeakRefusal, outgoingText, shouldCheckOutbound } from "./outbound-leak.ts";
import { createDecider, deciderJobOn, deciderReady } from "./index.ts";

const ACCOUNT = "0123456789abcdef0123456789abcdef";
const ON: AppConfig = { decider: { enabled: true, provider: "clef" } };
const wrapped = (answers: unknown) => ({ result: { model: "clef", answers, usage: { input_tokens: 10, output_tokens: 0 } }, success: true, errors: [], messages: [] });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const leakAnswers = (p: number, kind: string) => wrapped({
  leak: { type: "noul", noul: p },
  kind: { type: "choice", choice: kind, probabilities: { other_client: 0.9, internal_data: 0.05, secret: 0.05 }, confidence: 0.9 },
});

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

function fakeClef(fetchImpl: ReturnType<typeof vi.fn<typeof fetch>>, config: AppConfig = ON) {
  vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", ACCOUNT);
  vi.stubEnv("CLOUDFLARE_AI_TOKEN", "cf_unit_secret_token_0123456789");
  return createDecider({ config: () => config, fetch: fetchImpl as unknown as typeof fetch });
}

const mail = JSON.stringify({ to: "cliente@example.com", subject: "Orçamento", body: "Olá! O mesmo pacote que fizemos para a Padaria Aurora custa R$ 900." });

describe("outbound leak gate", () => {
  it("blocks a text that names another client when CLEF says leak", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json(leakAnswers(0.97, "other_client")));
    const verdict = await checkOutboundLeak(fakeClef(fetchImpl), { text: outgoingText(mail), servesClient: "Barbearia Vale", otherClients: ["Padaria Aurora"] });
    expect(verdict).toMatchObject({ leak: true, kind: "other_client" });
    // CLEF is given the client names and the text to read.
    const sent = JSON.stringify(JSON.parse(String(fetchImpl.mock.calls[0]![1]!.body)));
    expect(sent).toContain("Padaria Aurora");
    expect(outboundLeakRefusal(verdict as never)).toContain("Not sent: it names another client");
  });

  it("lets it through when CLEF is unsure, fails, times out or the job is off", async () => {
    const unsure = fakeClef(vi.fn<typeof fetch>().mockResolvedValue(json(leakAnswers(0.4, "other_client"))));
    expect(await checkOutboundLeak(unsure, { text: "x Padaria Aurora", otherClients: ["Padaria Aurora"] })).toEqual({ leak: false });
    const failures: string[] = [];
    const broken = fakeClef(vi.fn<typeof fetch>().mockResolvedValue(json({ error: "boom" }, 500)));
    expect(await checkOutboundLeak(broken, { text: "x Padaria Aurora", otherClients: ["Padaria Aurora"], onFailure: (why) => failures.push(why) })).toEqual({ leak: false });
    expect(failures).toHaveLength(1);
    const throwing = fakeClef(vi.fn<typeof fetch>().mockRejectedValue(new Error("network down")));
    expect(await checkOutboundLeak(throwing, { text: "x", otherClients: [] })).toEqual({ leak: false });
    const off: AppConfig = { decider: { enabled: true, provider: "clef", jobs: { outboundLeak: false } } };
    const fetchOff = vi.fn<typeof fetch>();
    expect(await checkOutboundLeak(fakeClef(fetchOff, off), { text: "x Padaria Aurora", otherClients: ["Padaria Aurora"] })).toEqual({ leak: false });
    expect(fetchOff).not.toHaveBeenCalled();
    expect(await checkOutboundLeak({ ask: async () => { throw new Error("x"); } }, { text: "hello", otherClients: [] })).toEqual({ leak: false });
  });

  it("is on by default and switched off with decider.jobs.outboundLeak", () => {
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", ACCOUNT);
    vi.stubEnv("CLOUDFLARE_AI_TOKEN", "cf_unit_secret_token_0123456789");
    expect(deciderJobOn(ON, "outboundLeak")).toBe(true);
    expect(deciderReady(ON, "outboundLeak")).toBe(true);
    expect(deciderReady({ decider: { enabled: true, provider: "clef", jobs: { outboundLeak: false } } }, "outboundLeak")).toBe(false);
  });

  it("only runs for an outside bot's outbound send", () => {
    expect(shouldCheckOutbound({ reason: "send", internal: false, ready: true })).toBe(true);
    expect(shouldCheckOutbound({ reason: "send", internal: true, ready: true })).toBe(false);
    expect(shouldCheckOutbound({ reason: "spend", internal: false, ready: true })).toBe(false);
    expect(shouldCheckOutbound({ reason: "send", internal: false, ready: false })).toBe(false);
  });

  it("reads the strings of a tool call's input, or the raw text", () => {
    expect(outgoingText(mail)).toContain("Padaria Aurora");
    expect(outgoingText("not json at all")).toBe("not json at all");
    expect(outgoingText(undefined)).toBe("");
  });
});
