// Answering a propose_app_setting or add_mcp_server card: settle it, log the decision, tell the screen.
import type { ServerResponse } from "node:http";
import type { AppSettingRequestService } from "./app-setting-requests.ts";
import type { McpServerRequestService } from "./mcp-server-requests.ts";
import type { BotRecord } from "./store.ts";

type Json = (res: ServerResponse, status: number, body?: unknown) => unknown;

interface CardLike {
  requestId?: string;
  subtitle: string;
  answered?: string;
  appSettingRequest?: unknown;
  mcpServerRequest?: unknown;
}

export function appSettingResolvers(deps: {
  store: {
    messagesFor(threadId: string): Array<{ id: string; card?: CardLike }>;
    bot(id: string): BotRecord | null | undefined;
  };
  requests: AppSettingRequestService;
  mcps: McpServerRequestService;
  json: Json;
  decided(info: { threadId: string; requestId: string; botId: string; botName?: string; tool: string; summary: string; approved: boolean }): void;
  botChanged(bot: BotRecord): void;
}): {
  resolveAndSendAppSetting(res: ServerResponse, args: { botId: string; botName?: string; threadId: string; requestId: string; behavior: string }): boolean;
  resolveAndSendMcpServer(res: ServerResponse, args: { botId: string; botName?: string; threadId: string; requestId: string; behavior: string }): boolean;
} {
  const { store, json } = deps;
  const settled = (
    res: ServerResponse,
    result: { state: string; behavior?: string; error?: string; status?: number; targetBotId?: string; settlementPending?: boolean; message?: string },
    args: { botId: string; botName?: string; threadId: string; requestId: string },
    tool: string,
    summary: string,
  ): boolean => {
    if (result.state === "applied" || result.state === "denied" || result.state === "enabled") {
      deps.decided({ ...args, threadId: args.threadId, requestId: args.requestId, tool, summary, approved: result.state !== "denied" });
    }
    if (result.state === "applied" && result.targetBotId) {
      const target = store.bot(result.targetBotId);
      if (target) deps.botChanged(target);
    }
    if (result.state === "applied" || result.state === "enabled") {
      json(res, 200, { ok: true, outcome: "allowed-once", ...(result.settlementPending ? { settlementPending: true, message: result.message } : {}) });
      return true;
    }
    if (result.state === "invalid") { json(res, result.status ?? 400, { error: result.error }); return true; }
    if (result.state === "already_settled") {
      json(res, 200, { ok: true, outcome: result.behavior === "allow" ? "allowed-once" : "rejected", alreadySettled: true });
      return true;
    }
    json(res, 200, { ok: true, outcome: "rejected" });
    return true;
  };

  return {
    resolveAndSendAppSetting(res, args) {
      const card = store.messagesFor(args.threadId).find((message) => message.card?.requestId === args.requestId && message.card.appSettingRequest)?.card;
      if (!card) return false;
      const result = deps.requests.resolve(args);
      if (!result.claimed) return false;
      return settled(res, result, args, "update_app_setting", card.subtitle);
    },
    resolveAndSendMcpServer(res, args) {
      const card = store.messagesFor(args.threadId).find((message) => message.card?.requestId === args.requestId && message.card.mcpServerRequest)?.card;
      if (!card) return false;
      const result = deps.mcps.resolve(args);
      if (!result.claimed) return false;
      return settled(res, result, args, "add_mcp_server", card.subtitle);
    },
  };
}
