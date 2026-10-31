import { describe, expect, it } from "vitest";

import type { DirectoryPerson } from "../../shared/people";
import { canRemoveFromRoom, newRoomPeople, OPEN_TO_EVERYONE, peopleForLimitedRoom, peopleToAdd, roomPeopleView, withoutPerson, withPerson } from "./room-people";
import type { Viewer } from "./viewer";

const admin: Viewer = { admin: true, guest: false, email: "root@acme.test" };
const creator: Viewer = { admin: false, guest: false, email: "ana@acme.test" };
const member: Viewer = { admin: false, guest: false, email: "bia@acme.test" };
const guest: Viewer = { admin: false, guest: true, email: "gil@acme.test" };
const limited = { people: ["ana@acme.test", "bia@acme.test", "gil@acme.test"], createdBy: "ana@acme.test" };

describe("who a channel is for", () => {
  it("is everyone on the team while it has no list", () => {
    expect(roomPeopleView({ createdBy: "ana@acme.test" }, member)).toEqual({ everyone: true, general: false, emails: [], canEdit: false });
    expect(roomPeopleView({ people: [] }, member).everyone).toBe(true);
  });

  it("lists exactly the people it is limited to", () => {
    expect(roomPeopleView(limited, member)).toEqual({ everyone: false, general: false, emails: limited.people, canEdit: false });
  });

  it("lets an admin change who is in, whoever opened the channel", () => {
    expect(roomPeopleView(limited, admin).canEdit).toBe(true);
    expect(roomPeopleView({ createdBy: "ana@acme.test" }, admin).canEdit).toBe(true);
  });

  it("lets whoever opened the channel change who is in, address in any case", () => {
    expect(roomPeopleView(limited, creator).canEdit).toBe(true);
    expect(roomPeopleView({ ...limited, createdBy: "ANA@acme.test" }, creator).canEdit).toBe(true);
  });

  it("keeps any other member from changing who is in", () => {
    expect(roomPeopleView(limited, member).canEdit).toBe(false);
    expect(roomPeopleView({ ...limited, createdBy: undefined }, member).canEdit).toBe(false);
  });

  it("never lets a guest change who is in", () => {
    expect(roomPeopleView(limited, guest).canEdit).toBe(false);
    expect(roomPeopleView({ ...limited, createdBy: "gil@acme.test" }, guest).canEdit).toBe(false);
    expect(roomPeopleView(limited, { ...guest, admin: true }).canEdit).toBe(false);
  });

  it("is always the whole team in the general channel, with nothing to change", () => {
    const general = { general: true as const, people: ["ana@acme.test"], createdBy: "root@acme.test" };
    expect(roomPeopleView(general, admin)).toEqual({ everyone: true, general: true, emails: [], canEdit: false });
    expect(roomPeopleView(general, creator).canEdit).toBe(false);
  });
});

describe("changing who is in", () => {
  const directory: DirectoryPerson[] = [
    { email: "ana@acme.test", name: "Ana", role: "member" },
    { email: "bia@acme.test", name: "Bia", role: "member" },
    { email: "caio@acme.test", name: "Caio", role: "admin" },
  ];

  it("never removes whoever opened the channel, nor the last person", () => {
    expect(canRemoveFromRoom(limited, "ana@acme.test")).toBe(false);
    expect(canRemoveFromRoom(limited, "ANA@acme.test")).toBe(false);
    expect(canRemoveFromRoom(limited, "bia@acme.test")).toBe(true);
    expect(canRemoveFromRoom({ people: ["bia@acme.test"], createdBy: "ana@acme.test" }, "bia@acme.test")).toBe(false);
  });

  it("offers the people who are not in yet", () => {
    expect(peopleToAdd(directory, { people: ["ana@acme.test"] }).map((person) => person.email)).toEqual(["bia@acme.test", "caio@acme.test"]);
    expect(peopleToAdd(directory, {}).map((person) => person.email)).toHaveLength(3);
  });

  it("adds an address once, lowercased, and ignores what is not an address", () => {
    expect(withPerson(["ana@acme.test"], "Bia@Acme.test")).toEqual(["ana@acme.test", "bia@acme.test"]);
    expect(withPerson(["ana@acme.test"], "ANA@acme.test")).toEqual(["ana@acme.test"]);
    expect(withPerson(["ana@acme.test"], "nobody")).toEqual(["ana@acme.test"]);
    expect(withoutPerson(["ana@acme.test", "bia@acme.test"], "bia@acme.test")).toEqual(["ana@acme.test"]);
  });

  it("limits to the people picked, or to whoever is doing it when nobody is picked", () => {
    expect(peopleForLimitedRoom(["bia@acme.test", "bia@acme.test", "caio@acme.test"], "ana@acme.test")).toEqual(["bia@acme.test", "caio@acme.test"]);
    expect(peopleForLimitedRoom([], "Ana@Acme.test")).toEqual(["ana@acme.test"]);
    expect(peopleForLimitedRoom([], undefined)).toBeNull();
  });
});

describe("who a new channel is for", () => {
  it("opens it to everyone unless it was limited, sending no list at all", () => {
    expect(newRoomPeople(false, ["bia@acme.test"], "ana@acme.test")).toBe(OPEN_TO_EVERYONE);
    expect(OPEN_TO_EVERYONE).toEqual({ ready: true });
  });

  it("sends the people picked when it is limited", () => {
    expect(newRoomPeople(true, ["bia@acme.test"], "ana@acme.test")).toEqual({ people: ["bia@acme.test"], ready: true });
  });

  it("keeps only the maker in when it is limited and nobody is picked", () => {
    expect(newRoomPeople(true, [], "ana@acme.test")).toEqual({ people: ["ana@acme.test"], ready: true });
  });

  it("is not ready when it is limited and there is nobody at all to put in", () => {
    expect(newRoomPeople(true, [], undefined)).toEqual({ ready: false });
  });
});
