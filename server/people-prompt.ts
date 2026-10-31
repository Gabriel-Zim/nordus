import type { DirectoryPerson } from "../shared/people.ts";
import type { PeopleDirectory } from "./people-directory.ts";
import { promptPersonName } from "./sender-label.ts";

const MOST_NAMED = 20;

/** The people an agent may call by name in a room. A room limited to named people lists them; an open room lists the team only
 * for the workspace's own agents: a client's agent never learns who else works here. */
export function peopleOfRoom(
  room: { people?: readonly string[] },
  directory: Pick<PeopleDirectory, "everyone">,
  agent: { client?: string },
  internal: boolean,
): DirectoryPerson[] {
  const everyone = directory.everyone();
  if (room.people) return everyone.filter((person) => room.people!.includes(person.email));
  return internal && !agent.client ? everyone.filter((person) => person.role !== "guest") : [];
}

/** One line, names and roles only. */
export function roomPeopleLine(people: readonly DirectoryPerson[]): string | null {
  if (!people.length) return null;
  const shown = people.slice(0, MOST_NAMED).map((person) => `${promptPersonName({ name: person.name }, "Someone")} (${person.role})`);
  const rest = people.length - shown.length;
  return `People who can read this room: ${shown.join(", ")}${rest > 0 ? `, and ${rest} more` : ""}. To call one of them, write @Name in your reply.`;
}
