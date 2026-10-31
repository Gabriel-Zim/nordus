// Nordus: ensinar uma tarefa (frente G).
// GET  /api/bots/:id/teach            -> TeachStatus
// POST /api/bots/:id/teach/start      {threadId} -> 200 TeachStatus | 409 | 503
// POST /api/bots/:id/teach/stop       -> 202 {ok:true} (o resumo roda depois e a pergunta vai para a conversa)
// POST /api/bots/:id/teach/cancel     -> 200 {ok:true}
// GET  /api/bots/:id/teach/shot/:n    -> miniatura jpeg do passo n da gravacao atual ou da ultima
// Rota nova e so de administrador (default de server/request-auth.ts).
import { readFileSync } from "node:fs";
import type { TeachRecording, TeachStatus } from "../../shared/teach.ts";
import type { TeachRecorder } from "../teach/recorder.ts";
import { TeachError } from "../teach/recorder.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface TeachRouteDeps {
  recorder: Pick<TeachRecorder, "status" | "start" | "stop" | "cancel" | "shotPath">;
  botExists(botId: string): boolean;
  threadBelongsToBot(botId: string, threadId: string): boolean;
  /** "ok", ou o motivo de nao poder gravar neste robo. */
  browserState(botId: string): "ok" | "off" | "no-engine";
  /** Depois de parar: resume e pergunta na conversa. Nao e esperado pela resposta. */
  finish(recording: TeachRecording): void;
}

const ID = /^[\w-]{1,128}$/u;

export function createTeachRoutes(deps: TeachRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    const m = path.match(/^\/api\/bots\/([\w-]+)\/teach(?:\/(start|stop|cancel)|\/shot\/(\d{1,6}))?$/);
    if (!m) return PASS;
    const botId = m[1]!;
    const action = m[2];
    const shot = m[3];
    if (!deps.botExists(botId)) return json(res, 404, { error: "no such bot" });
    const owner = auth.kind === "session" ? auth.session.id : "local-owner";
    const admin = auth.scopes.includes("admin");

    if (!action && !shot) {
      if (method !== "GET") return PASS;
      res.setHeader("cache-control", "no-store");
      return json(res, 200, deps.recorder.status(botId) satisfies TeachStatus);
    }
    if (shot) {
      if (method !== "GET") return PASS;
      const file = deps.recorder.shotPath(botId, Number(shot));
      if (!file) return json(res, 404, { error: "no such step picture" });
      let bytes: Buffer;
      try { bytes = readFileSync(file); } catch { return json(res, 404, { error: "no such step picture" }); }
      res.writeHead(200, { "content-type": "image/jpeg", "content-length": bytes.length, "cache-control": "private, no-store", "x-content-type-options": "nosniff" });
      res.end(bytes);
      return;
    }
    if (method !== "POST") return PASS;
    try {
      if (action === "start") {
        const body = await readBody(req, 4096);
        const threadId = body && typeof body === "object" && typeof (body as { threadId?: unknown }).threadId === "string" ? (body as { threadId: string }).threadId : "";
        if (!ID.test(threadId) || !deps.threadBelongsToBot(botId, threadId)) return json(res, 400, { error: "Diga em qual conversa vou gravar." });
        const state = deps.browserState(botId);
        if (state === "no-engine") return json(res, 503, { error: "O navegador não está disponível neste servidor." });
        if (state === "off") return json(res, 409, { error: "Ligue o navegador deste robô primeiro." });
        return json(res, 200, await deps.recorder.start({ botId, threadId, owner }));
      }
      if (action === "stop") {
        const stopped = await deps.recorder.stop(botId, owner, { admin });
        if (!stopped) return json(res, 409, { error: "Não estou gravando agora." });
        deps.finish(stopped.recording);
        return json(res, 202, { ok: true });
      }
      deps.recorder.cancel(botId);
      return json(res, 200, { ok: true });
    } catch (error) {
      if (error instanceof TeachError) return json(res, error.status, { error: error.message });
      throw error;
    }
  };
}
