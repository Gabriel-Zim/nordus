// The answer is a verdict (and how long it took), never the key and never the vendor's raw body.
import type { ServerResponse } from "node:http";

import type { BotTagSuggestionRequest } from "../../shared/bot-tags.ts";
import type { AppConfig } from "../config.ts";
import { OPENROUTER_MODEL_ID_MAX } from "../decider/config.ts";
import type { Decider } from "../decider/index.ts";
import { createOpenRouterModelCatalog, type OpenRouterModelCatalog } from "../decider/openrouter-models.ts";
import { recentDeciderLog } from "../decider/log.ts";
import { suggestBotTags } from "../decider/nordus-uses.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface DeciderRouteDeps {
  decider: Pick<Decider, "testKey" | "choose">;
  models?: Pick<OpenRouterModelCatalog, "load">;
  config(): AppConfig;
  /** Where the decision log lives; without it the log route answers empty. */
  dataDir?: string;
}

const MAX_KEY_LENGTH = 512;
const TAG_ANSWER_KEPT_MS = 60_000;
const TAG_ANSWERS_KEPT_MAX = 64;

export function createDeciderRoutes(deps: DeciderRouteDeps): RouteHandler {
  const models = deps.models ?? createOpenRouterModelCatalog();
  const keptTags = new Map<string, { at: number; tags: string[] }>();

  async function tagsFor(asked: BotTagSuggestionRequest, res: ServerResponse): Promise<string[]> {
    const key = JSON.stringify(asked);
    const kept = keptTags.get(key);
    if (kept && Date.now() - kept.at < TAG_ANSWER_KEPT_MS) return kept.tags;
    keptTags.delete(key);
    const gaveUp = new AbortController();
    const onClose = () => { if (!res.writableEnded) gaveUp.abort(); };
    res.on("close", onClose);
    try {
      const tags = await suggestBotTags(deps.decider, asked, { signal: gaveUp.signal });
      if (tags.length) {
        keptTags.set(key, { at: Date.now(), tags });
        if (keptTags.size > TAG_ANSWERS_KEPT_MAX) keptTags.delete(keptTags.keys().next().value!);
      }
      return tags;
    } finally {
      res.off("close", onClose);
    }
  }

  return async ({ req, res, path, method, json, readBody }) => {
    if (path === "/api/decider/models" && method === "GET") {
      res.setHeader("cache-control", "no-store");
      return json(res, 200, await models.load(deps.config().decider?.openrouterBaseUrl));
    }
    // Nordus Registros: what Jev decided, never the message text (the log never holds it).
    if (path === "/api/decider/log" && method === "GET") {
      res.setHeader("cache-control", "no-store");
      return json(res, 200, { rows: deps.dataDir ? await recentDeciderLog(deps.dataDir) : [] });
    }
    if (path === "/api/bot-tag-suggestions" && method === "POST") {
      const body = await readBody(req, 16_384);
      const field = (key: string) => typeof body?.[key] === "string" ? body[key] as string : undefined;
      res.setHeader("cache-control", "no-store");
      return json(res, 200, { tags: await tagsFor({ name: field("name"), title: field("title"), description: field("description") }, res) });
    }
    if (path !== "/api/decider/test" || method !== "POST") return PASS;
    const body = await readBody(req, 8192);
    if (body?.key !== undefined && typeof body.key !== "string") return json(res, 400, { error: "key must be a string" });
    const draft = typeof body?.key === "string" ? body.key.trim() : "";
    if (draft.length > MAX_KEY_LENGTH) return json(res, 400, { error: "That does not look like an API key." });
    res.setHeader("cache-control", "no-store");
    const provider = body?.provider === "jev" || body?.provider === "openrouter" || body?.provider === "clef" ? body.provider : undefined;
    if (body?.model !== undefined && (typeof body.model !== "string" || body.model.length > OPENROUTER_MODEL_ID_MAX)) {
      return json(res, 400, { error: "model must be an OpenRouter model id" });
    }
    const model = typeof body?.model === "string" && body.model.trim() ? body.model.trim() : undefined;
    const api = body?.api === "decisions" || body?.api === "chat" ? body.api : undefined;
    const result = await deps.decider.testKey({
      ...(draft ? { key: draft } : {}),
      ...(provider ? { provider } : {}),
      ...(model ? { model } : {}),
      ...(api ? { api } : {}),
    });
    if (result.ok) return json(res, 200, { ok: true, latencyMs: result.latencyMs });
    return json(res, 200, { ok: false, reason: result.reason, ...(result.status ? { status: result.status } : {}) });
  };
}
