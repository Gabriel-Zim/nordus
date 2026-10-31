import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { chooseLiveVoice, clefEndpoint, CLEF_MODEL } from "./live-voice.ts";

const env = { CLOUDFLARE_ACCOUNT_ID: "a".repeat(32), CLOUDFLARE_AI_TOKEN: "test-token" };
const persona = { name: "Ana", title: "Assistente financeira", description: "Cuida do caixa" };

function reply(choice: string, status = 200) {
  const probabilities: Record<string, number> = { bossa: 0.1, tempo: 0.1, marin: 0.1, cedar: 0.1, alloy: 0.1, ash: 0.1, ballad: 0.1, coral: 0.1, echo: 0.05, sage: 0.05, shimmer: 0.05, verse: 0.05 };
  const rest = ["gleam", "meridian", "quartz", "ripple", "vesper", "willow", "stone", "delta", "cinder", "beacon"];
  for (const id of rest) probabilities[id] = 0;
  probabilities[choice] = (probabilities[choice] ?? 0) + 0.2;
  const sum = Object.values(probabilities).reduce((a, b) => a + b, 0);
  for (const key of Object.keys(probabilities)) probabilities[key] = probabilities[key]! / sum;
  return new Response(JSON.stringify({ result: { answers: { voice: { type: "choice", choice, probabilities } } } }), { status });
}

describe("chooseLiveVoice", () => {
  it("asks CLEF with the persona and the voice catalog, and returns the catalog voice it picks", async () => {
    const fetchMock = vi.fn(async () => reply("bossa"));
    const voice = await chooseLiveVoice({ persona, env, fetch: fetchMock as unknown as typeof fetch });
    expect(voice).toBe("bossa");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe(`https://api.cloudflare.com/client/v4/accounts/${"a".repeat(32)}/ai/run/${CLEF_MODEL}`);
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer test-token");
    const body = JSON.parse(String(init.body));
    expect(body.state).toMatchObject({ name: "Ana", title: "Assistente financeira" });
    expect(body.questions.voice.type).toBe("choice");
    expect(Object.keys(body.questions.voice.criteria)).toContain("tempo");
  });

  it("uses the app-wide voice (null) without a key", async () => {
    const fetchMock = vi.fn();
    expect(await chooseLiveVoice({ persona, env: {}, fetch: fetchMock as unknown as typeof fetch })).toBeNull();
    expect(clefEndpoint({ CLOUDFLARE_ACCOUNT_ID: "bad", CLOUDFLARE_AI_TOKEN: "x" })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reads the decision model's env file when the environment has no key, and sends the model name", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "live-voice-")), "cloudflare-ai.env");
    writeFileSync(file, `CLOUDFLARE_ACCOUNT_ID=${"b".repeat(32)}\nCLOUDFLARE_AI_TOKEN=file-token\n`);
    const fetchMock = vi.fn(async () => reply("tempo"));
    expect(await chooseLiveVoice({ persona, env: {}, envFile: file, fetch: fetchMock as unknown as typeof fetch })).toBe("tempo");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toContain(`/accounts/${"b".repeat(32)}/ai/run/@cf/cloudflare/clef`);
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer file-token");
    expect(JSON.parse(String(init.body)).model).toBe("clef");
  });

  it.each([
    ["an HTTP error", async () => reply("bossa", 500)],
    ["a network failure", async () => { throw new Error("offline"); }],
    ["a malformed answer", async () => new Response("{}", { status: 200 })],
  ])("returns null on %s, without throwing", async (_name, impl) => {
    expect(await chooseLiveVoice({ persona, env, fetch: vi.fn(impl) as unknown as typeof fetch })).toBeNull();
  });
});
