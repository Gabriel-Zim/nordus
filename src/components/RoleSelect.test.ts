import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ASSIGNABLE_ROLES, ROLE_HINT, ROLE_LABEL } from "@/lib/person-roles";
import en from "@/locales/en.json";
import ptBr from "@/locales/pt-br.json";
import { RoleSelect } from "./RoleSelect";

const english = en as Record<string, string>;
const portuguese = ptBr as Record<string, string>;
const selectedOf = (html: string) => [...html.matchAll(/<option([^>]*)>/g)]
  .filter((match) => /\bselected(=|\s|$)/.test(match[1]!))
  .map((match) => /value="([^"]*)"/.exec(match[1]!)?.[1]);
const placeholders = (text: string) => [...text.matchAll(/\{\w+\}/g)].map((match) => match[0]).sort();

describe("the role picker", () => {
  it("offers admin, member and guest, each with its one-line explanation", () => {
    const html = renderToStaticMarkup(createElement(RoleSelect, { value: "member", onChange() {}, label: "Role for ada@example.test" }));
    expect(ASSIGNABLE_ROLES).toEqual(["admin", "member", "guest"]);
    expect(html).toContain('data-description="Sees and changes everything, including spending."');
    expect(html).toContain('data-description="Talks to the agents and decides what is theirs."');
    expect(html).toContain('data-description="Only talks in the channels they were put in."');
    expect(html).toContain(">Guest</option>");
    expect(html).toContain('aria-label="Role for ada@example.test"');
  });

  it("selects the role it was given", () => {
    const html = renderToStaticMarkup(createElement(RoleSelect, { value: "guest", onChange() {}, label: "Role" }));
    expect(selectedOf(html)).toEqual(["guest"]);
  });

  it("has every label and explanation in English and in Brazilian Portuguese, with the same placeholders", () => {
    for (const role of ASSIGNABLE_ROLES) {
      for (const key of [ROLE_LABEL[role], ROLE_HINT[role]]) {
        expect(english[key], `${key} in en.json`).toBeTypeOf("string");
        expect(portuguese[key], `${key} in pt-br.json`).toBeTypeOf("string");
        expect(placeholders(portuguese[key]!)).toEqual(placeholders(english[key]!));
      }
    }
  });

  it("explains the three roles in plain Portuguese and never with the long dash", () => {
    expect(portuguese[ROLE_LABEL.guest]).toBe("Convidado");
    expect(portuguese[ROLE_HINT.admin]).toBe("Vê e muda tudo, inclusive os gastos.");
    expect(portuguese[ROLE_HINT.member]).toBe("Conversa com os agentes e decide sobre o que lhe pertence.");
    expect(portuguese[ROLE_HINT.guest]).toBe("Só conversa nos canais em que a pessoa for incluída.");
    for (const role of ASSIGNABLE_ROLES) {
      expect(portuguese[ROLE_LABEL[role]]).not.toContain("—");
      expect(portuguese[ROLE_HINT[role]]).not.toContain("—");
    }
  });
});
