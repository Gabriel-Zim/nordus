import { describe, expect, it } from "vitest";

import { mentionedPeople, personMentionAliases, personMentionExcerpt, personMentions } from "./person-mention.ts";

const ANA = { name: "Ana Paula", email: "ana@x.test" };
const BRUNO = { name: "Bruno Lima", email: "bruno@x.test" };
const BIA = { name: "Bia", email: "bia@x.test" };
const BRUNO_TWO = { name: "Bruno Costa", email: "bruno.costa@x.test" };

describe("calling people by name", () => {
  it("finds several people in one message, once each, by full name or first name", () => {
    const text = "@Ana Paula revisa isso, e @Bruno Lima confirma. Valeu @Ana!";
    expect(mentionedPeople(text, [ANA, BRUNO, BIA])).toEqual([ANA.email, BRUNO.email]);
  });

  it("carries the line that names each person", () => {
    const [mention] = personMentions("Bom dia.\n@Bia olha o relatório de hoje?\nObrigado.", [BIA]);
    expect(mention).toEqual({ email: BIA.email, excerpt: expect.stringContaining("@Bia olha o relatório") });
  });

  it("does not guess between two people who share a first name", () => {
    expect(mentionedPeople("@Bruno pode ver?", [BRUNO, BRUNO_TWO])).toEqual([]);
    expect(mentionedPeople("@Bruno Costa pode ver?", [BRUNO, BRUNO_TWO])).toEqual([BRUNO_TWO.email]);
    expect(personMentionAliases([BRUNO, BRUNO_TWO]).map((entry) => entry.alias)).toEqual(["Bruno Lima", "Bruno Costa"]);
  });

  it("lets an agent with the same name keep its tag", () => {
    expect(mentionedPeople("@Bia faz isso", [BIA], { botNames: ["Bia"] })).toEqual([]);
    expect(mentionedPeople("@Bia faz isso", [BIA], { botNames: ["Bianca"] })).toEqual([BIA.email]);
    expect(mentionedPeople("@Bia Silva faz isso", [BIA], { botNames: ["Bia Silva"] })).toEqual([]);
  });

  it("ignores an address, code and a name without the @", () => {
    expect(mentionedPeople("escreva para bia@x.test", [BIA])).toEqual([]);
    expect(mentionedPeople("```\n@Bia\n```", [BIA])).toEqual([]);
    expect(mentionedPeople("a Bia viu", [BIA])).toEqual([]);
    expect(mentionedPeople("@Biancas não", [BIA])).toEqual([]);
  });

  it("never treats a word everyone uses as someone's name", () => {
    expect(mentionedPeople("@todos olhem", [{ name: "Todos", email: "todos@x.test" }])).toEqual([]);
  });
});

describe("a message built to stall the server", () => {
  const BLANK_LINES = "x\n\n".repeat(66_000);
  const took = (run: () => unknown): number => {
    const started = performance.now();
    run();
    return performance.now() - started;
  };

  it("is read in well under a second when its only tag comes after a long run of blank lines", () => {
    const text = `${BLANK_LINES}@Bia`;
    expect(took(() => personMentions(text, [BIA]))).toBeLessThan(500);
    expect(took(() => personMentionExcerpt(`${BLANK_LINES}@you`))).toBeLessThan(500);
  });

  it("still finds a person tagged early in a very long message, with the line around the tag and no more", () => {
    const text = `Oi\n\n@Bia olha o relatório de hoje?\n\n${BLANK_LINES}`;
    const [mention] = personMentions(text, [BIA]);
    expect(mention).toEqual({ email: BIA.email, excerpt: "@Bia olha o relatório de hoje?" });
  });

  it("quotes a bounded stretch around the tag when the tag sits in a very long line", () => {
    const text = `${"y".repeat(5_000)} @Bia ${"z".repeat(5_000)}`;
    const [mention] = personMentions(text, [BIA]);
    expect(mention!.excerpt).toContain("@Bia");
    expect(mention!.excerpt.length).toBeLessThan(1_000);
  });

  it("does not look for tags past the first fifty thousand characters", () => {
    expect(mentionedPeople(`${"a ".repeat(20_000)}@Bia`, [BIA])).toEqual([BIA.email]);
    expect(mentionedPeople(`${"a ".repeat(30_000)}@Bia`, [BIA])).toEqual([]);
  });

  it("names at most twenty people from one message", () => {
    const crowd = Array.from({ length: 30 }, (_, index) => ({ name: `Pessoa${String.fromCharCode(97 + (index % 26))}${index}`, email: `p${index}@x.test` }));
    const text = crowd.map((person) => `@${person.name}`).join(" ");
    expect(personMentions(text, crowd)).toHaveLength(20);
  });
});
