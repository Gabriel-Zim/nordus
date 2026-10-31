import { describe, expect, it } from "vitest";

import { appliesNow, directApply, profileGrant } from "./direct-apply.ts";

describe("appliesNow", () => {
  it("applies at Full access and at every other level, with no card of Nordus's own", () => {
    expect(appliesNow({ fullAccess: true, ownerMustConfirm: false })).toBe("full-access");
    expect(appliesNow({ fullAccess: false, ownerMustConfirm: false })).toBe("level");
  });

  it("waits for the owner only in a Cloud turn the owner did not drive", () => {
    expect(appliesNow({ fullAccess: false, ownerMustConfirm: true })).toBeNull();
  });
});

describe("directApply (routine requests)", () => {
  it("applies everything at Full access, unchanged", () => {
    expect(directApply({ fullAccess: true, botId: "a", targetBotId: "b", blocked: false })).toBe("full-access");
    expect(directApply({ fullAccess: true, botId: "a", targetBotId: "a", blocked: false })).toBe("full-access");
  });

  it("applies a bot's change to itself at any other level", () => {
    expect(directApply({ fullAccess: false, botId: "a", targetBotId: "a", blocked: false })).toBe("self");
  });

  it("keeps the card for another bot, and for everything in a guest-driven turn", () => {
    expect(directApply({ fullAccess: false, botId: "a", targetBotId: "b", blocked: false })).toBeNull();
    expect(directApply({ fullAccess: false, botId: "a", targetBotId: "a", blocked: true })).toBeNull();
  });
});

describe("profileGrant", () => {
  it("never applies standing instructions without the person, at any level", () => {
    for (const grant of ["full-access", "level", "self", null] as const) {
      expect(profileGrant(grant, { soul: "New rules." })).toBeNull();
      expect(profileGrant(grant, { title: "Lead", soul: "New rules." })).toBeNull();
    }
  });

  it("keeps a bot's own working folder on the card below Full access", () => {
    expect(profileGrant("self", { cwd: "/tmp" })).toBeNull();
    expect(profileGrant("level", { cwd: "/tmp" })).toBeNull();
    expect(profileGrant("full-access", { cwd: "/tmp" })).toBe("full-access");
  });

  it("leaves every other field to the level's grant", () => {
    expect(profileGrant("full-access", { title: "Lead" })).toBe("full-access");
    expect(profileGrant("level", { title: "Lead" })).toBe("level");
    expect(profileGrant("self", { name: "Kiwi", notifications: false })).toBe("self");
    expect(profileGrant(null, { title: "Lead" })).toBeNull();
  });
});
