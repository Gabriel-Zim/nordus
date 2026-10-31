import { describe, expect, it } from "vitest";

import { accessForBot, accessForViewer, clientsOfConversation, clientSpace, describeSpace, parseSpace, spaceFolder, spaceOfBot, spaceOfConversation, type ConversationFacts } from "./audience.ts";
import { ana, botAsker, gerentedeoperacao, inputsFor, member, roster } from "./testing.ts";

describe("spaces", () => {
  it("names a space for the company or for one client, and nothing else", () => {
    expect(parseSpace("internal")).toBe("internal");
    expect(parseSpace("client:evergreen")).toBe("client:evergreen");
    for (const bad of ["client:", "client:../x", "client:a/b", "clients:evergreen", "", undefined, 7, "client:UPPER space"]) expect(parseSpace(bad)).toBeNull();
    expect(clientSpace("..")).toBeNull();
    expect(describeSpace("client:evergreen")).toEqual({ id: "client:evergreen", kind: "client", client: "evergreen" });
  });

  it("keeps every space in its own folder under the root", () => {
    expect(spaceFolder("internal")).toBe("internal");
    expect(spaceFolder("client:evergreen")).toBe("clients/evergreen");
  });

  it("puts an agent with a client in that client's space, even an internal one", () => {
    expect(spaceOfBot({ client: "evergreen" }, false)).toBe("client:evergreen");
    expect(spaceOfBot({ client: "evergreen" }, true)).toBe("client:evergreen");
    expect(spaceOfBot({}, true)).toBe("internal");
  });

  it("gives an agent that is neither internal nor a client's no space at all", () => {
    expect(spaceOfBot({}, false)).toBeNull();
    expect(spaceOfBot({ client: "bad slug" }, true)).toBeNull();
  });
});

describe("who may use which space", () => {
  it("lets an admin use the company's space, every client's and any that already exist on disk", () => {
    const access = accessForViewer({ kind: "all" }, { ...inputsFor(), known: () => ["client:old"] });
    expect(access.admin).toBe(true);
    expect(access.spaces()).toEqual(["internal", "client:evergreen", "client:fabrikam", "client:old"]);
    expect(access.allows("client:fabrikam")).toBe(true);
  });

  it("lets a member use only the spaces of the client agents shown to them", () => {
    const beto = accessForViewer({ kind: "member", email: "BETO@evergreen.test" }, inputsFor());
    expect(beto.admin).toBe(false);
    expect(beto.spaces()).toEqual(["client:evergreen"]);
    expect(beto.allows("client:fabrikam")).toBe(false);
    expect(beto.allows("internal")).toBe(false);
    const outsider = accessForViewer({ kind: "member", email: "who@else.test" }, inputsFor());
    expect(outsider.spaces()).toEqual([]);
  });

  it("shows nobody a space through an agent that is hidden from them", () => {
    const onlyHidden = [roster.find((bot) => bot.id === "secret")!];
    expect(accessForViewer({ kind: "member", email: "ana@zorg.test" }, inputsFor(onlyHidden)).spaces()).toEqual([]);
  });

  it("confines an agent to its own space", () => {
    expect(botAsker("gerentedeoperacao").access.spaces()).toEqual(["internal"]);
    expect(botAsker("evergreen-bot").access.spaces()).toEqual(["client:evergreen"]);
    expect(botAsker("evergreen-bot").access.allows("internal")).toBe(false);
    expect(botAsker("evergreen-bot").access.allows("client:fabrikam")).toBe(false);
  });

  it("fails closed for an agent with no space, and for one that no longer exists", () => {
    expect(botAsker("loose").access.spaces()).toEqual([]);
    expect(botAsker("loose").access.allows("internal")).toBe(false);
    const gone = accessForBot("gone", inputsFor());
    expect(gone.spaces()).toEqual([]);
    expect(gone.allows("internal")).toBe(false);
    expect(gone.sees(gerentedeoperacao)).toBe(false);
  });
});

