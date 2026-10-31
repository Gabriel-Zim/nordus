import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NordusMonogram, monogramFor, monogramRadius } from "./NordusMark";
import { CritterAvatar } from "./Avatar";

describe("Nordus monogram", () => {
  it("takes two letters from the name", () => {
    expect(monogramFor("Gerente De Operacao")).toBe("GD");
    expect(monogramFor("Financeiro")).toBe("FI");
    expect(monogramFor("MontadorDeVideo!")).toBe("MO");
    expect(monogramFor("")).toBe("N");
  });

  it("is a rounded square, never a circle", () => {
    expect(monogramRadius(16)).toBe(5);
    expect(monogramRadius(40)).toBe(11);
    expect(monogramRadius(48)).toBe(13);
    const html = renderToStaticMarkup(createElement(NordusMonogram, { color: "orange", size: 44, label: "Social" }));
    expect(html).toContain("border-radius:12px");
    expect(html).toContain(">SO<");
  });

  it("draws the round glass robot, never initials, wherever CritterAvatar is used", () => {
    const html = renderToStaticMarkup(createElement(CritterAvatar, { color: "green", label: "Plum", state: "happy" }));
    expect(html).toContain('data-bot-avatar="robot"');
    expect(html).toContain("rounded-full");
    expect(html).not.toContain("data-nordus-monogram");
    expect(html).not.toContain("radialGradient");
  });
});
