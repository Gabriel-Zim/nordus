import { describe, expect, it } from "vitest";

import { goalMonth, monthForward } from "./calendar.ts";
import type { PageState } from "./model.ts";

const page = (text: string, labels: string[]): PageState => ({
  url: "https://www.airbnb.com.br/", title: "Airbnb", text, marker: "m", page_key: "k", guards: {}, scroll: { y: 0, height: 800 },
  actions: labels.map((label, index) => ({ id: `e${index + 1}`, kind: "click" as const, node: index + 1, role: "button", label })),
});
const NEXT = "Mova para frente para alternar para o próximo mês.";

describe("monthForward", () => {
  it("reads the month a goal starts in, in English or Portuguese, and not the verb may", () => {
    expect(goalMonth("Search Porto for January 5 to 8 for 2 adults")?.[1]).toBe("janeiro");
    expect(goalMonth("Busque Lisboa de 28 de dezembro a 3 de janeiro")?.[0]).toBe("december");
    expect(goalMonth("You may search Paris for 2 adults")).toBeNull();
  });

  it("presses next month while the open calendar does not show the goal's month yet", () => {
    const calendar = page("outubro de 2026\nnovembro de 2026\nD S T Q Q S S", ["Quando Insira as datas", NEXT, "21, Wednesday, October 2026. Disponível."]);
    expect(monthForward(calendar, "Search Porto for January 5 to 8 for 2 adults")?.label).toBe(NEXT);
  });

  it("sees the goal's month in the day buttons when the page text does not carry the month headers", () => {
    const march = page("Airbnb\nOnde\nQuando", ["Quando", NEXT, "15, Monday, March 2027. Disponível. Selecione como a data de check-in."]);
    expect(monthForward(march, "Search Recife for March 15 to 18 for 2 adults")).toBeNull();
  });

  it("leaves the choice to the pilot once the month is on screen, or when no calendar is open", () => {
    const january = page("dezembro de 2026\njaneiro de 2027", ["Quando Insira as datas", NEXT]);
    expect(monthForward(january, "Search Porto for January 5 to 8")).toBeNull();
    expect(monthForward(page("Airbnb", ["Quando Insira as datas"]), "Search Porto for January 5 to 8")).toBeNull();
  });
});
