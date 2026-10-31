// Nordus: o estado da internet de casa para o selo no navegador do robô.
import { PASS, type RouteHandler } from "../../routes/table.ts";
import type { HomeLink } from "./home-link.ts";

const STATE_FRESH_MS = 30_000;

/** GET /api/browser/home-internet: se esta instalação usa a internet de casa e se o Mac responde agora. */
export function createHomeInternetRoute(link: () => HomeLink | null, now: () => number = Date.now): RouteHandler {
  let checked = { at: -Infinity, link: null as HomeLink | null };
  return async ({ res, path, method, json }) => {
    if (path !== "/api/browser/home-internet") return PASS;
    if (method !== "GET") return json(res, 405, { error: "method not allowed" });
    const current = link();
    if (!current) return json(res, 200, { configured: false, state: "off" });
    if (checked.link !== current || now() - checked.at >= STATE_FRESH_MS || current.state() === "unknown") {
      checked = { at: now(), link: current };
      await current.probe();
    }
    return json(res, 200, { configured: true, state: current.state() === "online" ? "on" : "off" });
  };
}
