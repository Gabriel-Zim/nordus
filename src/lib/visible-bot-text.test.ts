import { describe, expect, it } from "vitest";
import { hasNeedsInputLine, visibleBotText } from "./visible-bot-text";

describe("visibleBotText", () => {
  it("drops the marker and keeps the question", () => {
    expect(visibleBotText("Essas são as artes.\nNEEDS INPUT: Aprova?")).toBe("Essas são as artes.\nAprova?");
  });
  it("ignores case and leading spaces", () => {
    expect(visibleBotText("Oi\n   needs input:   Posso seguir?")).toBe("Oi\nPosso seguir?");
    expect(visibleBotText("Needs Input: Qual cor?")).toBe("Qual cor?");
  });
  it("leaves the marker alone when it is not at the start of a line", () => {
    expect(visibleBotText("Escrevi NEEDS INPUT: no meio")).toBe("Escrevi NEEDS INPUT: no meio");
  });
  it("leaves ordinary text untouched", () => {
    expect(visibleBotText("Tudo certo.")).toBe("Tudo certo.");
  });
});

describe("hasNeedsInputLine", () => {
  it("recognises the question anywhere in the reply", () => {
    expect(hasNeedsInputLine("Essas são as artes.\nNEEDS INPUT: Aprova?")).toBe(true);
    expect(hasNeedsInputLine("  needs input:   Posso seguir?")).toBe(true);
  });
  it("ignores a marker inside a line and ordinary text", () => {
    expect(hasNeedsInputLine("Escrevi NEEDS INPUT: no meio")).toBe(false);
    expect(hasNeedsInputLine("Tudo certo.")).toBe(false);
  });
});
