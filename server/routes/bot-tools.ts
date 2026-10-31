import { botMcpServerNames } from "../../shared/bot-mcp-servers.ts";
import { isSensitiveTool } from "../../shared/outbound.ts";
import { parseToolScope } from "../../shared/tool-scope.ts";
import { availableTools } from "../drivers/agents-catalog.ts";
import type { BotRecord } from "../store.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface BotToolRow {
  selector: string;
  name: string;
  description: string;
  sensitive: boolean;
  blocked: boolean;
}

function firstSentence(text: string): string {
  const flat = text.replace(/\s+/g, " ").replaceAll("Nordus", "Nordus AI").trim();
  const end = flat.search(/[.!?](\s|$)/);
  return (end > 0 ? flat.slice(0, end + 1) : flat).slice(0, 180);
}

/** GET /api/bots/:id/tools: the app's own tools and the MCP servers this bot may use, each with its block state. */
export function createBotToolRoutes(deps: {
  bot: (botId: string) => BotRecord | undefined;
  internalBot: (bot: BotRecord) => boolean;
  mcpServerNames: () => string[];
  explicitMcpServerNames: () => string[];
}): RouteHandler {
  return async ({ res, path, method, json }) => {
    const m = path.match(/^\/api\/bots\/([\w-]+)\/tools$/);
    if (!m || method !== "GET") return PASS;
    const bot = deps.bot(m[1]!);
    if (!bot) return json(res, 404, { error: "no such bot" });
    const parsed = parseToolScope(bot.toolScope);
    const deny = new Set(parsed.ok ? parsed.scope?.deny ?? [] : []);
    const agents = availableTools({
      skillAuthoring: true,
      sharedComputers: true,
      voiceNotes: bot.voiceNotes !== false,
      cloudHome: false,
      memoryEnabled: bot.memoryEnabled !== false,
      chief: Boolean(bot.chiefOfStaff),
      botId: bot.id,
    }).map((tool): BotToolRow => {
      const selector = `mcp:agents:${tool.name}`;
      return {
        selector,
        name: tool.name,
        description: firstSentence(tool.description),
        sensitive: isSensitiveTool(`mcp__agents__${tool.name}`),
        blocked: deny.has(selector) || deny.has("mcp:agents:*"),
      };
    });
    const allowed = botMcpServerNames(bot.mcpServers, deps.internalBot(bot));
    const explicit = deps.explicitMcpServerNames();
    const servers = deps.mcpServerNames().filter((name) => allowed ? allowed.includes(name) : !explicit.includes(name));
    return json(res, 200, {
      engineKind: bot.modelSelection.instanceId,
      groups: [{ id: "agents", tools: agents }],
      servers: servers.map((name) => ({ id: name, blockedAll: deny.has(`mcp:${name}:*`), blocked: [...deny].filter((selector) => selector.startsWith(`mcp:${name}:`)) })),
      deny: [...deny],
    });
  };
}
