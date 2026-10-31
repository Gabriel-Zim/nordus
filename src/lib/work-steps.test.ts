import { beforeEach, describe, expect, it } from "vitest";
import { setLocale } from "@/lib/i18n";
import { botStepNow, stepClock, stepLines, taskStepNow, toolStepPhrase, whoIsDoing } from "./work-steps";

describe("work steps in words", () => {
  beforeEach(() => setLocale("pt-br"));

  it("says a tool as what the bot is doing, never its name", () => {
    expect(toolStepPhrase("mcp__zim__gerar_imagem")).toBe("Gerando imagem");
    expect(toolStepPhrase("mcp__figma__get_screenshot")).toBe("Exportando do Figma");
    expect(toolStepPhrase("mcp__figma__get_design_context")).toBe("Lendo o arquivo no Figma");
    expect(toolStepPhrase("mcp__second-brain__ler_documento")).toBe("Lendo a ficha do cliente");
    expect(toolStepPhrase("mcp__behance__search_projects")).toBe("Pesquisando referências no Behance");
    expect(toolStepPhrase("WebSearch")).toBe("Pesquisando na internet");
    expect(toolStepPhrase("Bash")).toBe("Trabalhando no computador");
    expect(toolStepPhrase("Edit")).toBe("Fazendo ajustes");
    expect(toolStepPhrase("CANVA_CREATE_DESIGN")).toBe("Usando o Canva");
    expect(toolStepPhrase("mcp__dfa14c0c-12ad__obscure_thing")).toBe("Trabalhando");
    expect(toolStepPhrase("mcp__googlesheets__append_rows")).toBe("Usando o Google Sheets");
  });

  it("folds repeats and keeps the bot's own sentences as written", () => {
    expect(stepLines([
      { at: 1, tool: "Read" },
      { at: 2, tool: "Glob" },
      { at: 3, tool: "Read" },
      { at: 4, text: "Montando a lâmina 1" },
    ]).map((line) => line.label)).toEqual(["Lendo os arquivos", "Procurando arquivos", "Lendo os arquivos", "Montando a lâmina 1"]);
    expect(stepLines([{ at: 1, tool: "Read" }, { at: 2, tool: "Read" }])).toEqual([{ at: 1, label: "Lendo os arquivos" }]);
  });

  it("finds the step a bot is on in its own conversations, else in the room it speaks in", () => {
    const steps = [{ at: 1, text: "Montando a lâmina 2 de 5" }];
    expect(botStepNow({ id: "d", threadId: "main", tasks: [{ threadId: "main" }, { threadId: "other", steps }] })).toBe("Montando a lâmina 2 de 5");
    expect(botStepNow({ id: "d", threadId: "main", tasks: [{ threadId: "main", doing: "Criando o carrossel" }] })).toBe("Criando o carrossel");
    expect(botStepNow({ id: "d", threadId: "main", tasks: [] }, [{ busyBotId: "x", tasks: [{ busyBotId: "d", steps }] }])).toBe("Montando a lâmina 2 de 5");
    expect(botStepNow({ id: "d", threadId: "main", tasks: [] })).toBeNull();
  });

  it("puts only the bot's own sentence ahead of the line of the request, and a tool after it", () => {
    const obscure = [{ at: 1, tool: "mcp__dfa14c0c-12ad__obscure_thing" }];
    expect(taskStepNow({ steps: obscure, doing: "Criando o carrossel" })).toBe("Criando o carrossel");
    expect(taskStepNow({ steps: [{ at: 1, tool: "Read" }], doing: "Criando o carrossel" })).toBe("Criando o carrossel");
    expect(taskStepNow({ steps: [...obscure, { at: 2, text: "Montando a lâmina 2" }], doing: "Criando o carrossel" })).toBe("Montando a lâmina 2");
    expect(taskStepNow({ steps: [{ at: 1, tool: "Read" }] })).toBe("Lendo os arquivos");
    expect(taskStepNow({})).toBeNull();
    expect(botStepNow({ id: "d", threadId: "main", tasks: [{ threadId: "main", doing: "Criando o carrossel", steps: obscure }] })).toBe("Criando o carrossel");
  });

  it("says a shell step in the same words as the chat line, and the computer when the command has no words", () => {
    const steps = [{ at: 1, tool: "Read" }, { at: 2, tool: "Bash", command: "allTests" as const }];
    expect(stepLines(steps).map((line) => line.label)).toEqual(["Lendo os arquivos", "Rodando todos os testes"]);
    expect(botStepNow({ id: "j", threadId: "main", tasks: [{ threadId: "main", steps }] })).toBe("Rodando todos os testes");
    expect(stepLines([{ at: 1, tool: "Bash", command: "allTests" }, { at: 2, tool: "Bash", command: "typeCheck" }, { at: 3, tool: "Bash" }])
      .map((line) => line.label)).toEqual(["Rodando todos os testes", "Conferindo o código", "Rodando um comando"]);
  });

  it("puts a running command in words ahead of the light model's line, as the chat does, only while it runs", () => {
    const steps = [{ at: 1, tool: "Read" }, { at: 2, tool: "Bash", command: "allTests" as const, since: 2 }];
    expect(botStepNow({ id: "j", threadId: "main", tasks: [{ threadId: "main", doing: "Juntando o trabalho dos diretores", steps }] })).toBe("Rodando todos os testes");
    const waiting = [{ at: 1, tool: "Read" }, { at: 2, tool: "Bash", command: "allTests" as const }];
    expect(botStepNow({ id: "j", threadId: "main", tasks: [{ threadId: "main", doing: "Juntando o trabalho dos diretores", steps: waiting }] })).toBe("Juntando o trabalho dos diretores");
    expect(botStepNow({ id: "j", threadId: "main", tasks: [{ threadId: "main", doing: "Juntando o trabalho dos diretores", steps: [{ at: 1, tool: "Bash" }] }] }))
      .toBe("Juntando o trabalho dos diretores");
  });

  it("dates a running command step from when it was allowed to start, as the chat line does", () => {
    const steps = [{ at: 1, tool: "Read" }, { at: 2, tool: "Bash", command: "allTests" as const, since: 600 }];
    expect(stepLines(steps).map((line) => line.at)).toEqual([1, 600]);
    expect(stepLines([{ at: 2, tool: "Bash", command: "allTests" as const }]).map((line) => line.at)).toEqual([2]);
  });

  it("names who works in a room", () => {
    expect(whoIsDoing("Designer", "Montando a lâmina 2")).toBe("Designer: montando a lâmina 2");
    expect(whoIsDoing("Designer", "Trabalhando")).toBe("Designer: trabalhando");
    expect(whoIsDoing("Designer", "UX da capa")).toBe("Designer: UX da capa");
    expect(whoIsDoing("Designer", "Lumon, revisando a capa")).toBe("Designer: Lumon, revisando a capa");
    expect(whoIsDoing("Designer", "Figma aberto na capa")).toBe("Designer: Figma aberto na capa");
  });

  it("writes the hour of a step the way the queue writes it", () => {
    expect(stepClock(new Date(2026, 9, 17, 9, 4).getTime())).toBe("9:04");
    expect(stepClock(new Date(2026, 9, 17, 14, 5).getTime())).toBe("14:05");
  });
});
