import { describe, expect, it } from "vitest";

import {
  authEmail, authIsAdmin, authIsGuest, botPatchViolation, defaultOwner, OWNER_BOT_PATCH_FIELDS, ownerBotPatchViolation, ownsBot, parseOwner,
  roleOfAuth, withoutMoney,
} from "./people-roles.ts";
import type { RequestAuth } from "./request-auth.ts";

function session(email: string | undefined, scopes: Array<"admin" | "client">, guest?: true): RequestAuth {
  return { kind: "session", via: "bearer", scopes, session: { id: "s", email, ...(guest ? { guest } : {}) } } as unknown as RequestAuth;
}
const loopback: RequestAuth = { kind: "loopback", scopes: ["admin", "client"] };

describe("who a request is", () => {
  it("reads the address of a signed-in person, lowercased, and none from the desktop", () => {
    expect(authEmail(session(" ADA@X.test ", ["client"]))).toBe("ada@x.test");
    expect(authEmail(session("nonsense", ["client"]))).toBeUndefined();
    expect(authEmail(session(undefined, ["client"]))).toBeUndefined();
    expect(authEmail(loopback)).toBeUndefined();
  });

  it("tells admin, member and guest apart", () => {
    expect(roleOfAuth(session("boss@x.test", ["admin", "client"]))).toBe("admin");
    expect(roleOfAuth(session("ada@x.test", ["client"]))).toBe("member");
    expect(roleOfAuth(session("gus@x.test", ["client"], true))).toBe("guest");
    expect(roleOfAuth(loopback)).toBe("admin");
    expect(authIsAdmin(session("ada@x.test", ["client"]))).toBe(false);
    expect(authIsGuest(session("gus@x.test", ["client"], true))).toBe(true);
    expect(authIsGuest(session("ada@x.test", ["client"]))).toBe(false);
    expect(authIsGuest(loopback)).toBe(false);
  });
});

describe("the person an agent answers to", () => {
  it("is matched by address, ignoring case, and never by an agent that has nobody", () => {
    const ada = session("ada@x.test", ["client"]);
    expect(ownsBot(ada, { owner: "ADA@x.test" })).toBe(true);
    expect(ownsBot(ada, { owner: "bob@x.test" })).toBe(false);
    expect(ownsBot(ada, {})).toBe(false);
    expect(ownsBot(ada, null)).toBe(false);
    expect(ownsBot(session(undefined, ["client"]), { owner: "ada@x.test" })).toBe(false);
    expect(ownsBot(loopback, { owner: "ada@x.test" })).toBe(false);
  });

  it("is not a guest, who loses what they answered for when they become one", () => {
    expect(ownsBot(session("gus@x.test", ["client"], true), { owner: "gus@x.test" })).toBe(false);
  });

  it("also answers for a person named by address and current role, a guest never being one", () => {
    expect(ownsBot({ email: "ADA@x.test", role: "member" }, { owner: "ada@x.test" })).toBe(true);
    expect(ownsBot({ email: "ada@x.test", role: "admin" }, { owner: "ada@x.test" })).toBe(true);
    expect(ownsBot({ email: "ada@x.test", role: "guest" }, { owner: "ada@x.test" })).toBe(false);
    expect(ownsBot({ email: "ada@x.test", role: "member", guest: true }, { owner: "ada@x.test" })).toBe(false);
    expect(ownsBot({ role: "member" }, { owner: "ada@x.test" })).toBe(false);
    expect(ownsBot({ email: "bob@x.test", role: "member" }, { owner: "ada@x.test" })).toBe(false);
  });

  it("accepts an address, or one of the ways to say the admins", () => {
    expect(parseOwner(" Ada@X.test ")).toEqual({ ok: true, owner: "ada@x.test" });
    for (const admins of [null, "", "admins"]) expect(parseOwner(admins)).toEqual({ ok: true, owner: null });
    expect(parseOwner("nonsense")).toMatchObject({ ok: false });
    expect(parseOwner(42)).toMatchObject({ ok: false });
    expect(parseOwner(undefined)).toMatchObject({ ok: false });
  });
});

