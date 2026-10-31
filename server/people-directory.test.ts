import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PeopleDirectory, type DirectoryDeps } from "./people-directory.ts";

const lists = { admins: ["boss@x.test", "@agency.test"], members: ["ada@x.test", "bob@x.test", "@team.test"], guests: ["gus@x.test"] };

let dir: string;
let file: string;
const make = (over: Partial<DirectoryDeps> = {}) => new PeopleDirectory({
  file, lists: () => lists, signedIn: () => [], profile: () => ({}), shareRoom: () => false, ...over,
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nordus-directory-"));
  file = join(dir, "people.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("who the directory lists", () => {
  it("lists each address on the sign-in lists once, with its role and a name from the address", () => {
    expect(make().everyone()).toEqual([
      { email: "ada@x.test", name: "Ada", role: "member" },
      { email: "bob@x.test", name: "Bob", role: "member" },
      { email: "boss@x.test", name: "Boss", role: "admin" },
      { email: "gus@x.test", name: "Gus", role: "guest" },
    ]);
  });

  it("uses the name a person gave, and keeps it after a restart", () => {
    const directory = make();
    directory.remember("ADA@x.test", "  Ada Lima ");
    expect(directory.nameOf("ada@x.test")).toBe("Ada Lima");
    directory.flush();
    const again = make();
    expect(again.everyone().find((person) => person.email === "ada@x.test")?.name).toBe("Ada Lima");
  });

  it("ignores a name for something that is not an address, or an empty one", () => {
    const directory = make();
    directory.remember("not an address", "Someone");
    directory.remember("ada@x.test", "   ");
    directory.remember(undefined, "Nobody");
    expect(directory.nameOf("ada@x.test")).toBe("Ada");
    expect(directory.everyone()).toHaveLength(4);
  });

  it("adds people who signed in under a @domain entry, with the role that domain gives", () => {
    const directory = make({ signedIn: () => [{ email: "New@team.test", name: "New Person" }, { email: "x@agency.test" }, { email: "stranger@elsewhere.test", name: "Out" }] });
    directory.remember("new@team.test", "New Person");
    const people = directory.everyone();
    expect(people.find((person) => person.email === "new@team.test")).toEqual({ email: "new@team.test", name: "New Person", role: "member" });
    expect(people.find((person) => person.email === "x@agency.test")?.role).toBe("admin");
    expect(people.some((person) => person.email === "stranger@elsewhere.test")).toBe(false);
  });

  it("forgets a person who left the lists, and counts the desktop owner as an admin", () => {
    const directory = make({ profile: () => ({ email: "Owner@x.test", name: "Dona da Casa" }) });
    directory.remember("gone@x.test", "Gone");
    const people = directory.everyone();
    expect(people.some((person) => person.email === "gone@x.test")).toBe(false);
    expect(people.find((person) => person.email === "owner@x.test")).toEqual({ email: "owner@x.test", name: "Dona da Casa", role: "admin" });
  });

  it("carries no spend and no last seen: only address, name and role", () => {
    for (const person of make().everyone()) expect(Object.keys(person).sort()).toEqual(["email", "name", "role"]);
  });

  it("knows the role of any address", () => {
    const directory = make();
    expect(directory.roleOf("ADA@x.test")).toBe("member");
    expect(directory.roleOf("anyone@agency.test")).toBe("admin");
    expect(directory.roleOf("gus@x.test")).toBe("guest");
    expect(directory.roleOf("nobody@x.test")).toBeNull();
    expect(directory.roleOf("nonsense")).toBeNull();
  });

  it("reads a name off an address until the person gives one", () => {
    expect(make().nameOf("ana.paula@acme.com")).toBe("Ana Paula");
  });
});

describe("who a viewer may see and write to", () => {
  const sharing = (a: string, b: string) => [a, b].sort().join("|") === "ada@x.test|gus@x.test";

  it("shows an admin or a member everyone", () => {
    const directory = make({ shareRoom: sharing });
    expect(directory.forViewer({ email: "ada@x.test", admin: false, guest: false })).toHaveLength(4);
    expect(directory.forViewer({ email: "boss@x.test", admin: true, guest: false })).toHaveLength(4);
  });

  it("shows a guest only themselves and the people who share a room with them", () => {
    const directory = make({ shareRoom: sharing });
    const seen = directory.forViewer({ email: "gus@x.test", admin: false, guest: true });
    expect(seen.map((person) => person.email)).toEqual(["ada@x.test", "gus@x.test"]);
    expect(directory.forViewer({ admin: false, guest: true })).toEqual([]);
  });

  it("lets a guest write only to the people they can see", () => {
    const directory = make({ shareRoom: sharing });
    const guest = { email: "gus@x.test", admin: false, guest: true };
    expect(directory.mayReach(guest, "ada@x.test")).toBe(true);
    expect(directory.mayReach(guest, "bob@x.test")).toBe(false);
    expect(directory.mayReach(guest, "boss@x.test")).toBe(false);
    const member = { email: "ada@x.test", admin: false, guest: false };
    expect(directory.mayReach(member, "bob@x.test")).toBe(true);
    expect(directory.mayReach(member, "stranger@x.test")).toBe(false);
  });
});
