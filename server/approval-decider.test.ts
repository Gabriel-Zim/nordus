import { describe, expect, it } from "vitest";

import { ADMINS, deciderName, deciderOf, mayDecide, ownerOf } from "./approval-decider.ts";
import type { RequestAuth } from "./request-auth.ts";
import type { Scope, SessionRecord } from "./sessions.ts";

const session = (scopes: Scope[], extra: { email?: string; name?: string; guest?: boolean } = {}): RequestAuth => ({
  kind: "session",
  via: "cookie",
  scopes,
  session: { id: "s-1", label: "laptop", scopes, ...extra } as unknown as SessionRecord,
});

describe("who is asking", () => {
  it("treats the machine's owner and an admin session as administrators", () => {
    expect(deciderOf({ kind: "loopback", scopes: ["admin", "client"] })).toEqual({ admin: true });
    expect(deciderOf(session(["admin", "client"], { email: "Boss@Example.test", name: "Boss" }))).toEqual({
      admin: true, email: "boss@example.test", name: "Boss",
    });
  });

  it("never treats a service caller, which every bot's shell is, as a person", () => {
    expect(deciderOf({ kind: "loopback", scopes: ["admin", "client"], trust: "service" })).toEqual({ admin: false });
  });

  it("keeps a member's address lowercased", () => {
    expect(deciderOf(session(["client"], { email: "  Ada@Example.test " }))).toEqual({ admin: false, email: "ada@example.test" });
    expect(deciderOf(session(["client"]))).toEqual({ admin: false });
  });
});

describe("who answers for an agent", () => {
  it("reads the owner's address, lowercased, and nothing when there is none", () => {
    expect(ownerOf({ owner: " Rafael@Example.test " })).toBe("rafael@example.test");
    expect(ownerOf({ owner: "" })).toBeUndefined();
    expect(ownerOf({ owner: 42 })).toBeUndefined();
    expect(ownerOf({})).toBeUndefined();
    expect(ownerOf(null)).toBeUndefined();
  });

  it("lets the admins decide for any agent, and the owner only for their own", () => {
    const bot = { owner: "rafael@example.test" };
    expect(mayDecide({ admin: true }, bot)).toBe(true);
    expect(mayDecide({ admin: false, email: "rafael@example.test" }, bot)).toBe(true);
    expect(mayDecide({ admin: false, email: "ada@example.test" }, bot)).toBe(false);
    expect(mayDecide({ admin: false }, bot)).toBe(false);
  });

  it("never lets a guest decide, even for an agent still named for them", () => {
    const bot = { owner: "rafael@example.test" };
    expect(deciderOf(session(["client"], { email: "Rafael@Example.test", guest: true }))).toEqual({ admin: false, email: "rafael@example.test", guest: true });
    expect(mayDecide({ admin: false, email: "rafael@example.test", guest: true }, bot)).toBe(false);
  });

  it("leaves an agent nobody owns to the admins alone", () => {
    expect(mayDecide({ admin: false, email: "ada@example.test" }, {})).toBe(false);
    expect(mayDecide({ admin: false }, null)).toBe(false);
    expect(mayDecide({ admin: true }, {})).toBe(true);
  });

  it("says the owner's name, else a name read off the address, else the administrators", () => {
    expect(deciderName({ owner: "rafael@example.test" }, (email) => (email === "rafael@example.test" ? "Rafael Lima" : undefined))).toBe("Rafael Lima");
    expect(deciderName({ owner: "marina.souza@example.test" }, () => undefined)).toBe("Marina Souza");
    expect(deciderName({}, () => "ignored")).toBe(ADMINS);
  });
});
