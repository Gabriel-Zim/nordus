import { normalizePersonEmail } from "../shared/people.ts";

export const MAX_ROOM_PEOPLE = 500;

/** The people a room is limited to, from a request: addresses on this workspace's list, with whoever opened the room kept in.
 * Absent means no limit, so the room stays open to everyone who sees all its agents. */
export function checkedRoomPeople(
  raw: unknown,
  keep: string | undefined,
  isKnown: (email: string) => boolean,
): { ok: true; people: string[] | undefined } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, people: undefined };
  if (!Array.isArray(raw) || raw.length > MAX_ROOM_PEOPLE) {
    return { ok: false, error: `people must be a list of at most ${MAX_ROOM_PEOPLE} email addresses, or null to open the room to everyone` };
  }
  const people: string[] = [];
  for (const entry of raw) {
    const email = normalizePersonEmail(entry);
    if (!email) return { ok: false, error: `"${String(entry).slice(0, 80)}" is not an email address` };
    if (!isKnown(email)) return { ok: false, error: `${email} is not on this workspace's list of people` };
    if (!people.includes(email)) people.push(email);
  }
  if (keep && !people.includes(keep)) people.push(keep);
  if (!people.length) return { ok: false, error: "put at least one person in the room, or open it to everyone with null" };
  return { ok: true, people };
}
