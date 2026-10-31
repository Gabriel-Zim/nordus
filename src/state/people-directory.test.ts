import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const server = vi.hoisted(() => ({ body: [] as unknown, fail: false, calls: [] as Array<{ path: string; background?: boolean }> }));
vi.mock("./api", () => ({
  api: async (path: string, init?: { background?: boolean }) => {
    server.calls.push({ path, background: init?.background });
    if (server.fail) throw new Error("offline");
    return server.body;
  },
}));

import { directorySnapshot, loadDirectory, matchPeople, parseDirectory, personNamed, resetDirectory } from "./people-directory";

const people = parseDirectory([
  { email: "ana.paula@acme.test", name: "Ana Paula", role: "admin" },
  { email: "bruno@acme.test", name: "", role: "member" },
  { email: "gil@acme.test", name: "Gil Convidado", role: "guest" },
]);

beforeEach(() => {
  resetDirectory();
  server.body = [];
  server.fail = false;
  server.calls = [];
});
afterEach(() => resetDirectory());

describe("the people directory", () => {
  it("reads a bare list and keeps only addresses with a known role, each once, by name", () => {
    expect(parseDirectory([
      { email: "Zed@acme.test", name: "Zed", role: "member" },
      { email: "zed@acme.test", name: "Zed again", role: "admin" },
      { email: "not an address", name: "Nobody", role: "member" },
      { email: "ann@acme.test", name: "Ann", role: "owner" },
      { email: "amy@acme.test", name: "Amy", role: "guest" },
      "junk",
      null,
    ])).toEqual([
      { email: "amy@acme.test", name: "Amy", role: "guest" },
      { email: "zed@acme.test", name: "Zed", role: "member" },
    ]);
    expect(parseDirectory({ people: [] })).toEqual([]);
  });

  it("names a person by the address when they gave no name", () => {
    expect(people.map((person) => person.name)).toEqual(["Ana Paula", "Bruno", "Gil Convidado"]);
  });

  it("finds a name by address, and falls back to what the address suggests", () => {
    expect(personNamed(people, "ANA.PAULA@acme.test")).toBe("Ana Paula");
    expect(personNamed(people, "maria.souza@elsewhere.test")).toBe("Maria Souza");
    expect(personNamed(people, undefined)).toBe("");
  });

  it("matches every word typed against the name and the address", () => {
    expect(matchPeople(people, "").map((person) => person.email)).toHaveLength(3);
    expect(matchPeople(people, "ana pau").map((person) => person.email)).toEqual(["ana.paula@acme.test"]);
    expect(matchPeople(people, "ACME bruno").map((person) => person.email)).toEqual(["bruno@acme.test"]);
    expect(matchPeople(people, "nobody here")).toEqual([]);
  });

  it("loads once and shares the answer, unless asked again", async () => {
    server.body = [{ email: "ana@acme.test", name: "Ana", role: "admin" }];
    await loadDirectory({ background: true });
    await loadDirectory({ background: true });
    expect(server.calls).toEqual([{ path: "/api/people/directory", background: true }]);
    await loadDirectory({ force: true });
    expect(server.calls).toHaveLength(2);
  });

  it("keeps what it had when the server cannot be reached", async () => {
    server.body = [{ email: "ana@acme.test", name: "Ana", role: "admin" }];
    await loadDirectory();
    server.fail = true;
    await loadDirectory({ force: true });
    expect(directorySnapshot()).toEqual({ loaded: true, people: [{ email: "ana@acme.test", name: "Ana", role: "admin" }] });
  });

  it("starts empty and unloaded after a reset", async () => {
    server.body = [{ email: "ana@acme.test", name: "Ana", role: "admin" }];
    await loadDirectory();
    resetDirectory();
    expect(directorySnapshot()).toEqual({ loaded: false, people: [] });
  });
});
