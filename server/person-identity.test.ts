import { describe, expect, it } from "vitest";
import type { ResolvedSender } from "../shared/wire.ts";
import { localSender, personIdentity, presentSender, publicPerson, sessionSender } from "./person-identity.ts";

const PHOTO = "/api/attachments/avery-1.png";
const GOOGLE = "https://lh3.googleusercontent.com/a/ACg8ocK=s96-c";
const owner = { name: "Avery", email: "avery@example.test", avatarUrl: PHOTO };

describe("a device paired with a code and holding the admin scope", () => {
  it("speaks as the owner, with the profile's name, address and photo", () => {
    expect(sessionSender({ label: "Chrome on Mac" }, { id: "device-1", admin: true }, owner)).toEqual({
      name: "Avery", id: "device-1", email: "avery@example.test", avatarUrl: PHOTO, admin: true,
    });
  });

  it("is never stamped notOwner, so no permission reads it as someone else", () => {
    expect(sessionSender({ label: "Safari on iPhone" }, { id: "device-2", admin: true }, owner)?.notOwner).toBeUndefined();
  });

  it("carries only the profile parts that exist", () => {
    expect(sessionSender({ label: "Mac do Zorg" }, { id: "d", admin: true }, { name: "Avery" })).toEqual({ name: "Avery", id: "d", admin: true });
  });

  it("keeps today's rule while the profile has no name: the device label, with no address or photo", () => {
    expect(sessionSender({ label: "Chrome on Mac" }, { id: "d", admin: true }, { email: "avery@example.test", avatarUrl: PHOTO }))
      .toEqual({ name: "Chrome on Mac", id: "d", admin: true });
    expect(sessionSender({ label: "Chrome on Mac" }, { id: "d", admin: true }, undefined)).toEqual({ name: "Chrome on Mac", id: "d", admin: true });
  });

  it("is the owner for the browser even when the profile has no name", () => {
    expect(personIdentity({ label: "Chrome on Mac" }, true, {})).toEqual({ name: "Chrome on Mac", owner: true });
  });
});

describe("a device without the admin scope", () => {
  it("keeps its label and never takes the owner's name, address or photo", () => {
    expect(sessionSender({ label: "Staff phone" }, { id: "device-3", admin: false }, owner)).toEqual({ name: "Staff phone", id: "device-3" });
    expect(personIdentity({ label: "Staff phone" }, false, owner)).toEqual({ name: "Staff phone", owner: false });
  });

  it("is nobody when it has no label either", () => {
    expect(sessionSender({ label: "  " }, { id: "d", admin: false }, owner)).toBeUndefined();
  });
});

describe("a person signed in with an address", () => {
  it("is the owner when the address is the profile's, in any letter case, under the profile's name and photo", () => {
    expect(sessionSender({ email: "Avery@Example.test", name: "Avery Mercer", picture: GOOGLE }, { id: "g", admin: true }, owner)).toEqual({
      name: "Avery", id: "g", email: "Avery@Example.test", avatarUrl: PHOTO, admin: true,
    });
    expect(personIdentity({ email: "avery@example.test", name: "Avery Mercer" }, true, owner)?.owner).toBe(true);
  });

  it("is the owner under the Google photo while the profile has none, and under the Google name while the profile has no name", () => {
    expect(sessionSender({ email: "avery@example.test", name: "Avery Mercer", picture: GOOGLE }, { id: "g", admin: true }, { email: "avery@example.test" }))
      .toEqual({ name: "Avery Mercer", id: "g", email: "avery@example.test", avatarUrl: GOOGLE, admin: true });
  });

  it("is someone else under the Google name and the Google photo, and notOwner", () => {
    expect(sessionSender({ email: "maria@example.test", name: "Maria Souza", picture: GOOGLE }, { id: "m", admin: false }, owner)).toEqual({
      name: "Maria Souza", id: "m", email: "maria@example.test", avatarUrl: GOOGLE, notOwner: true,
    });
  });

  it("falls back to the part of the address before the @ when Google gave no name", () => {
    expect(sessionSender({ email: "maria@example.test" }, { id: "m", admin: false }, owner)).toEqual({ name: "maria", id: "m", email: "maria@example.test", notOwner: true });
  });

  it("keeps a second admin a separate person, still stamped admin and notOwner", () => {
    expect(sessionSender({ email: "ana@example.test", name: "Ana", picture: GOOGLE }, { id: "a", admin: true }, owner))
      .toEqual({ name: "Ana", id: "a", email: "ana@example.test", avatarUrl: GOOGLE, notOwner: true, admin: true });
  });

  it("never shows a photo that is not https", () => {
    expect(sessionSender({ email: "maria@example.test", picture: "http://lh3.googleusercontent.com/a.png" }, { id: "m", admin: false }, owner)?.avatarUrl).toBeUndefined();
    expect(sessionSender({ email: "maria@example.test", picture: "javascript:alert(1)" }, { id: "m", admin: false }, owner)?.avatarUrl).toBeUndefined();
  });

  it("treats every address as another person's while the profile has no address", () => {
    expect(sessionSender({ email: "avery@example.test", name: "Avery" }, { id: "g", admin: true }, { name: "Avery" })?.notOwner).toBe(true);
  });
});

