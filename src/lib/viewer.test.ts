import { describe, expect, it } from "vitest";

import { readSessionState, type SessionState } from "./session";
import { sameEmail, viewerOf } from "./viewer";

const session = (extra: Partial<Extract<SessionState, { kind: "session" }>> = {}): SessionState => ({ kind: "session", id: "s", label: "", scopes: ["client"], expiresAt: 1, ...extra });

describe("who is looking at the screen", () => {
  it("reads an admin session by its scope, under the address it signed in with", () => {
    expect(viewerOf(session({ scopes: ["admin"], email: "Ada@Example.test" }))).toEqual({ admin: true, guest: false, email: "ada@example.test" });
  });

  it("reads a member as neither admin nor guest", () => {
    expect(viewerOf(session({ email: "bob@example.test" }))).toEqual({ admin: false, guest: false, email: "bob@example.test" });
  });

  it("reads a guest from the session, and a guest is never an admin by that alone", () => {
    expect(viewerOf(session({ email: "gil@example.test", guest: true }))).toEqual({ admin: false, guest: true, email: "gil@example.test" });
  });

  it("gives the owner of a desktop that never asks for an address the address of their profile", () => {
    expect(viewerOf({ kind: "loopback" }, "Dana@Example.test")).toEqual({ admin: true, guest: false, email: "dana@example.test" });
    expect(viewerOf({ kind: "loopback" })).toEqual({ admin: true, guest: false });
    expect(viewerOf(session({ scopes: ["admin"] }), "dana@example.test")).toEqual({ admin: true, guest: false, email: "dana@example.test" });
  });

  it("does not lend the profile address to someone who is not an admin", () => {
    expect(viewerOf(session(), "dana@example.test")).toEqual({ admin: false, guest: false });
  });

  it("knows nobody before the session answers, or when the server only trusts the service", () => {
    expect(viewerOf(null)).toEqual({ admin: false, guest: false });
    expect(viewerOf({ kind: "loopback", trust: "service" })).toEqual({ admin: false, guest: false });
    expect(viewerOf({ kind: "unauthenticated", error: "no" })).toEqual({ admin: false, guest: false });
  });

  it("compares addresses without caring for case or spaces, and never matches nothing", () => {
    expect(sameEmail(" Ada@Example.test", "ada@example.test")).toBe(true);
    expect(sameEmail("ada@example.test", "bob@example.test")).toBe(false);
    expect(sameEmail(undefined, undefined)).toBe(false);
    expect(sameEmail("not an address", "not an address")).toBe(false);
  });
});

describe("the session snapshot", () => {
  const answer = (body: Record<string, unknown>) => (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;

  it("carries guest: true for a guest and nothing for anyone else", async () => {
    const guest = await readSessionState(answer({ kind: "session", id: "a", scopes: ["client"], email: "gil@example.test", guest: true }));
    expect(guest).toMatchObject({ kind: "session", guest: true });
    const member = await readSessionState(answer({ kind: "session", id: "b", scopes: ["client"], email: "bob@example.test" }));
    expect(member).not.toHaveProperty("guest");
    const wrong = await readSessionState(answer({ kind: "session", id: "c", scopes: ["client"], guest: "yes" }));
    expect(wrong).not.toHaveProperty("guest");
  });
});
