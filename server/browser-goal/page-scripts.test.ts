// @vitest-environment happy-dom
import { expect, it } from "vitest";

import { READ_STATE } from "./page-scripts.ts";

it("keeps the page reading small when a dialog full of text holds many controls, like a date picker", () => {
  const dom = globalThis as unknown as { Element: { prototype: Record<string, unknown> }; document: { body: { innerHTML: string } } };
  dom.Element.prototype.checkVisibility = () => true;
  dom.Element.prototype.getBoundingClientRect = () => ({ x: 10, y: 10, width: 20, height: 20, top: 10, left: 10, right: 30, bottom: 30, toJSON: () => ({}) });
  const days = Array.from({ length: 60 }, (_, index) => `<button>${index + 1}</button>`).join("");
  dom.document.body.innerHTML = `<div role="dialog"><p>${"Selecione as datas da viagem. ".repeat(400)}</p>${days}</div>`;
  const answer = new Function(`return ${READ_STATE}`)() as string;
  expect(JSON.parse(answer).actions.length).toBeGreaterThan(60);
  expect(answer.length).toBeLessThan(60_000);
});

it("keeps the page reading small on a results page with thousands of long links, like a map of listings", () => {
  const dom = globalThis as unknown as { Element: { prototype: Record<string, unknown> }; document: { body: { innerHTML: string } } };
  dom.Element.prototype.checkVisibility = () => true;
  dom.Element.prototype.getBoundingClientRect = () => ({ x: 10, y: 10, width: 20, height: 20, top: 10, left: 10, right: 30, bottom: 30, toJSON: () => ({}) });
  const card = (index: number) => `<a href="https://www.airbnb.com.br/rooms/${index}?${"check_in=2026-12-12&check_out=2026-12-15&".repeat(12)}">${`Apartamento ${index} em Lisboa, nota 4,9, perto do metrô. `.repeat(20)}</a>`;
  dom.document.body.innerHTML = Array.from({ length: 1500 }, (_, index) => card(index)).join("");
  const answer = new Function(`return ${READ_STATE}`)() as string;
  expect(JSON.parse(answer).omitted_actions).toBeGreaterThan(0);
  expect(answer.length).toBeLessThan(300_000);
});
