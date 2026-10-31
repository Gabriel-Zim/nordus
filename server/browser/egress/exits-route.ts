// Nordus: o estado de cada saída de internet dos robôs, para o selo no navegador. Sem usuário, senha nem endereço de proxy.
import { PASS, type RouteHandler } from "../../routes/table.ts";
import type { Exit } from "./proxy-pool.ts";

const STATE_FRESH_MS = 30_000;

export interface ExitView { name: string; kind: "proxy" | "home"; state: "on" | "off" }

export interface ExitSource {
  exitList(): readonly Exit[];
  probeExits(): Promise<void>;
}

/** GET /api/browser/exits e /api/browser/home-internet: `configured` e `state` do selo ("on" quando alguma saída responde)
 * e `exits`, uma linha por saída. */
export function createExitsRoute(source: ExitSource, now: () => number = Date.now): RouteHandler {
  let checkedAt = -Infinity;
  return async ({ res, path, method, json }) => {
    if (path !== "/api/browser/exits" && path !== "/api/browser/home-internet") return PASS;
    if (method !== "GET") return json(res, 405, { error: "method not allowed" });
    let list = source.exitList();
    if (!list.length) return json(res, 200, { configured: false, state: "off", exits: [] });
    if (now() - checkedAt >= STATE_FRESH_MS || list.some((exit) => exit.state() === "unknown")) {
      checkedAt = now();
      await source.probeExits();
      list = source.exitList();
    }
    const exits: ExitView[] = list.map((exit) => ({ name: exit.name, kind: exit.kind, state: exit.state() === "online" ? "on" : "off" }));
    return json(res, 200, { configured: true, state: exits.some((exit) => exit.state === "on") ? "on" : "off", exits });
  };
}
