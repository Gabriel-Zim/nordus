import { describe, expect, it } from "vitest";

import { stepOnObject } from "./tool-step-label";

describe("steps on the thing the bot works on", () => {
  it("says verb and object in Portuguese, past when done", () => {
    expect(stepOnObject("mcp__zorg__editar_imagem", "a capa do Reels do CJ", "pt-br")).toBe("Editando a capa do Reels do CJ");
    expect(stepOnObject("mcp__zorg__editar_imagem", "a capa do Reels do CJ", "pt-br", true)).toBe("Editei a capa do Reels do CJ");
    expect(stepOnObject("mcp__zorg__gerar_video", "o vídeo do CJ", "pt-br")).toBe("Montando o vídeo do CJ");
  });

  it("keeps the plain step without an object, in other languages, or for reading and searching", () => {
    expect(stepOnObject("mcp__zorg__editar_imagem", undefined, "pt-br")).toBeNull();
    expect(stepOnObject("mcp__zorg__editar_imagem", "a capa", "en")).toBeNull();
    expect(stepOnObject("Read", "a capa", "pt-br")).toBeNull();
    expect(stepOnObject("WebSearch", "a capa", "pt-br")).toBeNull();
  });
});