describe("whose work may be seen", () => {
  it("shows a member what people wrote and what agents they can see wrote", () => {
    const beto = member("beto@evergreen.test", ana).access;
    expect(beto.sees(ana)).toBe(true);
    expect(beto.sees({ kind: "bot", id: "gerentedeoperacao", name: "GerenteDeOperacao" })).toBe(true);
    expect(beto.sees({ kind: "bot", id: "secret", name: "Secret" })).toBe(false);
    expect(beto.sees({ kind: "bot", id: "fabrikam-bot", name: "Fabrikam Bot" })).toBe(false);
  });

  it("keeps hiding what an agent wrote after the agent is deleted", () => {
    const beto = member("beto@evergreen.test", ana).access;
    expect(beto.sees({ kind: "bot", id: "deleted", name: "Old", visibility: "admins" })).toBe(false);
    expect(beto.sees({ kind: "bot", id: "deleted", name: "Old", visibility: { people: ["beto@evergreen.test"] } })).toBe(true);
    expect(beto.sees({ kind: "bot", id: "deleted", name: "Old" })).toBe(true);
  });

  it("shows an admin everything", () => {
    expect(member("x@y.test", ana).access.admin).toBe(false);
    const admin = accessForViewer({ kind: "all" }, inputsFor());
    expect(admin.sees({ kind: "bot", id: "secret", name: "Secret" })).toBe(true);
    expect(admin.sees({ kind: "bot", id: "unknown", name: "?", visibility: "admins" })).toBe(true);
  });

  it("lets an agent read what people and itself wrote, and what agents with a wider audience wrote", () => {
    const evergreen = botAsker("evergreen-bot").access;
    expect(evergreen.sees(ana)).toBe(true);
    expect(evergreen.sees({ kind: "bot", id: "evergreen-bot", name: "EVERGREEN Bot" })).toBe(true);
    expect(evergreen.sees({ kind: "bot", id: "gerentedeoperacao", name: "GerenteDeOperacao" })).toBe(true);
    expect(botAsker("secret").access.sees({ kind: "bot", id: "gerentedeoperacao", name: "GerenteDeOperacao" })).toBe(true);
  });

  it("keeps an agent from reading what a narrower audience wrote, which would pass it to people who could not see the author", () => {
    const gerentedeoperacao = botAsker("gerentedeoperacao").access;
    expect(gerentedeoperacao.sees({ kind: "bot", id: "evergreen-bot", name: "EVERGREEN Bot" })).toBe(false);
    expect(gerentedeoperacao.sees({ kind: "bot", id: "secret", name: "Secret" })).toBe(false);
    expect(gerentedeoperacao.sees({ kind: "bot", id: "deleted", name: "Old", visibility: "admins" })).toBe(false);
  });
});

describe("the company's space belongs to admins until one opens it", () => {
  it("does not hand it to a member because a company agent is shown to them", () => {
    const ana = accessForViewer({ kind: "member", email: "ana@zorg.test" }, inputsFor());
    expect(ana.allows("internal")).toBe(false);
    expect(ana.spaces()).toEqual([]);
  });

  it("opens it only to the people an admin named, ignoring case, and only to them", () => {
    const named = accessForViewer({ kind: "member", email: "Ana@Zorg.test" }, inputsFor(roster, () => [], ["ana@zorg.test"]));
    expect(named.spaces()).toEqual(["internal"]);
    expect(named.allows("internal")).toBe(true);
    const other = accessForViewer({ kind: "member", email: "carla@zorg.test" }, inputsFor(roster, () => [], ["ana@zorg.test"]));
    expect(other.allows("internal")).toBe(false);
  });

  it("matches a whole address, never a domain or a part of one", () => {
    for (const listed of ["@zorg.test", "zorg.test", "na@zorg.test", "ana@zorg.test.evil", "*"]) {
      expect(accessForViewer({ kind: "member", email: "ana@zorg.test" }, inputsFor(roster, () => [], [listed])).allows("internal"), listed).toBe(false);
    }
    expect(accessForViewer({ kind: "member" }, inputsFor(roster, () => [], [""])).allows("internal")).toBe(false);
  });

  it("keeps a named person out of a client's space they have no agent for", () => {
    const named = accessForViewer({ kind: "member", email: "beto@evergreen.test" }, inputsFor(roster, () => [], ["beto@evergreen.test"]));
    expect(named.spaces()).toEqual(["internal", "client:evergreen"]);
    expect(named.allows("client:fabrikam")).toBe(false);
  });
});

