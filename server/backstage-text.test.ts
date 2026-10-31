import { describe, expect, it } from "vitest";

import { dropBackstageLead, nordusModelNames } from "./backstage-text.ts";

describe("English backstage line before a Portuguese reply", () => {
  it("drops it", () => {
    const text = "The DESIGNERDEIA's answer covers colors, photo and title position in 3 lines. Delivering.\n\nAqui está a capa do post sobre café da manhã, nas palavras do DESIGNERDEIA:\n\nCores: fundo creme claro.";
    expect(dropBackstageLead(text)).toBe("Aqui está a capa do post sobre café da manhã, nas palavras do DESIGNERDEIA:\n\nCores: fundo creme claro.");
  });

  it("keeps a reply that is English on purpose, or Portuguese from the start", () => {
    const english = "The answer is in the file.\n\nIt covers the three lines you asked for and the title.";
    expect(dropBackstageLead(english)).toBe(english);
    const portuguese = "Pronto, Avery.\n\nA capa tem fundo creme e a foto da mesa.";
    expect(dropBackstageLead(portuguese)).toBe(portuguese);
    const single = "The answer covers it. Delivering.";
    expect(dropBackstageLead(single)).toBe(single);
  });

  it("keeps an English quote the person asked for inside a Portuguese reply", () => {
    const text = "Segue a frase em inglês que você pediu:\n\nThe best coffee is the one you share.";
    expect(dropBackstageLead(text)).toBe(text);
  });
});

describe("model names as the picker shows them", () => {
  it("drops Claude and da Anthropic unless the person asked who makes it", () => {
    expect(nordusModelNames("Estou usando o Claude Haiku 5.5, da Anthropic.", "qual modelo você está usando agora?")).toBe("Estou usando o Haiku 5.5.");
    expect(nordusModelNames("Rodo no Nordus da Anthropic com o Claude Opus 5.5.", "qual modelo?")).toBe("Rodo no Nordus, da Zorg Content com o Opus 5.5.");
    expect(nordusModelNames("É o Claude Haiku 5.5, da Anthropic.", "de qual empresa é esse modelo?")).toBe("É o Claude Haiku 5.5, da Anthropic.");
    expect(nordusModelNames("Sem modelo aqui.", undefined)).toBe("Sem modelo aqui.");
  });
});
