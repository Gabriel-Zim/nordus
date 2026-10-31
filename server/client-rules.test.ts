import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendClientRule, clientRulesPath, lessonSavedLabel } from "./client-rules.ts";
import { removeTempDir } from "./testing/cleanup.ts";

const DAY = new Date(2026, 9, 17, 12);

describe("regras do cliente na ficha", () => {
  let cwd = "";
  let outside = "";
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "nordus-client-rules-"));
    outside = mkdtempSync(join(tmpdir(), "nordus-client-rules-fora-"));
    mkdirSync(join(cwd, "fichas", "lumon"), { recursive: true });
  });
  afterEach(async () => {
    await removeTempDir(cwd);
    await removeTempDir(outside);
  });

  it("grava abaixo de ## Regras na ficha do cliente", () => {
    const target = clientRulesPath(cwd, "lumon");
    expect(target).toEqual({ ok: true, path: join(cwd, "fichas", "lumon", "regras.md") });
    if (!target.ok) return;
    writeFileSync(target.path, "# Lumon\n\n## Regras\n");
    appendClientRule(target.path, "Título nunca em itálico", DAY);
    expect(readFileSync(target.path, "utf8")).toContain("## Regras\n- Título nunca em itálico (17/10/2026)");
    expect(readFileSync(target.path, "utf8")).toMatch(/^# Lumon\n\n## Regras\n/);
  });

  it("mantém as regras antigas", () => {
    const path = join(cwd, "fichas", "lumon", "regras.md");
    writeFileSync(path, "## Regras\n- Logo nunca em selo (01/10/2026)\n");
    appendClientRule(path, "Título nunca em itálico", DAY);
    expect(readFileSync(path, "utf8")).toBe("## Regras\n- Título nunca em itálico (17/10/2026)\n- Logo nunca em selo (01/10/2026)\n");
  });

  it("cria o título quando falta", () => {
    const path = join(cwd, "fichas", "lumon", "regras.md");
    appendClientRule(path, "Título  nunca\nem itálico", DAY);
    expect(readFileSync(path, "utf8")).toBe("## Regras\n- Título nunca em itálico (17/10/2026)\n");
    writeFileSync(path, "# Lumon\nTom sóbrio.\n");
    appendClientRule(path, "Sem travessão", DAY);
    expect(readFileSync(path, "utf8")).toBe("# Lumon\nTom sóbrio.\n\n## Regras\n- Sem travessão (17/10/2026)\n");
  });

  it("recusa slug com ../ ou maiúscula", () => {
    for (const client of ["../lumon", "Lumon", "lumon/../x", "a", "", "lex eer"]) {
      const result = clientRulesPath(cwd, client);
      expect(result.ok, client).toBe(false);
      if (!result.ok && client) expect(result.error).toContain(client);
    }
  });

  it("recusa cliente sem pasta", () => {
    const result = clientRulesPath(cwd, "valora");
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error).toContain("este cliente ainda não tem ficha");
    const noFichas = clientRulesPath(outside, "lumon");
    expect(noFichas).toMatchObject({ ok: false });
    if (!noFichas.ok) expect(noFichas.error).toContain("este cliente ainda não tem ficha");
  });

  it("recusa link que sai da pasta fichas", () => {
    symlinkSync(outside, join(cwd, "fichas", "x"));
    expect(clientRulesPath(cwd, "x")).toMatchObject({ ok: false });
    symlinkSync(join(outside, "regras.md"), join(cwd, "fichas", "lumon", "regras.md"));
    writeFileSync(join(outside, "regras.md"), "## Regras\n");
    expect(clientRulesPath(cwd, "lumon")).toMatchObject({ ok: false });
  });

  it("aceita regras.md com CRLF sem criar um segundo título", () => {
    const path = join(cwd, "fichas", "lumon", "regras.md");
    writeFileSync(path, "# Lumon\r\n\r\n## Regras\r\n- Logo nunca em selo (01/10/2026)\r\n");
    appendClientRule(path, "Título nunca em itálico", DAY);
    const text = readFileSync(path, "utf8");
    expect(text.match(/## Regras/g)).toHaveLength(1);
    expect(text).toBe("# Lumon\r\n\r\n## Regras\r\n- Título nunca em itálico (17/10/2026)\r\n- Logo nunca em selo (01/10/2026)\r\n");
  });

  it("diz na linha de atividade para qual ficha a regra foi", () => {
    expect(lessonSavedLabel("lumon")).toBe("Regra salva na ficha da LUMON");
    expect(lessonSavedLabel(undefined)).toBe("Regra salva");
  });

  it("recusa pasta de trabalho relativa", () => {
    expect(clientRulesPath("relativa", "lumon")).toMatchObject({ ok: false });
  });
});
