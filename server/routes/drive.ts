import { serveStored } from "../knowledge/serve.ts";
import {
  adminOnly,
  answerKnowledgeError,
  asObject,
  declaredLength,
  JSON_BODY_LIMIT,
  optionalVersion,
  requesterFor,
  requiredText,
  sessionFor,
  sessionForConversation,
  versionNumber,
  type KnowledgeHttpDeps,
} from "./knowledge-http.ts";
import { PASS, type RouteContext, type RouteHandler } from "./table.ts";

async function handleDrive(deps: KnowledgeHttpDeps, ctx: RouteContext): Promise<typeof PASS | void> {
  const { req, res, url, path, method, json, readBody } = ctx;
  const query = (name: string) => url.searchParams.get(name);
  const body = async () => asObject(await readBody(req, JSON_BODY_LIMIT));
  switch (`${method} ${path}`) {
    case "GET /api/drive/spaces": {
      const asker = requesterFor(deps, ctx);
      return json(res, 200, { spaces: deps.service.describe(asker), admin: asker.access.admin });
    }
    case "GET /api/drive/internal-people":
      adminOnly(deps, ctx);
      return json(res, 200, { people: deps.service.internalPeople() });
    case "PUT /api/drive/internal-people": {
      adminOnly(deps, ctx);
      return json(res, 200, { people: deps.service.setInternalPeople((await body()).people) });
    }
    case "GET /api/drive/list":
      return json(res, 200, sessionFor(deps, ctx, query("space")).drive.list(query("path") ?? ""));
    case "GET /api/drive/search":
      return json(res, 200, { files: sessionFor(deps, ctx, query("space")).drive.search(query("q")) });
    case "GET /api/drive/info":
      return json(res, 200, sessionFor(deps, ctx, query("space")).drive.info(query("path")));
    case "GET /api/drive/download":
    case "GET /api/drive/preview": {
      const opened = sessionFor(deps, ctx, query("space")).drive.open(query("path"), optionalVersion(query("version")));
      if (!serveStored(req, res, opened, path.endsWith("/download") ? "download" : "preview")) {
        return json(res, 415, { error: "this file has no safe preview; download it instead", code: "no_preview" });
      }
      return;
    }
    case "POST /api/drive/folder": {
      const data = await body();
      const made = sessionFor(deps, ctx, data.space).drive.createFolder(data.path);
      return json(res, made.created ? 201 : 200, made);
    }
    case "PUT /api/drive/file": {
      let declared: number | undefined;
      try {
        declared = declaredLength(req);
        const conversation = query("conversation");
        const session = conversation ? sessionForConversation(deps, ctx, conversation) : sessionFor(deps, ctx, query("space"));
        const chunks = req.iterator({ destroyOnReturn: false }) as AsyncIterable<Buffer>;
        const note = query("note") ?? undefined;
        const saved = await session.drive.save(query("path"), chunks, { ...(note ? { note } : {}), ...(declared !== undefined ? { declaredSize: declared } : {}) });
        return json(res, saved.outcome === "created" ? 201 : 200, { ...saved, space: session.space.id });
      } finally {
        req.resume();
      }
    }
    case "POST /api/drive/restore": {
      const data = await body();
      return json(res, 200, sessionFor(deps, ctx, data.space).drive.restoreVersion(data.path, versionNumber(data.version)));
    }
    case "POST /api/drive/move": {
      const data = await body();
      return json(res, 200, sessionFor(deps, ctx, data.space).drive.move(data.from, data.to));
    }
    case "DELETE /api/drive/file":
      return json(res, 200, sessionFor(deps, ctx, query("space")).drive.remove(query("path")));
    case "GET /api/drive/trash":
      return json(res, 200, { items: sessionFor(deps, ctx, query("space")).drive.trash() });
    case "POST /api/drive/trash/restore": {
      const data = await body();
      return json(res, 200, { file: sessionFor(deps, ctx, data.space).drive.restoreFromTrash(requiredText(data.id, "id")) });
    }
    default:
      return PASS;
  }
}

export function createDriveRoutes(deps: KnowledgeHttpDeps): RouteHandler {
  return async (ctx) => {
    if (!ctx.path.startsWith("/api/drive/")) return PASS;
    try {
      return await handleDrive(deps, ctx);
    } catch (error) {
      if (answerKnowledgeError(ctx, error)) return;
      throw error;
    }
  };
}