describe("the owner on this machine, writing in a room", () => {
  it("carries the profile's name, address and photo", () => {
    expect(localSender(owner, true)).toEqual({ name: "Avery", email: "avery@example.test", avatarUrl: PHOTO });
  });

  it("has no sender outside a room, or without a name", () => {
    expect(localSender(owner, false)).toBeUndefined();
    expect(localSender({ email: "avery@example.test" }, true)).toBeUndefined();
    expect(localSender(undefined, true)).toBeUndefined();
  });
});

describe("a stored sender shown now", () => {
  const stored: ResolvedSender = { name: "Chrome on Mac", id: "device-1", admin: true };

  it("is the owner, under the profile as it is now, when the stamp is admin and there is no address", () => {
    expect(presentSender(stored, owner)).toEqual({ name: "Avery", id: "device-1", email: "avery@example.test", avatarUrl: PHOTO, admin: true });
  });

  it("drops a photo the profile no longer has", () => {
    expect(presentSender({ ...stored, avatarUrl: PHOTO }, { name: "Avery" })).toEqual({ name: "Avery", id: "device-1", admin: true });
  });

  it("does not touch what is stored", () => {
    const before = structuredClone(stored);
    presentSender(stored, owner);
    expect(stored).toEqual(before);
  });

  it("leaves a sender with an address alone, even an admin's or one stamped notOwner", () => {
    const ana: ResolvedSender = { name: "Ana", email: "ana@example.test", admin: true, notOwner: true };
    expect(presentSender(ana, owner)).toBe(ana);
    const guest: ResolvedSender = { name: "Maria", email: "maria@example.test", notOwner: true };
    expect(presentSender(guest, owner)).toBe(guest);
  });

  it("leaves a device without the admin stamp alone, so it never reads as the owner", () => {
    const staff: ResolvedSender = { name: "Staff phone", id: "device-3" };
    expect(presentSender(staff, owner)).toBe(staff);
  });

  it("leaves everything alone while the profile has no name", () => {
    expect(presentSender(stored, { email: "avery@example.test" })).toBe(stored);
    expect(presentSender(stored, undefined)).toBe(stored);
    expect(presentSender(undefined, owner)).toBeUndefined();
  });
});

describe("the person a browser is told it is", () => {
  it("is the owner under the profile for a paired device with the admin scope", () => {
    expect(publicPerson({ label: "Safari on iPhone" }, true, owner)).toEqual({ name: "Avery", email: "avery@example.test", avatarUrl: PHOTO, owner: true });
  });

  it("is the owner under the device label while the profile has no name", () => {
    expect(publicPerson({ label: "Chrome on Mac" }, true, {})).toEqual({ name: "Chrome on Mac", owner: true });
  });

  it("is the signed-in owner under the profile, and anyone else under Google's name and photo", () => {
    expect(publicPerson({ email: "avery@example.test", name: "Avery Mercer", picture: GOOGLE }, true, owner)).toEqual({ name: "Avery", email: "avery@example.test", avatarUrl: PHOTO, owner: true });
    expect(publicPerson({ email: "maria@example.test", name: "Maria Souza", picture: GOOGLE }, false, owner)).toEqual({ name: "Maria Souza", email: "maria@example.test", avatarUrl: GOOGLE });
  });

  it("is nothing for a device without the admin scope, which is not a person", () => {
    expect(publicPerson({ label: "Staff phone" }, false, owner)).toBeUndefined();
  });
});
