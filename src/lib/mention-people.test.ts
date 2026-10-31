import { describe, expect, it } from "vitest";

import type { DirectoryPerson } from "../../shared/people";
import { mentionablePeople, personMentionChoices } from "./mention-people";
import { mentionChoicesForQuery, mentionClassName, mentionRanges, remarkMentions } from "./mentions";

const directory: DirectoryPerson[] = [
  { email: "ana.paula@acme.test", name: "Ana Paula", role: "admin" },
  { email: "bruno@acme.test", name: "Bruno", role: "member" },
  { email: "carla@acme.test", name: "Carla Dias", role: "member" },
  { email: "gil@acme.test", name: "Gil", role: "guest" },
];
const names = (people: ReadonlyArray<{ name: string }>) => people.map((person) => person.name);

describe("who can be called by name in a channel", () => {
  it("is exactly the people a limited channel lists, guests included", () => {
    expect(names(mentionablePeople({ people: ["bruno@acme.test", "gil@acme.test"] }, directory))).toEqual(["Bruno", "Gil"]);
  });

  it("names a listed address that left the directory by what the address suggests", () => {
    expect(mentionablePeople({ people: ["maria.souza@elsewhere.test"] }, directory)).toEqual([{ email: "maria.souza@elsewhere.test", name: "Maria Souza" }]);
  });

  it("is the whole team, guests apart, in a channel with no list", () => {
    expect(names(mentionablePeople({}, directory))).toEqual(["Ana Paula", "Bruno", "Carla Dias"]);
    expect(names(mentionablePeople({ people: [] }, directory))).toEqual(["Ana Paula", "Bruno", "Carla Dias"]);
  });

  it("is the whole team in the general channel, whatever list it carries", () => {
    expect(names(mentionablePeople({ general: true, people: ["bruno@acme.test"] }, directory))).toEqual(["Ana Paula", "Bruno", "Carla Dias"]);
  });

  it("is nobody in a chat with one agent, or outside a channel", () => {
    expect(mentionablePeople({ dm: true, people: ["bruno@acme.test"] }, directory)).toEqual([]);
    expect(mentionablePeople(undefined, directory)).toEqual([]);
  });
});

describe("the @ list with people", () => {
  const bots = [{ id: "b1", name: "Atlas", bot: {} }, { id: "b2", name: "Ana Bot", bot: {} }];
  const pool = [{ id: "__everyone__", name: "everyone" }, ...bots, ...personMentionChoices(mentionablePeople({}, directory), "bruno@acme.test")];

  it("offers several people beside the agents, and leaves the viewer out", () => {
    expect(names(personMentionChoices(mentionablePeople({}, directory), "bruno@acme.test"))).toEqual(["Ana Paula", "Carla Dias"]);
    expect(personMentionChoices(mentionablePeople({}, directory), undefined)).toHaveLength(3);
    expect(personMentionChoices([{ name: "Ana", email: "ana@acme.test" }], undefined)[0]).toEqual({ id: "person:ana@acme.test", name: "Ana", person: { name: "Ana", email: "ana@acme.test" } });
  });

  it("filters people and agents by what was typed after the @", () => {
    expect(names(mentionChoicesForQuery(pool, "ana"))).toEqual(["Ana Bot", "Ana Paula"]);
    expect(names(mentionChoicesForQuery(pool, "car"))).toEqual(["Carla Dias"]);
    expect(names(mentionChoicesForQuery(pool, ""))).toHaveLength(5);
  });

  it("has no people at all where none can be named", () => {
    const botsOnly = [...bots, ...personMentionChoices(mentionablePeople({ dm: true }, directory), undefined)];
    expect(names(botsOnly)).toEqual(["Atlas", "Ana Bot"]);
  });
});

describe("colleagues named in a message", () => {
  const people = mentionablePeople({}, directory);
  const written = (text: string, peers: Array<{ name: string }> = []) => mentionRanges(text, peers, false, undefined, people).map(({ start, end, personEmail }) => ({ text: text.slice(start, end), personEmail }));

  it("marks several people in one message, by whole name or first name", () => {
    expect(written("@Ana Paula, @bruno e @Carla pode ver?")).toEqual([
      { text: "@Ana Paula", personEmail: "ana.paula@acme.test" },
      { text: "@bruno", personEmail: "bruno@acme.test" },
      { text: "@Carla", personEmail: "carla@acme.test" },
    ]);
  });

  it("does not mark a first name two people share, nor a partial or longer word", () => {
    const twins = [{ name: "Ana Paula", email: "a@x.test" }, { name: "Ana Costa", email: "b@x.test" }];
    expect(mentionRanges("@Ana @Ana Costa @Anabel", [], false, undefined, twins).map(({ start, end }) => "@Ana @Ana Costa @Anabel".slice(start, end))).toEqual(["@Ana Costa"]);
    expect(written("me@bruno.test @Brunoo @Bru")).toEqual([]);
  });

  it("lets an agent with the same or a longer name keep the tag, and a person with the longer name win", () => {
    const text = "@Ana Paula pede ao @Ana";
    const sameName = mentionRanges(text, [{ name: "Ana Paula", id: "bot1" }], false, undefined, people);
    expect(sameName[0]).toMatchObject({ botId: "bot1" });
    expect(sameName[0]).not.toHaveProperty("personEmail");
    const shorter = mentionRanges(text, [{ name: "Ana", id: "bot2" }], false, undefined, people);
    expect(shorter[0]).toMatchObject({ personEmail: "ana.paula@acme.test" });
    expect(shorter[1]).toMatchObject({ botId: "bot2" });
  });

  it("marks nobody when the channel has no people to name", () => {
    expect(mentionRanges("@Bruno", [], false, undefined, [])).toEqual([]);
    expect(mentionRanges("@Bruno", [], false)).toEqual([]);
  });

  it("styles a colleague apart from the viewer", () => {
    expect(mentionClassName({ personEmail: "bruno@acme.test" })).toBe("mention-highlight mention-colleague");
    expect(mentionClassName({ you: true })).toBe("mention-highlight mention-you");
    expect(mentionClassName({})).toBe("mention-highlight");
  });

  it("turns a colleague in a rendered message into a styled span", () => {
    const tree = { type: "root", children: [{ type: "paragraph", children: [{ type: "text", value: "oi @Bruno, tudo bem?" }] }] };
    remarkMentions({ peers: [], people })(tree);
    const paragraph = tree.children[0]!.children as Array<{ type: string; value?: string; data?: { hProperties: { className: string } }; children?: Array<{ value: string }> }>;
    expect(paragraph.map((node) => node.type)).toEqual(["text", "mention", "text"]);
    expect(paragraph[1]!.data!.hProperties.className).toBe("mention-highlight mention-colleague");
    expect(paragraph[1]!.children![0]!.value).toBe("@Bruno");
  });
});
