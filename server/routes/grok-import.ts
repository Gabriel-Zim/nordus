import type { WireBot, WireGroup } from "../../shared/wire.ts";
import { GROK_IMPORT_MAX_MESSAGES, GrokImportError, importGrokHistory, parseGrokImport } from "../grok-import.ts";
import type { BotRecord, GroupRecord, Store } from "../store.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface GrokImportRouteDeps {
  store: Store;
  broadcast(payload: Record<string, unknown>): void;
  publicBot(bot: BotRecord): WireBot;
  groupWithThread(group: GroupRecord): WireGroup;
}

/** POST /api/nordus/import-grok: one Grok conversation into its own, inactive conversation. Owner or admin only. */
export function createGrokImportRoutes(deps: GrokImportRouteDeps): RouteHandler {
  const { store, broadcast, publicBot, groupWithThread } = deps;
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (method !== "POST" || path !== "/api/nordus/import-grok") return PASS;
    const admin = auth.kind === "loopback" ? auth.trust !== "service" : auth.scopes.includes("admin");
    if (!admin) return json(res, 403, { error: "Só o dono do espaço pode importar histórico." });
    const body = await readBody(req, GROK_IMPORT_MAX_MESSAGES * 2_000);
    try {
      const input = parseGrokImport(body);
      const result = importGrokHistory(store, input);
      // A transcript import writes without store message events: this frame carries the new conversation to open clients.
      if (input.target.kind === "bot") broadcast({ kind: "bot", bot: publicBot(store.bot(input.target.id)!) });
      else broadcast({ kind: "group", group: groupWithThread(store.group(input.target.id)!) });
      return json(res, 201, result);
    } catch (error) {
      if (error instanceof GrokImportError) return json(res, error.status, { error: error.message });
      throw error;
    }
  };
}
