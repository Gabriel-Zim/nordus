// The two conversation tools that configure the app itself: a helper connection
// and an app setting. Both are answered by the server, never applied here.
import type { Json } from "./agents-client.ts";
import { confirmationResult } from "./agents-proposal-results.ts";

type Api = (path: string, init: { method: string; body: string }) => Promise<Json>;

export async function setupToolResult(
  name: string,
  args: Json,
  api: Api,
  ids: { botId: string; threadId: string },
): Promise<{ text: string; isError?: boolean } | undefined> {
  if (name === "add_mcp_server") {
    let saved: Json;
    try {
      saved = await api("/api/internal/mcp-servers", { method: "POST", body: JSON.stringify(args) });
    } catch (error) {
      return { text: error instanceof Error ? error.message : String(error), isError: true };
    }
    const serverName = typeof saved.name === "string" && saved.name ? saved.name : "the helper";
    const transport = saved.transport === "command" || saved.transport === "http" || saved.transport === "sse" ? saved.transport : "";
    const target = typeof saved.target === "string" ? saved.target : "";
    const keyNames = (value: unknown) => Array.isArray(value) && value.every((key) => typeof key === "string") ? value.join(", ") : "";
    const envKeys = keyNames(saved.envKeys);
    const headerKeys = keyNames(saved.headerKeys);
    const where = transport && target ? ` (${transport} ${target})` : "";
    const named = [
      envKeys ? `Environment names on file: ${envKeys}.` : "",
      headerKeys ? `Header names on file: ${headerKeys}.` : "",
    ].filter(Boolean).join(" ");
    const local = transport === "command" ? " Turning it on runs that command on their computer." : "";
    return {
      text: `Saved “${serverName}”${where} switched off, and a card is now visible to the user to turn it on. It stays off until the user confirms that card; do not say it is connected.${local}${named ? ` ${named}` : ""} End this turn and wait for the decision.`,
    };
  }
  if (name === "propose_app_setting") {
    let response: Json;
    try {
      response = await api("/api/internal/app-setting-requests", {
        method: "POST",
        body: JSON.stringify({
          fromBotId: ids.botId,
          fromThreadId: ids.threadId,
          setting: args.setting,
          value: args.value,
          reason: args.reason,
          ...(typeof args.for_bot_id === "string" ? { forBotId: args.for_bot_id } : {}),
        }),
      });
    } catch (error) {
      return { text: error instanceof Error ? error.message : String(error), isError: true };
    }
    const setting = typeof response.setting === "string" ? response.setting : String(args.setting ?? "setting");
    const value = typeof response.value === "string" ? response.value : String(args.value ?? "");
    return confirmationResult(response, `the ${setting} change to ${value}`, "setting");
  }
  return undefined;
}
