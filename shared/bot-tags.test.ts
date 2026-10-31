import { describe, expect, it } from "vitest";

import { BOT_TAG_AREAS, BOT_TAG_MAX, cleanBotTag, tagSearchKey } from "./bot-tags.ts";

const tags = BOT_TAG_AREAS.flatMap((area) => area.tags);

describe("bot tag catalog", () => {
  it("offers about 150 role tags", () => {
    expect(tags.length).toBeGreaterThanOrEqual(140);
    expect(tags.length).toBeLessThanOrEqual(180);
  });

  it("fits every tag in the list pill", () => {
    expect(tags.filter((tag) => tag.length > BOT_TAG_MAX || cleanBotTag(tag) !== tag)).toEqual([]);
  });

  it("never offers the same tag twice, whatever the accents, case or hyphens", () => {
    expect(new Set(tags.map(tagSearchKey)).size).toBe(tags.length);
  });

  it("covers the roles Avery asked for", () => {
    for (const wanted of ["Financeiro", "Desenvolvedor Front-end", "Desenvolvedor Back-end", "Gerente Operacional", "Diretor de Arte",
      "Designer", "Social Media", "Editor de Vídeo", "Copywriter", "Atendimento", "Jurídico", "RH", "Vendas", "Tráfego Pago", "Pesquisa", "Dados"]) {
      expect(tags, wanted).toContain(wanted);
    }
  });

  it("names every role one way, without the (a) ending", () => {
    expect(tags.filter((tag) => tag.includes("(a)"))).toEqual([]);
  });

  it("writes no long dashes", () => {
    expect(BOT_TAG_AREAS.flatMap((area) => [area.area, ...area.tags]).filter((text) => /[–—]/.test(text))).toEqual([]);
  });
});
