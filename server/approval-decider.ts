// Nordus: who answers for an agent, kept in one place.
import { ADMINS_LABEL, nameFromEmail } from "../shared/approvals.ts";
import { authIsGuest, ownsBot } from "./people-roles.ts";
import type { RequestAuth } from "./request-auth.ts";

export const ADMINS = ADMINS_LABEL;

export interface Decider {
  admin: boolean;
  email?: string;
  name?: string;
  guest?: true;
}

export function deciderOf(auth: RequestAuth): Decider {
  if (auth.kind === "loopback") return { admin: auth.trust !== "service" };
  const { email, name } = auth.session;
  return {
    admin: auth.scopes.includes("admin"),
    ...(email ? { email: email.trim().toLowerCase() } : {}),
    ...(name ? { name } : {}),
    ...(authIsGuest(auth) ? { guest: true as const } : {}),
  };
}

export function ownerOf(bot: object | null | undefined): string | undefined {
  const owner = (bot as { owner?: unknown } | null | undefined)?.owner;
  return typeof owner === "string" && owner.trim() ? owner.trim().toLowerCase() : undefined;
}

export function mayDecide(who: Decider, bot: object | null | undefined): boolean {
  return who.admin || ownsBot({ email: who.email, guest: who.guest }, { owner: ownerOf(bot) });
}

export function deciderName(bot: object | null | undefined, nameOf: (email: string) => string | undefined): string {
  const owner = ownerOf(bot);
  return owner ? nameOf(owner) ?? nameFromEmail(owner) : ADMINS;
}
