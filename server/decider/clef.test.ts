import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { AppConfig } from "../config.ts";
import { clefCredentials, clefEndpoint, parseEnvFile, unwrapClefBody } from "./clef.ts";
import { createDecider, deciderReady, deciderSavePatch, describeDecider } from "./index.ts";

const ACCOUNT = "0123456789abcdef0123456789abcdef";
const TOKEN = "cf_unit_secret_token_0123456789";
const ON: AppConfig = { decider: { enabled: true, provider: "clef" } };
const ENDPOINT = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/run/@cf/cloudflare/clef`;

type FetchMock = ReturnType<typeof vi.fn<typeof fetch>>;

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
/** What Cloudflare's REST API sends back: the model's answer under `result`. */
const wrapped = (answers: unknown) => ({ result: { model: "clef", answers, usage: { input_tokens: 41, output_tokens: 0 } }, success: true, errors: [], messages: [] });

function decider(config: AppConfig, fetchImpl: FetchMock) {
  return createDecider({ config: () => config, fetch: fetchImpl as unknown as typeof fetch });
}

function withCredentials() {
  vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", ACCOUNT);
  vi.stubEnv("CLOUDFLARE_AI_TOKEN", TOKEN);
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("CLEF credentials", () => {
  it("come from the environment", () => {
    expect(clefCredentials(undefined, { CLOUDFLARE_ACCOUNT_ID: ACCOUNT, CLOUDFLARE_AI_TOKEN: TOKEN })).toEqual({ accountId: ACCOUNT, token: TOKEN });
  });

  it("else from the configured env file, quotes and export allowed", () => {
    const dir = mkdtempSync(join(tmpdir(), "clef-env-"));
    const file = join(dir, "cloudflare-ai.env");
    writeFileSync(file, `# segredo\nexport CLOUDFLARE_ACCOUNT_ID="${ACCOUNT}"\nCLOUDFLARE_AI_TOKEN='${TOKEN}'\n`);
    expect(clefCredentials(file, {})).toEqual({ accountId: ACCOUNT, token: TOKEN });
    expect(clefCredentials(undefined, { NORDUS_CLEF_ENV_FILE: file })).toEqual({ accountId: ACCOUNT, token: TOKEN });
  });

  it("are null when one is missing, the file is absent, or the account id is not one", () => {
    expect(clefCredentials(undefined, { CLOUDFLARE_ACCOUNT_ID: ACCOUNT })).toBeNull();
    expect(clefCredentials("/no/such/file.env", {})).toBeNull();
    expect(clefCredentials(undefined, { CLOUDFLARE_ACCOUNT_ID: "../../evil", CLOUDFLARE_AI_TOKEN: TOKEN })).toBeNull();
  });

  it("parses KEY=VALUE lines and skips the rest", () => {
    expect(parseEnvFile("A=1\n  # x\nB = \"two\" \nnot a line\nC=3 # note\n")).toEqual({ A: "1", B: "two", C: "3" });
  });
});

describe("CLEF endpoint", () => {
  it("is Cloudflare's run URL for the model, https only (http only to this machine)", () => {
    expect(String(clefEndpoint(ACCOUNT))).toBe(ENDPOINT);
    expect(String(clefEndpoint(ACCOUNT, "clef-flash"))).toContain("/ai/run/@cf/cloudflare/clef-flash");
    expect(clefEndpoint(ACCOUNT, "clef", "http://example.com/v4")).toBeNull();
    expect(String(clefEndpoint(ACCOUNT, "clef", "http://127.0.0.1:8787"))).toBe(`http://127.0.0.1:8787/accounts/${ACCOUNT}/ai/run/@cf/cloudflare/clef`);
    expect(clefEndpoint("bad/id")).toBeNull();
  });

  it("unwraps the REST envelope and refuses a failed one", () => {
    expect(unwrapClefBody({ result: { answers: { a: 1 } }, success: true })).toEqual({ answers: { a: 1 } });
    expect(unwrapClefBody({ answers: { a: 1 } })).toEqual({ answers: { a: 1 } });
    expect(unwrapClefBody({ success: false, errors: [{ message: "x" }] })).toBeNull();
  });
});