describe("who a new agent answers to", () => {
  it("is nobody when an admin makes it, so that its admins answer and no right outlives the admin role", () => {
    expect(defaultOwner(session("boss@x.test", ["admin", "client"]))).toBeUndefined();
    expect(defaultOwner(loopback)).toBeUndefined();
  });

  it("is the person who made it when they are not an admin, and never a guest", () => {
    expect(defaultOwner(session(" ADA@x.test ", ["client"]))).toBe("ada@x.test");
    expect(defaultOwner(session("gus@x.test", ["client"], true))).toBeUndefined();
    expect(defaultOwner(session(undefined, ["client"]))).toBeUndefined();
  });
});

describe("what a caller may change on an agent", () => {
  const ada = session("ada@x.test", ["client"]);
  const boss = session("boss@x.test", ["admin", "client"]);

  it("lets an admin and the desktop change anything", () => {
    expect(botPatchViolation(boss, { owner: "ada@x.test" }, { soul: "x", visibility: "admins" }, false)).toBeNull();
    expect(botPatchViolation(loopback, {}, { soul: "x", owner: "ada@x.test" }, false)).toBeNull();
  });

  it("lets the person it answers to change its instructions, and every other member only how it looks", () => {
    expect(botPatchViolation(ada, { owner: "ada@x.test" }, { soul: "curto" }, false)).toBeNull();
    expect(botPatchViolation(ada, { owner: "bob@x.test" }, { soul: "curto" }, false)).toBe("soul");
    expect(botPatchViolation(ada, {}, { soul: "curto" }, false)).toBe("soul");
    expect(botPatchViolation(ada, undefined, { soul: "curto" }, false)).toBe("soul");
    expect(botPatchViolation(ada, { owner: "bob@x.test" }, { color: "blue" }, false)).toBeNull();
    expect(botPatchViolation(ada, { owner: "ada@x.test" }, { visibility: "admins" }, false)).toBe("visibility");
  });

  it("lets a paired device change how an agent looks and nothing else, whoever it belongs to", () => {
    expect(botPatchViolation(loopback, { owner: "ada@x.test" }, { soul: "x" }, true)).toBe("soul");
    expect(botPatchViolation(ada, { owner: "ada@x.test" }, { soul: "x" }, true)).toBe("soul");
    expect(botPatchViolation(ada, { owner: "ada@x.test" }, { color: "blue" }, true)).toBeNull();
  });
});

describe("what that person may change on the agent", () => {
  it("allows how it looks, its instructions and its everyday switches", () => {
    for (const field of ["name", "title", "description", "soul", "notifications", "avatarUrl", "color", "pinned", "memoryEnabled", "voiceNotes", "greeting"]) {
      expect(ownerBotPatchViolation({ [field]: 1 }), field).toBeNull();
      expect(OWNER_BOT_PATCH_FIELDS.has(field), field).toBe(true);
    }
    expect(ownerBotPatchViolation({ name: "Novo", soul: "Responda curto", notifications: false })).toBeNull();
  });

  it("refuses who sees it, who answers for it, what it may reach and whose it is, naming the field", () => {
    for (const field of ["visibility", "owner", "audience", "client", "autoApprove", "cwd", "toolScope", "mcpServers", "chiefOfStaff", "managedSections", "modelSelection"]) {
      expect(ownerBotPatchViolation({ name: "ok", [field]: 1 }), field).toBe(field);
    }
    expect(ownerBotPatchViolation([])).toBe("body");
    expect(ownerBotPatchViolation(null)).toBe("body");
    expect(ownerBotPatchViolation("name")).toBe("body");
  });
});

describe("what an owner reads of the spending", () => {
  it("drops the dollars and keeps the rest", () => {
    const state = { botId: "b", month: "2026-10", spentUsd: 12.34, runs: 3, input: 100, output: 50, monthlyUsd: 20, percent: 62, warn: false, exceeded: false };
    const shown = withoutMoney(state);
    expect(shown).not.toHaveProperty("spentUsd");
    expect(shown).toEqual({ botId: "b", month: "2026-10", runs: 3, input: 100, output: 50, monthlyUsd: 20, percent: 62, warn: false, exceeded: false });
    expect(state.spentUsd).toBe(12.34);
  });
});
