import {
  answerKnowledgeError,
  asObject,
  declaredLength,
  JSON_BODY_LIMIT,
  requesterFor,
  requiredText,
  sessionFor,
  versionNumber,
  type KnowledgeHttpDeps,
} from "./knowledge-http.ts";
import { PASS, type RouteContext, type RouteHandler } from "./table.ts";

async function handleWiki(deps: KnowledgeHttpDeps, ctx: RouteContext): Promise<typeof PASS | void> {
  const { req, res, url, path, method, json, readBody } = ctx;
  const query = (name: string) => url.searchParams.get(name);
  const body = async () => asObject(await readBody(req, JSON_BODY_LIMIT));
  switch (`${method} ${path}`) {
    case "GET /api/wiki/spaces":
      return json(res, 200, { spaces: deps.service.describe(requesterFor(deps, ctx)) });
    case "GET /api/wiki/pages":
      return json(res, 200, sessionFor(deps, ctx, query("space")).wiki.list({ q: query("q") ?? undefined, folder: query("folder") ?? undefined, tag: query("tag") ?? undefined }));
    case "GET /api/wiki/page":
      return json(res, 200, sessionFor(deps, ctx, query("space")).wiki.page(requiredText(query("id"), "id")));
    case "POST /api/wiki/page": {
      const data = await body();
      const saved = sessionFor(deps, ctx, data.space).wiki.create(data);
      return json(res, saved.outcome === "created" ? 201 : 200, saved);
    }
    case "PATCH /api/wiki/page": {
      const data = await body();
      return json(res, 200, sessionFor(deps, ctx, data.space).wiki.update(requiredText(data.id, "id"), data));
    }
    case "DELETE /api/wiki/page": {
      sessionFor(deps, ctx, query("space")).wiki.remove(requiredText(query("id"), "id"));
      return json(res, 200, { ok: true });
    }
    case "GET /api/wiki/versions":
      return json(res, 200, { versions: sessionFor(deps, ctx, query("space")).wiki.versions(requiredText(query("id"), "id")) });
    case "GET /api/wiki/version":
      return json(res, 200, sessionFor(deps, ctx, query("space")).wiki.versionContent(requiredText(query("id"), "id"), versionNumber(query("n"), "n")));
    case "POST /api/wiki/restore": {
      const data = await body();
      return json(res, 200, sessionFor(deps, ctx, data.space).wiki.restoreVersion(requiredText(data.id, "id"), versionNumber(data.version)));
    }
    case "GET /api/wiki/graph":
      return json(res, 200, sessionFor(deps, ctx, query("space")).wiki.graph());
    case "GET /api/wiki/trash":
      return json(res, 200, { items: sessionFor(deps, ctx, query("space")).wiki.trash() });
    case "POST /api/wiki/trash/restore": {
      const data = await body();
      return json(res, 200, { page: sessionFor(deps, ctx, data.space).wiki.restoreFromTrash(requiredText(data.id, "id")) });
    }
    case "POST /api/wiki/import/start": {
      const data = await body();
      const session = sessionFor(deps, ctx, data.space);
      return json(res, 201, deps.service.imports.start(session.space, session.who, data.root));
    }
    case "PUT /api/wiki/import/file": {
      try {
        const session = sessionFor(deps, ctx, query("space"));
        const chunks = req.iterator({ destroyOnReturn: false }) as AsyncIterable<Buffer>;
        const declared = declaredLength(req);
        return json(res, 200, await deps.service.imports.addFile(session.space, session.who, requiredText(query("session"), "session"), query("path"), chunks, declared));
      } finally {
        req.resume();
      }
    }
    case "POST /api/wiki/import/finish": {
      const data = await body();
      const session = sessionFor(deps, ctx, data.space);
      return json(res, 200, await deps.service.imports.finish(session.space, session.who, requiredText(data.session, "session")));
    }
    case "POST /api/wiki/import/cancel": {
      const data = await body();
      const session = sessionFor(deps, ctx, data.space);
      deps.service.imports.cancel(session.space, session.who, requiredText(data.session, "session"));
      return json(res, 200, { ok: true });
    }
    default:
      return PASS;
  }
}

export function createWikiRoutes(deps: KnowledgeHttpDeps): RouteHandler {
  return async (ctx) => {
    if (!ctx.path.startsWith("/api/wiki/")) return PASS;
    try {
      return await handleWiki(deps, ctx);
    } catch (error) {
      if (answerKnowledgeError(ctx, error)) return;
      throw error;
    }
  };
}
