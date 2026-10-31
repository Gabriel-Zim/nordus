import { useEffect, useState } from "react";
import { fromOwnerDevice } from "../../shared/person-identity";
import type { ResolvedSender } from "../../shared/wire";
import { sessionOnce, type SessionState } from "./session";

export interface Me {
  email?: string;
  name?: string;
  /** The owner's browser: their own machine, or a device paired by code that holds the admin scope. */
  owner?: true;
}

function same(a?: string, b?: string): boolean {
  return Boolean(a && b && a.trim().toLowerCase() === b.trim().toLowerCase());
}

/** The sender when another person wrote the message; undefined when it is mine or carries no sender. The owner's browser also
 * takes the lines of the owner's paired devices (admin stamp, no email) for its own. */
export function otherAuthor(sender: ResolvedSender | undefined, me: Me): ResolvedSender | undefined {
  if (!sender) return undefined;
  if (me.owner && fromOwnerDevice(sender)) return undefined;
  if (sender.email && me.email) return same(sender.email, me.email) ? undefined : sender;
  return same(sender.name, me.name) ? undefined : sender;
}

export function senderInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words.length ? words.slice(0, 2).map((word) => word[0]!.toUpperCase()).join("") : "?";
}

function sessionMe(state: SessionState): Me | "owner" | undefined {
  if (state.kind === "loopback") return state.trust === "service" ? undefined : "owner";
  if (state.kind !== "session") return undefined;
  const { person } = state;
  if (person) return { ...(person.owner ? { owner: true as const } : {}), name: person.name, email: person.email ?? state.email };
  if (!state.email && state.scopes.includes("admin")) return "owner";
  return { email: state.email, name: state.name ?? state.email?.split("@")[0] };
}

/** Who this browser is: the signed-in person, else the owner's profile on this machine. */
export function useMe(profile?: { name?: string; email?: string }): Me {
  const [known, setKnown] = useState<Me | "owner" | null>(null);
  useEffect(() => {
    let live = true;
    sessionOnce().then((state) => {
      const next = sessionMe(state);
      if (live && next) setKnown(next);
    }, () => undefined);
    return () => { live = false; };
  }, []);
  const local: Me = { email: profile?.email?.trim() || undefined, name: profile?.name?.trim() || undefined };
  if (known === "owner") return { ...local, owner: true };
  return known ?? local;
}
