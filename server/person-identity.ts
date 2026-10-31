// Security: this is attribution only. `admin`, `notOwner` and `id` still come from the session's own credentials, and nothing
// here allows or refuses anything.
import { fromOwnerDevice, personPhotoUrl } from "../shared/person-identity.ts";
import type { ResolvedSender } from "../shared/wire.ts";

export interface OwnerProfile {
  name?: string | null;
  email?: string | null;
  avatarUrl?: string | null;
}

export interface SessionPerson {
  email?: string;
  name?: string;
  label?: string;
  picture?: string;
}

export interface PersonIdentity {
  name: string;
  email?: string;
  avatarUrl?: string;
  owner: boolean;
}

interface Owner {
  name?: string;
  email?: string;
  avatarUrl?: string;
}

function ownerOf(profile: OwnerProfile | null | undefined): Owner {
  const name = profile?.name?.trim();
  const email = profile?.email?.trim();
  const avatarUrl = personPhotoUrl(profile?.avatarUrl || undefined);
  return { ...(name ? { name } : {}), ...(email ? { email } : {}), ...(avatarUrl ? { avatarUrl } : {}) };
}

export function personIdentity(session: SessionPerson, admin: boolean, profile: OwnerProfile | null | undefined): PersonIdentity | undefined {
  const email = session.email?.trim();
  const own = (session.name ?? email?.split("@")[0] ?? session.label ?? "").trim();
  const owner = ownerOf(profile);
  if (!email) {
    if (!admin) return own ? { name: own, owner: false } : undefined;
    if (owner.name) return { name: owner.name, ...(owner.email ? { email: owner.email } : {}), ...(owner.avatarUrl ? { avatarUrl: owner.avatarUrl } : {}), owner: true };
    return own ? { name: own, owner: true } : undefined;
  }
  if (!own) return undefined;
  const isOwner = owner.email !== undefined && email.toLowerCase() === owner.email.toLowerCase();
  const avatarUrl = (isOwner ? owner.avatarUrl : undefined) ?? personPhotoUrl(session.picture);
  return { name: isOwner ? owner.name ?? own : own, email, ...(avatarUrl ? { avatarUrl } : {}), owner: isOwner };
}

/** The `person` of GET /api/auth/session: set for the owner and for anyone with an address, never for a bare device. */
export interface PublicPerson {
  name: string;
  email?: string;
  avatarUrl?: string;
  owner?: true;
}

export function publicPerson(session: SessionPerson, admin: boolean, profile: OwnerProfile | null | undefined): PublicPerson | undefined {
  const person = personIdentity(session, admin, profile);
  if (!person || !(person.owner || person.email)) return undefined;
  return { name: person.name, ...(person.email ? { email: person.email } : {}), ...(person.avatarUrl ? { avatarUrl: person.avatarUrl } : {}), ...(person.owner ? { owner: true as const } : {}) };
}

export function sessionSender(session: SessionPerson, stamp: { id: string | undefined; admin: boolean }, profile: OwnerProfile | null | undefined): ResolvedSender | undefined {
  const person = personIdentity(session, stamp.admin, profile);
  if (!person) return undefined;
  const email = session.email?.trim();
  const notOwner = email ? email.toLowerCase() !== profile?.email?.trim().toLowerCase() : false;
  return {
    name: person.name,
    ...(stamp.id !== undefined ? { id: stamp.id } : {}),
    ...(person.email ? { email: person.email } : {}),
    ...(notOwner ? { notOwner: true as const } : {}),
    ...(stamp.admin ? { admin: true as const } : {}),
    ...(person.avatarUrl ? { avatarUrl: person.avatarUrl } : {}),
  };
}

export function localSender(profile: OwnerProfile | null | undefined, room: boolean): ResolvedSender | undefined {
  const owner = ownerOf(profile);
  if (!room || !owner.name) return undefined;
  return { name: owner.name, ...(owner.email ? { email: owner.email } : {}), ...(owner.avatarUrl ? { avatarUrl: owner.avatarUrl } : {}) };
}

/** Security: only a sender with the admin stamp and no address is shown as the owner. What is stored is never rewritten. */
export function presentSender(sender: ResolvedSender | undefined, profile: OwnerProfile | null | undefined): ResolvedSender | undefined {
  if (!sender || !fromOwnerDevice(sender)) return sender;
  const owner = ownerOf(profile);
  if (!owner.name) return sender;
  const { name: _label, avatarUrl: _photo, email: _none, ...kept } = sender;
  return { name: owner.name, ...kept, ...(owner.email ? { email: owner.email } : {}), ...(owner.avatarUrl ? { avatarUrl: owner.avatarUrl } : {}) };
}
