import { loadConfig, saveConfig, type AppConfig } from "../config.ts";
import type { JoinRequests } from "../join-requests.ts";
import type { SessionRegistry } from "../sessions.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface PeopleJoinRouteDeps {
  joinRequests: JoinRequests;
  cfg: AppConfig;
  sessions: Pick<SessionRegistry, "revalidateEmailSessions">;
  open(): boolean;
}

const DECISION = /^\/api\/people\/join\/requests\/([^/]+)\/(approve|reject)$/;

export function createPeopleJoinRoutes(deps: PeopleJoinRouteDeps): RouteHandler {
  const { joinRequests, cfg, sessions, open } = deps;
  const state = () => ({ link: joinRequests.link(), requests: joinRequests.list() });
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (path !== "/api/people/join" && !path.startsWith("/api/people/join/")) return PASS;
    if (!open()) return json(res, 403, { error: "invite links are not available on this server" });
    if (!auth.scopes.includes("admin")) return json(res, 403, { error: "only an admin can manage invitations" });
    if (path === "/api/people/join") {
      if (method !== "GET") return PASS;
      return json(res, 200, state());
    }
    if (path === "/api/people/join/link") {
      if (method === "POST") return json(res, 200, { link: joinRequests.rotateLink() });
      if (method === "DELETE") {
        joinRequests.revokeLink();
        return json(res, 200, { link: null });
      }
      return PASS;
    }
    const decision = DECISION.exec(path);
    if (!decision || method !== "POST") return PASS;
    let id: string;
    try {
      id = decodeURIComponent(decision[1]!);
    } catch {
      return json(res, 400, { error: "that request id is not valid" });
    }
    if (decision[2] === "reject") {
      return joinRequests.take(id) ? json(res, 200, { ok: true }) : json(res, 404, { error: "that request is no longer waiting" });
    }
    const body = await readBody(req);
    if (body?.role !== undefined && body.role !== "member" && body.role !== "admin" && body.role !== "guest") {
      return json(res, 400, { error: "role must be member, admin or guest" });
    }
    const pending = joinRequests.list().find((request) => request.id === id);
    if (!pending) return json(res, 404, { error: "that request is no longer waiting" });
    const admins = [...(cfg.signIn?.admins ?? [])];
    const members = [...(cfg.signIn?.members ?? [])];
    const guests = [...(cfg.signIn?.guests ?? [])];
    const listed = (entry: string) => entry.trim().toLowerCase() === pending.email;
    if (!admins.some(listed) && !members.some(listed) && !guests.some(listed)) {
      (body?.role === "admin" ? admins : body?.role === "guest" ? guests : members).push(pending.email);
    }
    saveConfig({ signIn: { admins, members, guests } });
    Object.assign(cfg, loadConfig());
    sessions.revalidateEmailSessions();
    joinRequests.take(id);
    return json(res, 200, { ok: true });
  };
}