describe("the clef provider", () => {
  it("is not ready without credentials and calls nothing", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    expect(deciderReady(ON, "replyReading")).toBe(false);
    await expect(decider(ON, fetchImpl).yesNo("replyReading", { a: 1 }, "Is it?")).resolves.toMatchObject({ ok: false, reason: "no_key" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("asks noul, choice and score in Cloudflare's shape and reads the wrapped answers", async () => {
    withCredentials();
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(wrapped({ answer: { type: "noul", noul: 0.98 } })))
      .mockResolvedValueOnce(jsonResponse(wrapped({ answer: { type: "choice", choice: "b", probabilities: { a: 0.1, b: 0.9 }, confidence: 0.8 } })))
      .mockResolvedValueOnce(jsonResponse(wrapped({ answer: { type: "score", score: 1.7, legend: { 0: "x", 1: "y", 2: "z" }, probabilities: { 0: 0.05, 1: 0.2, 2: 0.75 }, confidence: 0.6 } })));
    const d = decider(ON, fetchImpl);
    expect(deciderReady(ON, "replyReading")).toBe(true);
    await expect(d.yesNo("replyReading", "pode mandar", "Is this a yes?")).resolves.toMatchObject({ ok: true, provider: "clef", answers: { type: "yesno", p: 0.98 } });
    await expect(d.choose("roomRouting", { m: 1 }, { instructions: "Who?", options: { a: "A", b: "B" } })).resolves.toMatchObject({ ok: true, answers: { choice: "b", pTop: 0.9 } });
    await expect(d.score("modelSize", { m: 1 }, { instructions: "How big?", levels: ["x", "y", "z"] })).resolves.toMatchObject({ ok: true, answers: { score: 1.7, level: 2 } });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe(ENDPOINT);
    expect(init?.redirect).toBe("error");
    expect(init?.headers).toMatchObject({ authorization: `Bearer ${TOKEN}` });
    expect(JSON.parse(String(init?.body))).toEqual({ state: "pode mandar", model: "clef", questions: { answer: { type: "noul", instructions: "Is this a yes?" } } });
    expect(JSON.parse(String(fetchImpl.mock.calls[2]![1]?.body)).questions.answer).toEqual({ type: "score", instructions: "How big?", criteria: ["x", "y", "z"] });
  });

  it("uses clef-flash and an operator base URL when config says so", async () => {
    withCredentials();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(wrapped({ answer: { type: "noul", noul: 0.4 } })));
    const config: AppConfig = { decider: { enabled: true, provider: "clef", clefModel: "clef-flash", clefBaseUrl: "http://127.0.0.1:9999/v4" } };
    await decider(config, fetchImpl).yesNo("replyReading", "x", "Is it?");
    expect(String(fetchImpl.mock.calls[0]![0])).toBe(`http://127.0.0.1:9999/v4/accounts/${ACCOUNT}/ai/run/@cf/cloudflare/clef-flash`);
    expect(JSON.parse(String(fetchImpl.mock.calls[0]![1]?.body)).model).toBe("clef-flash");
  });

  it.each([
    [401, "rejected"], [403, "rejected"], [429, "rate_limited"], [503, "overloaded"], [500, "http_error"],
  ])("HTTP %i → %s, never a throw", async (status, reason) => {
    withCredentials();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ success: false, errors: [{ message: TOKEN }] }, status));
    const result = await decider(ON, fetchImpl).yesNo("replyReading", "x", "Is it?");
    expect(result).toMatchObject({ ok: false, provider: "clef", reason, status });
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it("a network failure, a bad body or success:false is ok:false", async () => {
    withCredentials();
    const fetchImpl = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(new Response("not json", { status: 200 }))
      .mockResolvedValueOnce(jsonResponse({ success: false, result: null }));
    const d = decider(ON, fetchImpl);
    await expect(d.yesNo("replyReading", "x", "Is it?")).resolves.toMatchObject({ ok: false, reason: "unreachable" });
    await expect(d.yesNo("replyReading", "x", "Is it?")).resolves.toMatchObject({ ok: false, reason: "malformed" });
    await expect(d.yesNo("replyReading", "x", "Is it?")).resolves.toMatchObject({ ok: false, reason: "malformed" });
  });

  it("times out on its own default when the caller gives none, and on the caller's when it does", async () => {
    withCredentials();
    vi.useFakeTimers();
    const hang = vi.fn<typeof fetch>().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    }));
    const d = decider({ decider: { ...ON.decider, clefTimeoutMs: 4_000 } }, hang);
    const own = d.yesNo("replyReading", "x", "Is it?");
    await vi.advanceTimersByTimeAsync(3_999);
    let settled = false;
    void own.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    await expect(own).resolves.toMatchObject({ ok: false, reason: "timeout" });
    const theirs = d.yesNo("replyReading", "x", "Is it?", { timeoutMs: 300 });
    await vi.advanceTimersByTimeAsync(301);
    await expect(theirs).resolves.toMatchObject({ ok: false, reason: "timeout" });
  });

  it("testKey runs one check with the environment's token", async () => {
    withCredentials();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(wrapped({ answer: { type: "noul", noul: 0.99 } })));
    await expect(decider({ decider: { provider: "clef" } }, fetchImpl).testKey({ provider: "clef" })).resolves.toMatchObject({ ok: true, provider: "clef" });
    expect(String(fetchImpl.mock.calls[0]![0])).toBe(ENDPOINT);
  });

  it("is described without the token and saved without asking for a key", () => {
    withCredentials();
    const described = describeDecider(ON);
    expect(described).toMatchObject({ provider: "clef", model: "clef", configured: true, enabled: true });
    expect(JSON.stringify(described)).not.toContain(TOKEN);
    expect(JSON.stringify(described)).not.toContain(ACCOUNT);
    expect(deciderSavePatch({ provider: "clef", enabled: true }, undefined)).toEqual({ ok: true, patch: { provider: "clef", enabled: true } });
  });
});
