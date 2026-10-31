// Nordus: GET /api/inbox, the inbox page's three lists for whoever asks.
import { INBOX_PATH } from "../../shared/approvals.ts";
import type { NotificationLogEntry } from "../../shared/notification.ts";
import { deciderOf } from "../approval-decider.ts";
import { inboxSections } from "../inbox-sections.ts";
import { approvalsViewer, type ApprovalRoutesDeps } from "./approvals.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface InboxRouteDeps extends Pick<ApprovalRoutesDeps, "index" | "visibleFor" | "refusal"> {
  log: () => NotificationLogEntry[];
}

export function createInboxRoutes(deps: InboxRouteDeps): RouteHandler {
  return async ({ res, path, method, auth, json }) => {
    if (path !== INBOX_PATH) return PASS;
    if (method !== "GET") return json(res, 405, { error: "method not allowed" });
    res.setHeader("cache-control", "no-store");
    const viewer = approvalsViewer(deps, auth);
    const who = deciderOf(auth);
    return json(res, 200, inboxSections({
      waiting: deps.index.items(viewer),
      log: deps.log(),
      viewer: { admin: who.admin, ...(who.email ? { email: who.email } : {}), visible: viewer.visible },
    }));
  };
}
