// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ResolvedSender } from "../../shared/wire";

const fixture = vi.hoisted(() => ({ state: { kind: "unauthenticated", error: "" } as unknown, never: false }));
vi.mock("./session", () => ({
  sessionOnce: () => (fixture.never ? new Promise(() => {}) : Promise.resolve(fixture.state)),
}));

const { otherAuthor, senderInitials, useMe } = await import("./message-author");
type Me = import("./message-author").Me;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const OWNER = "avery@example.test";
const MARIA = "maria@example.test";
const PHOTO = "/api/attachments/avery-1.png";

const owner: Me = { owner: true, name: "Avery", email: OWNER };
const maria: Me = { name: "Maria Souza", email: MARIA };

const oldStamp: ResolvedSender = { name: "Chrome on Mac", admin: true, id: "device-1" };
const device: ResolvedSender = { name: "Avery", email: OWNER, avatarUrl: PHOTO, admin: true, id: "device-1" };
const staff: ResolvedSender = { name: "Staff phone", id: "device-3" };
const fromMaria: ResolvedSender = { name: "Maria Souza", email: MARIA, notOwner: true, id: "maria" };
const anotherAdmin: ResolvedSender = { name: "Ana", email: "ana@example.test", admin: true, notOwner: true };

describe("whose a room line is", () => {
  it("is mine, on the right, for the owner's browser when the owner's paired device wrote it", () => {
    expect(otherAuthor(device, owner)).toBeUndefined();
    expect(otherAuthor(oldStamp, owner)).toBeUndefined();
    expect(otherAuthor({ name: "Avery", admin: true }, owner)).toBeUndefined();
    expect(otherAuthor({ name: "Avery", email: OWNER, admin: true }, owner)).toBeUndefined();
  });

  it("is mine for an owner whose profile has no name, however the line was stamped", () => {
    expect(otherAuthor(oldStamp, { owner: true, name: "Safari on iPhone" })).toBeUndefined();
  });

  it("is someone else's for the owner when it carries another address, or is a device without the admin stamp", () => {
    expect(otherAuthor(fromMaria, owner)).toBe(fromMaria);
    expect(otherAuthor(anotherAdmin, owner)).toBe(anotherAdmin);
    expect(otherAuthor(staff, owner)).toBe(staff);
  });

  it("is the owner's, on the left with the photo, for another person's browser, and never theirs", () => {
    expect(otherAuthor(device, maria)).toBe(device);
    expect(otherAuthor(oldStamp, maria)).toBe(oldStamp);
    expect(otherAuthor(fromMaria, maria)).toBeUndefined();
  });

  it("is still any other device's in a browser that is no one in particular, and nothing without a sender", () => {
    expect(otherAuthor(staff, {})).toBe(staff);
    expect(otherAuthor(oldStamp, {})).toBe(oldStamp);
    expect(otherAuthor(undefined, owner)).toBeUndefined();
  });

  it("compares addresses before names, as before", () => {
    expect(otherAuthor({ name: "Avery", email: "other@example.test" }, owner)).toEqual({ name: "Avery", email: "other@example.test" });
    expect(otherAuthor({ name: "avery" }, { name: "Avery" })).toBeUndefined();
  });
});

describe("initials", () => {
  it("are the first letters of the first two words", () => {
    expect(senderInitials("  maria  souza costa ")).toBe("MS");
    expect(senderInitials("")).toBe("?");
  });
});

describe("who this browser is", () => {
  let host: HTMLDivElement;
  let root: Root;
  let seen: Me | undefined;
  function Probe({ profile }: { profile?: { name?: string; email?: string } }) {
    seen = useMe(profile);
    return null;
  }
  const mount = (profile?: { name?: string; email?: string }) => act(async () => root.render(createElement(Probe, { profile })));

  beforeEach(() => {
    fixture.never = false;
    seen = undefined;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("is the owner for a device paired with a code and holding the admin scope, under the profile the server resolved", async () => {
    fixture.state = { kind: "session", id: "s", label: "Chrome on Mac", scopes: ["admin", "client"], expiresAt: 1, person: { name: "Avery", email: OWNER, avatarUrl: PHOTO, owner: true } };
    await mount();
    expect(seen).toEqual({ owner: true, name: "Avery", email: OWNER });
  });

  it("is the owner under the profile for a paired admin device when the server names no person", async () => {
    fixture.state = { kind: "session", id: "s", label: "Chrome on Mac", scopes: ["admin", "client"], expiresAt: 1 };
    await mount({ name: "Avery", email: OWNER });
    expect(seen).toEqual({ owner: true, name: "Avery", email: OWNER });
  });

  it("is the person the server names for anyone signed in with an address", async () => {
    fixture.state = { kind: "session", id: "s", label: "Laptop", scopes: ["client"], expiresAt: 1, email: MARIA, person: { name: "Maria Souza", email: MARIA } };
    await mount();
    expect(seen).toEqual({ name: "Maria Souza", email: MARIA });
  });

  it("is no one in particular for a device without the admin scope, as before", async () => {
    fixture.state = { kind: "session", id: "s", label: "Staff phone", scopes: ["client"], expiresAt: 1 };
    await mount({ name: "Avery", email: OWNER });
    expect(seen).toEqual({ email: undefined, name: undefined });
  });

  it("falls back to the session's own email when an older server names no person", async () => {
    fixture.state = { kind: "session", id: "s", label: "Laptop", scopes: ["client"], expiresAt: 1, email: MARIA, name: "Maria Souza" };
    await mount();
    expect(seen).toEqual({ email: MARIA, name: "Maria Souza" });
  });

  it("is the owner under the profile on the owner's own machine", async () => {
    fixture.state = { kind: "loopback" };
    await mount({ name: " Avery ", email: OWNER });
    expect(seen).toEqual({ owner: true, name: "Avery", email: OWNER });
  });

  it("is not the owner when the server treats local requests only as a service", async () => {
    fixture.state = { kind: "loopback", trust: "service" };
    await mount({ name: "Avery", email: OWNER });
    expect(seen).toEqual({ name: "Avery", email: OWNER });
  });

  it("is the profile, and not yet the owner, until the server has answered", async () => {
    fixture.never = true;
    await mount({ name: "Avery", email: OWNER });
    expect(seen).toEqual({ name: "Avery", email: OWNER });
  });
});
