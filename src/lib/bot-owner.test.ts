import { describe, expect, it } from "vitest";

import type { DirectoryPerson } from "../../shared/people";
import { ADMINS_VALUE, botRole, ownerChoices, ownerPatch, ownerRowMode, ownerValue } from "./bot-owner";

const directory: DirectoryPerson[] = [
  { email: "ana@acme.test", name: "Ana", role: "admin" },
  { email: "bruno@acme.test", name: "Bruno", role: "member" },
  { email: "gil@acme.test", name: "Gil", role: "guest" },
];

describe("who an agent can answer to", () => {
  it("starts with the administrators, then lists admins and members, never a guest", () => {
    expect(ownerChoices(directory, undefined)).toEqual([
      { value: ADMINS_VALUE },
      { value: "ana@acme.test", name: "Ana", email: "ana@acme.test" },
      { value: "bruno@acme.test", name: "Bruno", email: "bruno@acme.test" },
    ]);
  });

  it("keeps a saved owner who is no longer in the directory, under the address", () => {
    const choices = ownerChoices(directory, "Maria@Elsewhere.test");
    expect(choices.at(-1)).toEqual({ value: "maria@elsewhere.test", name: "maria@elsewhere.test", email: "maria@elsewhere.test" });
    expect(choices).toHaveLength(4);
  });

  it("does not list a saved owner twice", () => {
    expect(ownerChoices(directory, "bruno@acme.test")).toHaveLength(3);
  });

  it("keeps a saved owner who became a guest, under their name", () => {
    expect(ownerChoices(directory, "gil@acme.test").at(-1)).toEqual({ value: "gil@acme.test", name: "Gil", email: "gil@acme.test" });
  });

  it("offers only the administrators when nobody else is there", () => {
    expect(ownerChoices([], undefined)).toEqual([{ value: ADMINS_VALUE }]);
  });
});

describe("saving who answers for an agent", () => {
  it("reads no owner as the administrators, and an address as itself", () => {
    expect(ownerValue(undefined)).toBe(ADMINS_VALUE);
    expect(ownerValue("")).toBe(ADMINS_VALUE);
    expect(ownerValue("Bruno@Acme.test")).toBe("bruno@acme.test");
  });

  it("sends null for the administrators and the address for a person", () => {
    expect(ownerPatch(ADMINS_VALUE)).toEqual({ owner: null });
    expect(ownerPatch("bruno@acme.test")).toEqual({ owner: "bruno@acme.test" });
  });
});

describe("what the settings of an agent show a person", () => {
  const bot = { owner: "bruno@acme.test" };

  it("lets an admin change everything, even on an agent that someone else answers for", () => {
    expect(botRole({ admin: true, guest: false, email: "ana@acme.test" }, bot)).toBe("admin");
    expect(botRole({ admin: true, guest: false, email: "bruno@acme.test" }, bot)).toBe("admin");
  });

  it("gives the person it answers to the owner's settings, address in any case", () => {
    expect(botRole({ admin: false, guest: false, email: "Bruno@acme.test" }, bot)).toBe("owner");
  });

  it("gives everyone else the usual panel", () => {
    expect(botRole({ admin: false, guest: false, email: "carla@acme.test" }, bot)).toBe("viewer");
    expect(botRole({ admin: false, guest: false }, bot)).toBe("viewer");
    expect(botRole({ admin: false, guest: false, email: "bruno@acme.test" }, {})).toBe("viewer");
  });

  it("never treats a guest as the owner", () => {
    expect(botRole({ admin: false, guest: true, email: "bruno@acme.test" }, bot)).toBe("viewer");
  });
});

describe("the Responsible row", () => {
  const choices = ownerChoices(directory, undefined);

  it("is a picker for an admin when there is someone besides themselves to pick", () => {
    expect(ownerRowMode({ admin: true, guest: false }, choices, undefined)).toBe("edit");
    expect(ownerRowMode({ admin: true, guest: false }, ownerChoices([], undefined), undefined)).toBe("none");
  });

  it("stays out of the way of a workspace with one person in it, unless an owner is set and can be taken off", () => {
    const alone = ownerChoices([directory[0]!], undefined);
    expect(ownerRowMode({ admin: true, guest: false }, alone, undefined)).toBe("none");
    expect(ownerRowMode({ admin: true, guest: false }, ownerChoices([directory[0]!], "ana@acme.test"), "ana@acme.test")).toBe("edit");
  });

  it("only says who answers for the agent to everyone else, and says nothing when it is the administrators", () => {
    expect(ownerRowMode({ admin: false, guest: false }, choices, "bruno@acme.test")).toBe("read");
    expect(ownerRowMode({ admin: false, guest: false }, choices, undefined)).toBe("none");
  });

  it("says nothing to a guest", () => {
    expect(ownerRowMode({ admin: false, guest: true }, choices, "bruno@acme.test")).toBe("none");
  });
});
