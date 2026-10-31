import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SessionRegistry } from "./sessions.ts";

let dir: string;
let clock: number;
const file = () => join(dir, "sessions.json");

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nordus-sessions-guest-"));
  clock = 1_700_000_000_000;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("the guest marker on a session", () => {
  it("takes the marker from the sign-in list when the session is opened", () => {
    const guests = new Set(["gus@x.test"]);
    const registry = new SessionRegistry({ file: file(), now: () => clock, emailScopes: () => ["client"], emailGuestSnapshot: () => (email) => guests.has(email) });
    const guest = registry.issue({ label: "laptop", email: "gus@x.test", scopes: ["client"] });
    const member = registry.issue({ label: "laptop", email: "ana@x.test", scopes: ["client"] });
    expect(guest.session.guest).toBe(true);
    expect(member.session).not.toHaveProperty("guest");
    expect(registry.authenticate(guest.token)?.guest).toBe(true);
    expect(registry.authenticate(member.token)?.guest).toBeUndefined();
  });

  it("never marks an admin, even one named as a guest", () => {
    const registry = new SessionRegistry({
      file: file(), now: () => clock, emailScopes: () => ["admin", "client"], emailGuestSnapshot: () => () => true,
    });
    const admin = registry.issue({ label: "laptop", email: "boss@x.test", scopes: ["admin", "client"], guest: true });
    expect(admin.session).not.toHaveProperty("guest");
  });

  it("keeps the marker across a restart", () => {
    const options = { file: file(), now: () => clock, emailScopes: () => ["client" as const], emailGuestSnapshot: () => (email: string) => email === "gus@x.test" };
    const first = new SessionRegistry(options);
    const issued = first.issue({ label: "laptop", email: "gus@x.test", scopes: ["client"] });
    first.close();
    const second = new SessionRegistry(options);
    expect(second.authenticate(issued.token)?.guest).toBe(true);
  });

  it("ends a session whose person changed role, in either direction, so they sign in again as what they are now", () => {
    const guests = new Set(["gus@x.test"]);
    const registry = new SessionRegistry({ file: file(), now: () => clock, emailScopes: () => ["client"], emailGuestSnapshot: () => (email) => guests.has(email) });
    const guest = registry.issue({ label: "laptop", email: "gus@x.test", scopes: ["client"] });
    const member = registry.issue({ label: "laptop", email: "ana@x.test", scopes: ["client"] });
    const revoked: string[] = [];
    registry.onSessionRevoked((id) => revoked.push(id));
    guests.delete("gus@x.test");
    guests.add("ana@x.test");
    expect(registry.authenticate(guest.token)).toBeNull();
    expect(registry.authenticate(member.token)).toBeNull();
    expect(revoked.sort()).toEqual([guest.session.id, member.session.id].sort());
  });

  it("ends a session the portal opened when its person becomes a guest or stops being one, though the portal still answers for scopes", () => {
    const guests = new Set<string>();
    const registry = new SessionRegistry({
      file: file(), now: () => clock, emailScopes: () => null, portalMembership: true, emailGuestSnapshot: () => (email) => guests.has(email),
    });
    const stays = registry.issuePortal({ email: "ana@x.test", grant: "a".repeat(43), scopes: ["client"] });
    const turns = registry.issuePortal({ email: "gus@x.test", grant: "b".repeat(43), scopes: ["client"] });
    const boss = registry.issuePortal({ email: "boss@x.test", grant: "c".repeat(43), scopes: ["admin", "client"] });
    expect(registry.authenticate(stays.token)?.id).toBe(stays.session.id);
    guests.add("gus@x.test");
    guests.add("boss@x.test");
    expect(registry.authenticate(turns.token)).toBeNull();
    expect(registry.authenticate(stays.token)?.id).toBe(stays.session.id);
    expect(registry.authenticate(boss.token)?.id).toBe(boss.session.id);
    const again = registry.issuePortal({ email: "gus@x.test", grant: "d".repeat(43), scopes: ["client"] });
    expect(again.session.guest).toBe(true);
    guests.delete("gus@x.test");
    expect(registry.authenticate(again.token)).toBeNull();
  });

  it("leaves a session the portal opened alone when the sign-in list cannot be read", () => {
    let readable = true;
    const registry = new SessionRegistry({
      file: file(), now: () => clock, emailScopes: () => null, portalMembership: true,
      emailGuestSnapshot: () => { if (!readable) throw new Error("unreadable"); return () => false; },
    });
    const portal = registry.issuePortal({ email: "ana@x.test", grant: "a".repeat(43), scopes: ["client"] });
    readable = false;
    expect(registry.authenticate(portal.token)?.id).toBe(portal.session.id);
  });

  it("leaves a paired device without an address alone", () => {
    const registry = new SessionRegistry({ file: file(), now: () => clock, emailScopes: () => ["client"], emailGuestSnapshot: () => () => true });
    const { code } = registry.openPairing({ scopes: ["client"] });
    const paired = registry.exchange({ code, label: "phone", source: "10.0.0.2" });
    if (!paired.ok) throw new Error(paired.error);
    expect(registry.authenticate(paired.token)?.id).toBe(paired.session.id);
    expect(registry.authenticate(paired.token)?.guest).toBeUndefined();
  });
});
