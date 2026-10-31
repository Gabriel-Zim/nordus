import { z } from "zod";
import type { AppSettingRequestService } from "../app-setting-requests.ts";
import { PASS, type RouteHandler } from "./table.ts";

/** The conversation tools that configure the app post their proposal here, inside the internal capability gate. */
export function createInternalAppSettingRoutes(deps: {
  service: AppSettingRequestService;
  bot(id: string): { id: string; name: string; color: string } | null | undefined;
  ownsThread(botId: string, threadId: string): { group?: unknown } | null | undefined;
  proposed(info: { requestId: string; detail: string; applied: boolean; state: string }): void;
}): RouteHandler {
  return async ({ req, res, path, method, json, readBody }) => {
    if (method !== "POST" || path !== "/api/internal/app-setting-requests") return PASS;
    const parsed = z.object({
      fromBotId: z.string().min(1).max(128),
      fromThreadId: z.string().min(1).max(128),
      forBotId: z.string().max(128).optional(),
      setting: z.unknown(),
      value: z.unknown(),
      reason: z.unknown(),
    }).strict().safeParse(await readBody(req));
    if (!parsed.success) return json(res, 400, { error: "invalid app setting proposal" });
    const body = parsed.data;
    const from = deps.bot(body.fromBotId);
    if (!from) return json(res, 403, { error: "unknown sender" });
    const owner = deps.ownsThread(from.id, body.fromThreadId);
    if (!owner) return json(res, 403, { error: "source conversation does not belong to sender" });
    try {
      const proposed = deps.service.submit({
        botId: from.id,
        threadId: body.fromThreadId,
        targetBotId: body.forBotId?.trim() || from.id,
        setting: body.setting,
        value: body.value,
        reason: body.reason,
        from: owner.group ? { botId: from.id, name: from.name, color: from.color } : undefined,
      });
      deps.proposed({ requestId: proposed.requestId, detail: proposed.detail, applied: proposed.state === "applied", state: proposed.state });
      return json(res, 201, { ...proposed, setting: String(body.setting), value: String(body.value) });
    } catch (error) {
      const status = error && typeof error === "object" && "status" in error ? Number(error.status) : 400;
      return json(res, Number.isFinite(status) ? status : 400, { error: error instanceof Error ? error.message : "invalid app setting proposal" });
    }
  };
}
