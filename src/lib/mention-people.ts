import { createContext, useContext } from "react";

import { personNameFromEmail, type DirectoryPerson } from "../../shared/people";
import type { MentionablePerson } from "../../shared/person-mention";

export interface MentionPeopleValue {
  /** Everyone who can be called by name here, the viewer included, so a message that names them reads as a mention. */
  people: readonly MentionablePerson[];
  /** The viewer's address: the @ list leaves this person out. */
  self?: string;
}

const NOBODY: MentionPeopleValue = { people: [] };

export const MentionPeopleContext = createContext<MentionPeopleValue>(NOBODY);

export function useMentionPeople(): MentionPeopleValue {
  return useContext(MentionPeopleContext);
}

/** A channel with a list names exactly those people; any other channel names the team, guests apart. A chat with one agent names nobody. */
export function mentionablePeople(
  group: { dm?: boolean; general?: true; people?: string[] } | undefined,
  directory: readonly DirectoryPerson[],
): MentionablePerson[] {
  if (!group || group.dm) return [];
  const listed = !group.general && group.people && group.people.length > 0 ? group.people : null;
  if (listed) return listed.map((email) => ({ email, name: directory.find((person) => person.email === email)?.name ?? personNameFromEmail(email) }));
  return directory.filter((person) => person.role !== "guest").map(({ name, email }) => ({ name, email }));
}

/** The people the @ list offers: everyone named here but the viewer, who is not offered to themselves. */
export function personMentionChoices(people: readonly MentionablePerson[], self: string | undefined): Array<{ id: string; name: string; person: MentionablePerson }> {
  return people.filter((person) => person.email !== self).map((person) => ({ id: `person:${person.email}`, name: person.name, person }));
}
