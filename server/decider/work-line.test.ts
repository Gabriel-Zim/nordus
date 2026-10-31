import { describe, expect, it } from "vitest";

import { parseWorkLine, workLinePrompt, workLineRequest } from "./work-line.ts";

describe("what the bot is doing, in a person's words", () => {
  it("reads the phrase and the object", () => {
    expect(parseWorkLine('{"fazendo":"desenhando a capa do Reels do CJ","objeto":"A capa do Reels do CJ"}'))
      .toEqual({ doing: "Desenhando a capa do Reels do CJ", object: "a capa do Reels do CJ" });
    expect(parseWorkLine('Claro: {"fazendo":"Conferindo a agenda da semana","objeto":""}')).toEqual({ doing: "Conferindo a agenda da semana" });
  });

  it("refuses anything technical, long, not a gerund or not JSON", () => {
    expect(parseWorkLine('{"fazendo":"Rodando mcp__zorg__editar_imagem","objeto":""}')).toBeNull();
    expect(parseWorkLine('{"fazendo":"Editando capa.png","objeto":""}')).toBeNull();
    expect(parseWorkLine('{"fazendo":"Vou desenhar a capa","objeto":""}')).toBeNull();
    expect(parseWorkLine("Desenhando a capa")).toBeNull();
    expect(parseWorkLine(`{"fazendo":"${"Desenhando ".repeat(10)}","objeto":""}`)).toBeNull();
    expect(parseWorkLine('{"fazendo":"Desenhando a capa","objeto":"src/capa.png"}')).toEqual({ doing: "Desenhando a capa" });
  });

  it("asks in Portuguese, plain, with the request quoted", () => {
    const prompt = workLinePrompt("faz a capa do reels do CJ");
    expect(prompt).toContain("gerúndio");
    expect(prompt).toContain('"""faz a capa do reels do CJ"""');
  });

  it("writes the line from the person's message, or from the brief a teammate was handed, never from a continuation", () => {
    expect(workLineRequest({ text: "faz a capa do reels", continuation: false })).toBe("faz a capa do reels");
    expect(workLineRequest({ text: "Your downstream room requests have settled.", continuation: true })).toBeUndefined();
    expect(workLineRequest({ text: "Coordinated brief with the roster", continuation: true, brief: "Diagrama a lâmina 3 da Lumon" }))
      .toBe("Diagrama a lâmina 3 da Lumon");
  });
});
