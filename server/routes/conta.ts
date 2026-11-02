import type { ContaRuntime } from "../conta-runtime.ts";
import { PASS, type RouteHandler } from "./table.ts";

/** Settings → Acesso remoto: link this server to a Nordus account. Admin only (no CLIENT_ALLOW entry). */
export function createContaRoutes(runtime: ContaRuntime): RouteHandler {
  return async ({ res, path, method, json }) => {
    if (path === "/api/conta" && method === "GET") return json(res, 200, runtime.status());
    if (path === "/api/conta/conectar" && method === "POST") return json(res, 200, runtime.connect());
    if (path === "/api/conta/desconectar" && method === "POST") return json(res, 200, await runtime.disconnect());
    return PASS;
  };
}
