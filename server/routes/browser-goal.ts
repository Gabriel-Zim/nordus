// A member reads only conversations shown to them: bot visibility answers an unseen one with "not found" before this runs.
import type { GoalLive } from "../browser-goal/live.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface BrowserGoalRouteDeps {
  live: Pick<GoalLive, "list">;
  threadExists(threadId: string): boolean;
}

export function createBrowserGoalRoutes(deps: BrowserGoalRouteDeps): RouteHandler {
  return async ({ res, url, path, method, json }) => {
    if (method !== "GET") return PASS;
    const m = /^\/api\/threads\/([\w-]+)\/browser-goals$/u.exec(path);
    if (!m) return PASS;
    if (!deps.threadExists(m[1]!)) return json(res, 404, { error: "no such conversation" });
    const run = url.searchParams.get("run");
    if (run !== null && !/^[\w-]{1,64}$/u.test(run)) return json(res, 400, { error: "run must be a run id" });
    res.setHeader("cache-control", "no-store");
    return json(res, 200, { threadId: m[1], runs: deps.live.list(m[1]!, run ?? undefined) });
  };
}
