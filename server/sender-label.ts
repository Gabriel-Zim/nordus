import { fromOwnerDevice } from "../shared/person-identity.ts";
import { escapeNotes } from "./peer-provenance.ts";

export const MAX_PERSON_NAME = 60;

/** A name a person chose for themselves: one line, no control characters and none of the brackets, of any script, that open a
 * harness note. Round parentheses stay: "Ana (Marketing)" is a name. */
export function cleanPersonName(raw: string): string {
  return raw.replace(/(?![()（）])[\p{Cc}\p{Cf}\p{Ps}\p{Pe}<>]/gu, " ").replace(/\s+/g, " ").trim().slice(0, MAX_PERSON_NAME);
}

/** How a sender is named in a prompt, escaped like any other line of text. Security: a team member is named with the
 * email they signed in with, so a chosen name never passes for the owner or for another member. A line stamped admin with no
 * email is the owner's own paired device and reads as the owner. */
export function promptPersonName(sender: { name: string; email?: string; notOwner?: boolean; admin?: boolean } | undefined, ownerName: string): string {
  if (!sender || (fromOwnerDevice(sender) && ownerName.trim())) return ownerName;
  const name = escapeNotes(cleanPersonName(sender.name)) || "Someone";
  if (!sender.notOwner) return name;
  const email = escapeNotes((sender.email ?? "").replace(/[\p{Cc}\p{Cf}\s[\]{}<>]/gu, "").slice(0, 254));
  if (!email) return name.toLowerCase() === ownerName.trim().toLowerCase() ? `${name} (team member)` : name;
  const plain = name.toLowerCase();
  return plain === email.toLowerCase() || plain === email.split("@")[0]!.toLowerCase() ? email : `${name} (${email})`;
}
