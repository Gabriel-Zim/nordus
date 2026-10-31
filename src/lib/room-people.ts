import { normalizePersonEmail, type DirectoryPerson } from "../../shared/people";
import { sameEmail, type Viewer } from "./viewer";

export interface RoomPeopleSource {
  general?: true;
  people?: string[];
  createdBy?: string;
}

export interface RoomPeopleView {
  /** Everyone on the team belongs: always in the general channel, and in any other until it is limited to a list. */
  everyone: boolean;
  general: boolean;
  emails: string[];
  /** Only admins and whoever opened the channel change who is in; never the general channel, never a guest. */
  canEdit: boolean;
}

export function roomPeopleView(group: RoomPeopleSource, viewer: Viewer): RoomPeopleView {
  const general = group.general === true;
  const limited = !general && Array.isArray(group.people) && group.people.length > 0;
  return {
    everyone: !limited,
    general,
    emails: limited ? [...group.people!] : [],
    canEdit: !general && !viewer.guest && (viewer.admin || sameEmail(group.createdBy, viewer.email)),
  };
}

/** The person who opened the channel always stays, and a channel never ends up with nobody. */
export function canRemoveFromRoom(group: RoomPeopleSource, email: string): boolean {
  return !sameEmail(group.createdBy, email) && (group.people?.length ?? 0) > 1;
}

export function peopleToAdd(directory: readonly DirectoryPerson[], group: RoomPeopleSource): DirectoryPerson[] {
  const inside = new Set(group.people ?? []);
  return directory.filter((person) => !inside.has(person.email));
}

export function withPerson(emails: readonly string[], email: string): string[] {
  const address = normalizePersonEmail(email);
  return !address || emails.includes(address) ? [...emails] : [...emails, address];
}

export function withoutPerson(emails: readonly string[], email: string): string[] {
  return emails.filter((item) => item !== email);
}

/** What a new or newly limited channel lists: the people picked, else only whoever is making it. Null when that is nobody. */
export function peopleForLimitedRoom(picked: readonly string[], self: string | undefined): string[] | null {
  const emails = [...new Set(picked)];
  if (emails.length) return emails;
  const own = normalizePersonEmail(self);
  return own ? [own] : null;
}

export interface NewRoomPeople {
  /** Sent with the new channel; absent opens it to everyone. */
  people?: string[];
  /** False while the choice cannot be sent, such as a limited channel nobody is in. */
  ready: boolean;
}

export const OPEN_TO_EVERYONE: NewRoomPeople = { ready: true };

export function newRoomPeople(limited: boolean, picked: readonly string[], self: string | undefined): NewRoomPeople {
  if (!limited) return OPEN_TO_EVERYONE;
  const people = peopleForLimitedRoom(picked, self);
  return people ? { people, ready: true } : { ready: false };
}
