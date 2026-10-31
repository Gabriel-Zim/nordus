import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setLocale } from "@/lib/i18n";
import { localizeQuietNotice } from "./quiet-notice";
import { describeQuiet } from "../../server/drivers/acp/quiet-status";

describe("localizeQuietNotice", () => {
  beforeEach(() => { setLocale("pt-BR"); });
  afterEach(() => { setLocale("en"); });

  it("translates waiting on the model, in both variants", () => {
    const quiet = describeQuiet("Grok", { kind: "waiting-model", nearFullContext: false }, 73_000, 600_000);
    expect(localizeQuietNotice(quiet)).toBe(
      "Grok está esperando a resposta do modelo há 73 s. O pedido segue aberto; modelos lentos e limites de uso fazem isso.",
    );
    const full = describeQuiet("Grok", { kind: "waiting-model", nearFullContext: true }, 150_000, 600_000);
    expect(localizeQuietNotice(full)).toContain("há 3 min");
    expect(localizeQuietNotice(full)).toContain("quase cheio");
  });

  it("translates a rate-limit retry with attempt and next try", () => {
    const text = describeQuiet("Grok", { kind: "retrying", status: 429, delayMs: 8_000, attempt: 1 }, 40_000, 600_000);
    expect(localizeQuietNotice(text)).toBe(
      "Grok atingiu um limite de uso (HTTP 429) e está tentando de novo (tentativa 2). Próxima tentativa em 8 s. Ele continua trabalhando.",
    );
  });

  it("translates retries without attempt, delay or status", () => {
    const server = describeQuiet("Grok", { kind: "retrying", status: 503, delayMs: null, attempt: null }, 40_000, 600_000);
    expect(localizeQuietNotice(server)).toBe(
      "Grok recebeu um erro do servidor do provedor do modelo (HTTP 503) e está tentando de novo. Ele continua trabalhando.",
    );
    const failed = describeQuiet("Grok", { kind: "retrying", status: null, delayMs: null, attempt: null }, 40_000, 600_000);
    expect(localizeQuietNotice(failed)).toContain("teve um pedido ao modelo que falhou");
  });

  it("translates every other quiet state", () => {
    for (const kind of ["compressing", "busy", "between-requests", "no-signs", "unknown"] as const) {
      const text = describeQuiet("Grok", { kind }, 120_000, 600_000);
      const out = localizeQuietNotice(text);
      expect(out).not.toBe(text);
      expect(out).toMatch(/^Grok /);
    }
    expect(localizeQuietNotice(describeQuiet("Grok", { kind: "no-signs" }, 120_000, 900_000)))
      .toContain("após 15 min de silêncio");
  });

  it("returns unknown text unchanged", () => {
    expect(localizeQuietNotice("Something else happened")).toBe("Something else happened");
  });
});
