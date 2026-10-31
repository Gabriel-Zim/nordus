import type { LocaleKey } from "@/locales/choices";
import type { PersonRole } from "../../shared/people";

export const ROLE_LABEL: Record<PersonRole, LocaleKey> = {
  admin: "people.roleAdmin",
  member: "people.roleMember",
  guest: "people.roleGuest",
};

export const ROLE_HINT: Record<PersonRole, LocaleKey> = {
  admin: "people.roleAdminHint",
  member: "people.roleMemberHint",
  guest: "people.roleGuestHint",
};

/** From the most to the least a person can do. */
export const ASSIGNABLE_ROLES: readonly PersonRole[] = ["admin", "member", "guest"];
