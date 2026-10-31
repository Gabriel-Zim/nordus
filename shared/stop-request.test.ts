import { describe, expect, it } from "vitest";
import { isStopRequest } from "./stop-request.ts";

describe("isStopRequest", () => {
  it.each([
    "para", "Para!", "pare", "PARA TUDO", "para por favor", "pode parar", "esquece isso", "Esquece", "esquece isso aí",
    "cancela", "cancela isso", "chega", "chega, para", "ok para", "deixa pra lá", "stop", "para com isso", "GerenteDeOperacao, para", "@GerenteDeOperacao para",
  ])("stops on %j", (text) => {
    expect(isStopRequest(text, ["GerenteDeOperacao"])).toBe("stop");
  });

  it.each([
    "para de usar azul e faz verde",
    "não para",
    "para quando terminar o relatório",
    "cancela a reunião de amanhã com o cliente",
    "esquece o azul, usa verde",
    "para a pesquisa e me manda o que tem",
    "chega de texto, quero imagem",
    "pode continuar",
    "",
    "👍",
  ])("leaves %j to the running turn", (text) => {
    expect(isStopRequest(text, ["GerenteDeOperacao"])).toBe("other");
  });
});
