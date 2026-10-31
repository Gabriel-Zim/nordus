import { botBudgetState, monthTotal, setBotBudget } from "../bot-budgets.ts";
import { authIsAdmin, ownsBot, withoutMoney } from "../people-roles.ts";
import { PASS, type RouteHandler } from "./table.ts";

export function createBotBudgetRoutes(deps: { dataDir: string; botExists: (botId: string) => boolean; ownerOf?: (botId: string) => string | undefined }): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (method === "GET" && path === "/api/budget/month") return json(res, 200, monthTotal(deps.dataDir));
    const m = path.match(/^\/api\/bots\/([\w-]+)\/budget$/);
    if (!m) return PASS;
    const botId = m[1]!;
    if (!deps.botExists(botId)) return json(res, 404, { error: "no such bot" });
    const admin = authIsAdmin(auth);
    if (!admin && !ownsBot(auth, { owner: deps.ownerOf?.(botId) })) {
      return json(res, 403, { error: "only an admin or the person this agent answers to can see or change its budget" });
    }
    const shown = () => (admin ? botBudgetState(deps.dataDir, botId) : withoutMoney(botBudgetState(deps.dataDir, botId)));
    if (method === "GET") return json(res, 200, shown());
    if (method === "PUT") {
      const body = (await readBody(req, 4096)) as { monthlyUsd?: unknown };
      const value = body.monthlyUsd;
      if (value !== null && (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 100_000)) {
        return json(res, 400, { error: "monthlyUsd must be a positive number of dollars, or null" });
      }
      setBotBudget(deps.dataDir, botId, value as number | null);
      return json(res, 200, shown());
    }
    return PASS;
  };
}
