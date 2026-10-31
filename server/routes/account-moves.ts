import { AccountMoveError, type AccountMoves } from "../account-moves.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface AccountMoveRouteDeps {
  moves: Pick<AccountMoves, "list" | "create" | "undo" | "cancel" | "presets" | "savePreset" | "removePreset">;
}

/**
 * Batches that move robots between model accounts, and the saved splits. None of these paths is listed for client
 * sessions in request-auth, so they need the admin scope like every route that changes a robot's engine.
 */
export function createAccountMoveRoutes(deps: AccountMoveRouteDeps): RouteHandler {
  const { moves } = deps;
  return async ({ req, res, path, method, json, readBody }) => {
    try {
      if (path === "/api/account-moves") {
        if (method === "GET") {
          res.setHeader("cache-control", "no-store");
          return json(res, 200, { batches: moves.list() });
        }
        if (method === "POST") {
          const body = await readBody(req, 512_000);
          if (!body || typeof body !== "object" || Array.isArray(body)) return json(res, 400, { error: "body must be a JSON object" });
          return json(res, 200, { batch: await moves.create({ label: body.label, targets: body.targets }) });
        }
        return PASS;
      }
      let m = path.match(/^\/api\/account-moves\/([\w-]+)\/(undo|cancel)$/);
      if (m && method === "POST") {
        return json(res, 200, { batch: m[2] === "undo" ? await moves.undo(m[1]!) : await moves.cancel(m[1]!) });
      }
      if (path === "/api/account-presets" && method === "GET") {
        res.setHeader("cache-control", "no-store");
        return json(res, 200, { presets: moves.presets() });
      }
      if (path === "/api/account-presets" && method === "PUT") {
        const body = await readBody(req, 512_000);
        if (!body || typeof body !== "object" || Array.isArray(body)) return json(res, 400, { error: "body must be a JSON object" });
        return json(res, 200, { preset: await moves.savePreset({ id: body.id, name: body.name, targets: body.targets }) });
      }
      m = path.match(/^\/api\/account-presets\/([\w-]+)$/);
      if (m && method === "DELETE") {
        return (await moves.removePreset(m[1]!))
          ? json(res, 200, { ok: true })
          : json(res, 404, { error: "no such preset" });
      }
    } catch (error) {
      if (error instanceof AccountMoveError) return json(res, error.status, { error: error.message });
      throw error;
    }
    return PASS;
  };
}
