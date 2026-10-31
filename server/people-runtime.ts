import { join } from "node:path";

import { normalizePersonEmail } from "../shared/people.ts";
import type { SignInAllowList } from "./account-signin.ts";
import type { AppConfig } from "./config.ts";
import { DirectMessages } from "./direct-messages.ts";
import { PeopleDirectory } from "./people-directory.ts";
import { authEmail, authIsOwnerDesktop } from "./people-roles.ts";
import type { RequestAuth } from "./request-auth.ts";
import type { SessionRegistry } from "./sessions.ts";
import type { Store } from "./store.ts";

export interface PeopleRuntimeDeps {
  dataDir: string;
  cfg(): AppConfig;
  sessions: Pick<SessionRegistry, "list" | "onSessionIssued">;
  lists(): SignInAllowList;
  store: Pick<Store, "groups">;
}

/** The people side of the workspace: who is here under what name, and the direct messages between two of them. */
export function createPeopleRuntime(deps: PeopleRuntimeDeps) {
  const directory = new PeopleDirectory({
    file: join(deps.dataDir, "people-names.json"),
    lists: deps.lists,
    signedIn: () => deps.sessions.list().map((session) => ({ email: session.email, name: session.name })),
    profile: () => deps.cfg().profile ?? {},
    shareRoom: (a, b) => deps.store.groups.some((group) => group.people?.includes(a) && group.people.includes(b)),
  });
  for (const session of deps.sessions.list()) directory.remember(session.email, session.name);
  deps.sessions.onSessionIssued((session) => directory.remember(session.email, session.name));
  const dms = new DirectMessages({ file: join(deps.dataDir, "direct-messages.json"), nameOf: (email) => directory.nameOf(email) });
  /** A person's address: the one they signed in with, or the owner's own on their desktop, which never asks them to. A session
   * without an address is nobody, whatever its scope and whatever the profile says: an admin can pair one and edit the profile. */
  const emailOf = (auth: RequestAuth): string | undefined =>
    authEmail(auth) ?? (authIsOwnerDesktop(auth) ? normalizePersonEmail(deps.cfg().profile?.email) ?? undefined : undefined);
  return { directory, dms, emailOf };
}

export type PeopleRuntime = ReturnType<typeof createPeopleRuntime>;