describe("an agent's space follows the conversation it is in", () => {
  const space = (id: string, clients: readonly string[]) => botAsker(id, roster, clients).access.spaces();

  it("keeps a company agent in the company's space when the conversation is about no client", () => {
    expect(space("gerentedeoperacao", [])).toEqual(["internal"]);
  });

  it("moves a company agent into the client's space when the conversation is about one", () => {
    expect(space("gerentedeoperacao", ["fabrikam"])).toEqual(["client:fabrikam"]);
    expect(space("gerentedeoperacao", ["evergreen", "evergreen"])).toEqual(["client:evergreen"]);
    expect(botAsker("gerentedeoperacao", roster, ["fabrikam"]).access.allows("internal")).toBe(false);
  });

  it("gives a company agent no space, and says why, when the conversation is about several clients", () => {
    const access = botAsker("gerentedeoperacao", roster, ["fabrikam", "evergreen"]).access;
    expect(access.spaces()).toEqual([]);
    expect(access.allows("internal")).toBe(false);
    expect(access.allows("client:fabrikam")).toBe(false);
    expect(access.closed).toMatch(/more than one client/);
  });

  it("gives a company agent no space for a client name that is not a valid one", () => {
    expect(space("gerentedeoperacao", ["../internal"])).toEqual([]);
  });

  it("keeps a client's agent in its own client's space whatever the conversation names", () => {
    expect(space("evergreen-bot", ["fabrikam"])).toEqual(["client:evergreen"]);
    expect(space("evergreen-bot", ["fabrikam", "evergreen"])).toEqual(["client:evergreen"]);
    expect(space("loose", ["fabrikam"])).toEqual([]);
  });

  it("counts the client written on a company agent as one of the conversation's clients", () => {
    const tagged = [{ id: "gerentedeoperacao", name: "GerenteDeOperacao", internal: true, client: "evergreen" }];
    expect(accessForBot("gerentedeoperacao", inputsFor(tagged)).spaces()).toEqual(["client:evergreen"]);
    expect(accessForBot("gerentedeoperacao", inputsFor(tagged), ["fabrikam"]).spaces()).toEqual([]);
  });
});

describe("the space a conversation saves to", () => {
  const facts = (extra: Partial<ConversationFacts> = {}): ConversationFacts => ({ members: ["gerentedeoperacao"], named: [], inherited: [], ...extra });
  const where = (extra: Partial<ConversationFacts> = {}, bots = roster) => spaceOfConversation(facts(extra), inputsFor(bots)).space;

  it("is the room's client whatever else the conversation names", () => {
    expect(where({ roomClient: "evergreen", named: ["fabrikam"] })).toBe("client:evergreen");
    expect(clientsOfConversation(facts({ roomClient: "evergreen", named: ["fabrikam"], inherited: ["lumon"] }))).toEqual(["evergreen"]);
  });

  it("follows the clients a chat named or a delegated turn inherited", () => {
    expect(where()).toBe("internal");
    expect(where({ named: ["fabrikam"] })).toBe("client:fabrikam");
    expect(where({ inherited: ["evergreen"] })).toBe("client:evergreen");
    expect(where({ named: ["fabrikam"], inherited: ["evergreen"] })).toBeNull();
  });

  it("is nowhere for a chat that names several clients, and says why", () => {
    const decided = spaceOfConversation(facts({ named: ["fabrikam", "evergreen"] }), inputsFor());
    expect(decided.space).toBeNull();
    expect(decided.closed).toMatch(/more than one client/);
  });

  it("is a client agent's own client, and nowhere for an agent that has none and is not the company's", () => {
    expect(where({ members: ["evergreen-bot"] })).toBe("client:evergreen");
    expect(where({ members: ["loose"] })).toBeNull();
    expect(where({ members: ["gone"] })).toBeNull();
  });

  it("is nowhere for a room whose agents work in different places", () => {
    expect(where({ members: ["gerentedeoperacao", "evergreen-bot"] })).toBeNull();
    expect(where({ members: ["gerentedeoperacao", "secret"] })).toBe("internal");
    expect(where({ members: ["evergreen-bot", "loose"] })).toBeNull();
  });
});
