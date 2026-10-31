import { normalizePersonEmail, type DirectoryPerson } from "../../shared/people";
import { sameEmail, type Viewer } from "./viewer";

export const ADMINS_VALUE = "admins";

/** One entry of the "Responsável" picker. The administrators carry no name: the screen words them. */
export interface OwnerChoice {
  value: string;
  name?: string;
  email?: string;
}

/** The administrators, then everyone on the team who is not a guest. A saved owner who left the directory stays, under the address. */
export function ownerChoices(directory: readonly DirectoryPerson[], saved: string | undefined): OwnerChoice[] {
  const choices: OwnerChoice[] = [{ value: ADMINS_VALUE }];
  for (const person of directory) {
    if (person.role !== "guest") choices.push({ value: person.email, name: person.name, email: person.email });
  }
  const owner = normalizePersonEmail(saved);
  if (owner && !choices.some((choice) => choice.value === owner)) {
    choices.push({ value: owner, name: directory.find((person) => person.email === owner)?.name ?? owner, email: owner });
  }
  return choices;
}

export function ownerValue(owner: string | undefined): string {
  return normalizePersonEmail(owner) ?? ADMINS_VALUE;
}

/** The body of `PATCH /api/bots/:id` that hands an agent to a person, or back to the administrators. */
export function ownerPatch(value: string): { owner: string | null } {
  return { owner: value === ADMINS_VALUE ? null : value };
}

export type BotRole = "admin" | "owner" | "viewer";

/** Admins change everything; the person an agent answers to changes its profile and limit; everyone else keeps the usual panel. */
export function botRole(viewer: Viewer, bot: { owner?: string }): BotRole {
  if (viewer.admin) return "admin";
  return !viewer.guest && sameEmail(bot.owner, viewer.email) ? "owner" : "viewer";
}

export type OwnerRowMode = "edit" | "read" | "none";

/** Admins pick when there is more than themselves to pick from, or an owner to take off; others only read who answers for the agent; guests are not told. */
export function ownerRowMode(viewer: Pick<Viewer, "admin" | "guest">, choices: readonly OwnerChoice[], owner: string | undefined): OwnerRowMode {
  if (viewer.guest) return "none";
  const owned = normalizePersonEmail(owner) !== null;
  if (viewer.admin) return choices.length > 2 || owned ? "edit" : "none";
  return owned ? "read" : "none";
}
