import { describe, expect, it, vi } from "vitest";
import { engineExplanation, engineIntent, jevIntent, looksPortuguese, PLAIN_ACTIONS } from "./approval-intent.ts";

describe("approval intent", () => {
  it("takes the engine's Portuguese words as the end of the title", () => {
    expect(engineIntent("Publicar a página do artigo.")).toBe("publicar a página do artigo");
    expect(engineIntent("Alterar os arquivos do site")).toBe("alterar os arquivos do site");
  });

  it("makes the title from the first sentence of a first person description", () => {
    expect(engineIntent("Quero publicar a página do artigo. Só altero a pasta do site.")).toBe("publicar a página do artigo");
    expect(engineIntent("Quero rodar os testes do contador de palavras que o Cursor acabou de criar, para conferir se ele conta certo. Só leio e executo dentro do repositório de teste."))
      .toBe("rodar os testes do contador de palavras que o Cursor acabou de criar");
    expect(engineIntent("Quero instalar um programa muito longo que ninguém pediu para a conferência anual dos departamentos todos, para ver o que acontece com tudo isso."))
      .toBeUndefined();
  });

  it("drops English, commands, paths and code", () => {
    expect(engineIntent("Install dependencies for the project")).toBeUndefined();
    expect(engineIntent("Rodar npm install --save no projeto")).toBeUndefined();
    expect(engineIntent("Copiar /home/nordus/site/index.html para a pasta")).toBeUndefined();
    expect(engineIntent("")).toBeUndefined();
    expect(engineIntent(undefined)).toBeUndefined();
  });

  it("keeps the engine's Portuguese sentences whole, capitalized and ended with a period", () => {
    expect(engineExplanation("quero rodar os testes do contador de palavras, para conferir se ele conta certo"))
      .toBe("Quero rodar os testes do contador de palavras, para conferir se ele conta certo.");
    expect(engineExplanation("Quero  ler o arquivo\nde notas. Só leio, nada muda."))
      .toBe("Quero ler o arquivo de notas. Só leio, nada muda.");
  });

  it("gives no explanation for commands, paths, English or a wall of text", () => {
    expect(engineExplanation("Quero rodar `npm test` para conferir o projeto.")).toBeUndefined();
    expect(engineExplanation("Quero copiar /home/nordus/site/index.html para a pasta nova.")).toBeUndefined();
    expect(engineExplanation("I want to run the tests for the word counter.")).toBeUndefined();
    expect(engineExplanation("Quero conferir o site. Depois leio a pasta. Depois salvo a versão. Depois publico tudo.")).toBeUndefined();
    expect(engineExplanation(`Quero conferir o site ${"para ver se está certo ".repeat(30)}.`)).toBeUndefined();
    expect(engineExplanation("")).toBeUndefined();
    expect(engineExplanation(undefined)).toBeUndefined();
  });

  it("tells Portuguese from English", () => {
    expect(looksPortuguese("Publicar a página do artigo")).toBe(true);
    expect(looksPortuguese("List the files in the folder")).toBe(false);
  });

  it("returns Jev's plain phrase, and nothing when Jev is off or unsure", async () => {
    const sure = { choose: vi.fn().mockResolvedValue({ ok: true, answers: { type: "choice", choice: "publish", pTop: 0.9, margin: 0.5, probabilities: {} } }) };
    await expect(jevIntent(sure, { tool: "Bash", command: "wrangler deploy" })).resolves.toBe(PLAIN_ACTIONS.publish);
    expect(sure.choose).toHaveBeenCalledWith("criticalCheck", expect.anything(), expect.objectContaining({ options: PLAIN_ACTIONS }), { timeoutMs: 1_500 });
    const unsure = { choose: vi.fn().mockResolvedValue({ ok: true, answers: { type: "choice", choice: "publish", pTop: 0.2, margin: 0, probabilities: {} } }) };
    await expect(jevIntent(unsure, { tool: "Bash" })).resolves.toBeNull();
    const off = { choose: vi.fn().mockResolvedValue({ ok: false, reason: "disabled" }) };
    await expect(jevIntent(off, { tool: "Bash" })).resolves.toBeNull();
    const broken = { choose: vi.fn().mockRejectedValue(new Error("boom")) };
    await expect(jevIntent(broken, { tool: "Bash" })).resolves.toBeNull();
  });

  it("never offers a phrase with a command word in it", () => {
    for (const phrase of Object.values(PLAIN_ACTIONS)) expect(phrase).not.toMatch(/comando|rodar|executar|terminal|script/);
  });
});
