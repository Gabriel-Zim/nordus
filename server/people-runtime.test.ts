import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AppConfig } from "./config.ts";
import { createPeopleRuntime } from "./people-runtime.ts";
import type { RequestAuth } from "./request-auth.ts";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "nordus-people-runtime-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const lists = { admins: ["boss@x.test"], members: ["ada@x.test", "bob@x.test"], guests: ["gus@x.test"] };
const member = (email: string | undefined, admin = false): RequestAuth =>
  ({ kind: "session", via: "bearer", scopes: admin ? ["admin", "client"] : ["client"], session: { id: "s", email } }) as unknown as RequestAuth;

function make(over: { profile?: AppConfig["profile"]; groups?: Array<{ people?: string[] }> } = {}) {
  let issued: ((session: { email?: string; name?: string }) => void) | undefined;
  const sessions = {
    list: () => [{ email: "ada@x.test", name: "Ada Lima" }],
    onSessionIssued: (listener: (session: { email?: string; name?: string }) => void) => { issued = listener; return () => {}; },
  };
  const runtime = createPeopleRuntime({
    dataDir: dir, cfg: () => ({ profile: over.profile }) as AppConfig, sessions: sessions as never, lists: () => lists,
    store: { groups: over.groups ?? [] } as never,
  });
  return { runtime, signIn: (session: { email?: string; name?: string }) => issued?.(session) };
}

describe("who someone is as a person", () => {
  it("is the address they signed in with", () => {
    const { runtime } = make();
    expect(runtime.emailOf(member(" ADA@x.test "))).toBe("ada@x.test");
    expect(runtime.emailOf(member("boss@x.test", true))).toBe("boss@x.test");
  });

  it("is the owner's profile address on a desktop that never asked for one, and nobody for a member without an address", () => {
    const { runtime } = make({ profile: { name: "Dona", email: "Dona@x.test" } as AppConfig["profile"] });
    expect(runtime.emailOf({ kind: "loopback", scopes: ["admin", "client"] })).toBe("dona@x.test");
    expect(runtime.emailOf(member(undefined))).toBeUndefined();
    expect(make().runtime.emailOf({ kind: "loopback", scopes: ["admin", "client"] })).toBeUndefined();
  });

  it("is nobody for an admin session that carries no address, whatever address the profile holds", () => {
    const { runtime } = make({ profile: { name: "Dona", email: "bob@x.test" } as AppConfig["profile"] });
    expect(runtime.emailOf(member(undefined, true))).toBeUndefined();
    expect(runtime.emailOf({ kind: "loopback", scopes: ["client"], trust: "service" })).toBeUndefined();
    expect(runtime.emailOf({ kind: "loopback", scopes: ["admin", "client"] })).toBe("bob@x.test");
  });
});

describe("the names people gave", () => {
  it("remembers the name of everyone signed in now and of everyone who signs in later", () => {
    const { runtime, signIn } = make();
    expect(runtime.directory.nameOf("ada@x.test")).toBe("Ada Lima");
    signIn({ email: "bob@x.test", name: "Roberto" });
    expect(runtime.directory.nameOf("bob@x.test")).toBe("Roberto");
    expect(runtime.dms.open("ada@x.test", "bob@x.test")?.peerName).toBe("Roberto");
  });
});

describe("who shares a room", () => {
  it("is two people listed on the same room", () => {
    const { runtime } = make({ groups: [{ people: ["gus@x.test", "ada@x.test"] }, { people: ["bob@x.test"] }, {}] });
    const guest = { email: "gus@x.test", admin: false, guest: true };
    expect(runtime.directory.forViewer(guest).map((person) => person.email)).toEqual(["ada@x.test", "gus@x.test"]);
    expect(runtime.directory.mayReach(guest, "bob@x.test")).toBe(false);
  });
});
