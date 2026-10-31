import type { Notification } from "../../shared/notification.ts";
import { normalizePersonEmail } from "../../shared/people.ts";
import type { DirectMessages } from "../direct-messages.ts";
import type { PeopleDirectory } from "../people-directory.ts";
import { directMessageNotification } from "../people-notify.ts";
import { DM_SEND_WINDOWS, rateLimit, type RateWindow } from "../people-limits.ts";
import { authIsAdmin, authIsGuest } from "../people-roles.ts";
import type { RequestAuth } from "../request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface DmRouteDeps {
  dms: DirectMessages;
  directory: PeopleDirectory;
  /** Who this caller is as a person: their sign-in address, or the owner's profile address on the desktop. */
  emailOf(auth: RequestAuth): string | undefined;
  /** Sends a live frame to these people's open windows and nobody else's. */
  sendTo(emails: readonly string[], payload: Record<string, unknown>): void;
  notify(notification: Notification): void;
  /** How many lines one person may send inside which windows; the defaults hold a person to a chat pace. */
  sendWindows?: readonly RateWindow[];
  now?: () => number;
}

const DM_PATH = /^\/api\/dms(?:\/([\w-]+)\/(messages|read))?$/;
const NOT_FOUND = { error: "no such conversation" };

export function createDmRoutes(deps: DmRouteDeps): RouteHandler {
  const { dms, directory } = deps;
  const mayWrite = rateLimit(deps.sendWindows ?? DM_SEND_WINDOWS, deps.now);
  return async ({ req, res, url, path, method, auth, json, readBody }) => {
    const match = DM_PATH.exec(path);
    if (!match) return PASS;
    const me = deps.emailOf(auth);
    if (!me) return json(res, 403, { error: "sign in with your email to send direct messages" });
    const [, id, part] = match;
    if (!id) {
      if (method === "GET") return json(res, 200, { dms: dms.list(me) });
      if (method !== "POST") return PASS;
      const body = await readBody(req);
      const peer = normalizePersonEmail(body?.peer);
      if (!peer || peer === me || !directory.mayReach({ email: me, admin: authIsAdmin(auth), guest: authIsGuest(auth) }, peer)) {
        return json(res, 404, { error: "no such person" });
      }
      if (!dms.canOpen(me, peer)) return json(res, 409, { error: "you or that person already hold as many direct conversations as are allowed" });
      const dm = dms.open(me, peer);
      if (!dm) return json(res, 404, { error: "no such person" });
      deps.sendTo([me], { kind: "dm", dm });
      return json(res, 200, { dm });
    }
    if (part === "messages" && method === "GET") {
      const limit = url.searchParams.get("limit");
      const page = dms.page(id, me, { before: url.searchParams.get("before") ?? undefined, ...(limit ? { limit: Number(limit) } : {}) });
      return page ? json(res, 200, page) : json(res, 404, NOT_FOUND);
    }
    if (part === "messages" && method === "POST") {
      const body = await readBody(req, 32_768);
      if (typeof body?.text !== "string" || !body.text.trim()) return json(res, 400, { error: "text must not be empty" });
      if (!mayWrite(me)) return json(res, 429, { error: "too many messages in a short while; slow down" });
      const posted = dms.post(id, me, body.text);
      if (!posted) return json(res, 404, NOT_FOUND);
      const [peer] = posted.record.people.filter((email) => email !== me);
      for (const person of posted.record.people) {
        deps.sendTo([person], { kind: "dm.message", dmId: id, message: posted.message });
        deps.sendTo([person], { kind: "dm", dm: dms.viewFor(posted.record, person) });
      }
      if (peer) {
        deps.notify(directMessageNotification({
          threadId: dms.viewFor(posted.record, peer).threadId,
          groupId: id,
          from: { name: posted.message.name, email: me },
          to: peer,
          text: posted.message.text,
        }));
      }
      return json(res, 201, { message: posted.message });
    }
    if (part === "read" && method === "POST") {
      const dm = dms.markRead(id, me);
      if (!dm) return json(res, 404, NOT_FOUND);
      deps.sendTo([me], { kind: "dm", dm });
      return json(res, 200, { dm });
    }
    return PASS;
  };
}
