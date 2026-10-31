import type { VisibleSet } from "../bot-visibility.ts";
import type { PeopleDirectory } from "../people-directory.ts";
import { authIsAdmin, authIsGuest } from "../people-roles.ts";
import type { RequestAuth } from "../request-auth.ts";
import { checkedRoomPeople } from "../room-people.ts";
import type { GroupRecord, Store } from "../store.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface PeopleRouteDeps {
  directory: PeopleDirectory;
  store: Pick<Store, "group" | "patchGroup">;
  visibleFor(auth: RequestAuth): VisibleSet;
  /** Who this caller is as a person: their sign-in address, or the owner's profile address on the desktop. */
  emailOf(auth: RequestAuth): string | undefined;
  audienceChanged(): void;
  publicGroupState(group: GroupRecord): unknown;
}

const ROOM_PEOPLE = /^\/api\/people\/rooms\/([\w-]+)\/people$/;

export function createPeopleRoutes(deps: PeopleRouteDeps): RouteHandler {
  const { directory, store } = deps;
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (method === "GET" && path === "/api/people/directory") {
      return json(res, 200, directory.forViewer({ email: deps.emailOf(auth), admin: authIsAdmin(auth), guest: authIsGuest(auth) }));
    }
    const room = ROOM_PEOPLE.exec(path);
    if (!room || method !== "PUT") return PASS;
    const group = store.group(room[1]!);
    if (!group || group.dm || !deps.visibleFor(auth).group(group.id)) return json(res, 404, { error: "no such channel" });
    const email = deps.emailOf(auth);
    if (!authIsAdmin(auth) && (authIsGuest(auth) || !email || group.createdBy !== email)) {
      return json(res, 403, { error: "only an admin or the person who opened this channel chooses who is in it" });
    }
    if (group.general) return json(res, 400, { error: "the general channel is for everyone" });
    const body = await readBody(req);
    const checked = checkedRoomPeople(body?.people, group.createdBy, (candidate) => directory.roleOf(candidate) !== null);
    if (!checked.ok) return json(res, 400, { error: checked.error });
    const updated = store.patchGroup(group.id, { people: checked.people });
    if (!updated) return json(res, 404, { error: "no such channel" });
    deps.audienceChanged();
    return json(res, 200, { group: deps.publicGroupState(updated) });
  };
}

