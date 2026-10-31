// The add_mcp_server card: the helper is already saved switched off, so the
// only job here is to turn it on after the person confirms in the conversation.
import type { McpServerRequestCardData } from "../shared/mcp-server-request.ts";
import { newId } from "./contracts.ts";
import { redactSecretsInText } from "./redact.ts";
import type { OptionCardLike } from "./app-setting-requests.ts";

export interface McpServerRequestStore {
  messagesFor(threadId: string): Array<{ id: string; card?: OptionCardLike }>;
  appendMessage(threadId: string, message: { role: "bot"; kind: "options"; card: OptionCardLike }): { id: string };
  patchMessage(threadId: string, messageId: string, patch: { card: OptionCardLike }): { id: string } | null;
}

export type ResolveMcpServerRequestResult =
  | { claimed: false; state: "not_found" }
  | { claimed: true; state: "invalid"; error: string; status: number }
  | { claimed: true; state: "already_settled"; behavior: string }
  | { claimed: true; state: "denied" }
  | { claimed: true; state: "enabled"; serverName: string };

export class McpServerRequestService {
  private readonly store: McpServerRequestStore;
  private readonly options: {
    canEnable?: (name: string) => { ok: true } | { ok: false; error: string; status: number };
    now?: () => number;
  };

  constructor(store: McpServerRequestStore, options: {
    canEnable?: (name: string) => { ok: true } | { ok: false; error: string; status: number };
    now?: () => number;
  } = {}) {
    this.store = store;
    this.options = options;
  }

  propose(args: { botId: string; threadId: string; serverName: string; reason?: string }): {
    requestId: string;
    messageId: string;
    title: string;
    summary: string;
  } {
    const requestId = newId();
    const serverName = redactSecretsInText(args.serverName);
    const payload: McpServerRequestCardData = {
      version: 1,
      requestId,
      botId: args.botId,
      threadId: args.threadId,
      serverName,
      createdAt: (this.options.now ?? Date.now)(),
      reason: redactSecretsInText(args.reason?.trim().slice(0, 500) ?? ""),
    };
    const title = `Turn on ${serverName}?`;
    const summary = `The bot saved ${serverName} switched off. It only starts after you turn it on.`;
    const message = this.store.appendMessage(args.threadId, {
      role: "bot",
      kind: "options",
      card: {
        title,
        subtitle: summary,
        options: ["Turn on", "Not now"],
        requestId,
        tool: "add_mcp_server",
        mcpServerRequest: payload,
      },
    });
    return { requestId, messageId: message.id, title, summary };
  }

  resolve(args: { botId: string; threadId: string; requestId: string; behavior: string | undefined }): ResolveMcpServerRequestResult {
    const message = this.store.messagesFor(args.threadId)
      .find((candidate) => candidate.card?.requestId === args.requestId && candidate.card.mcpServerRequest);
    const card = message?.card;
    const payload = card?.mcpServerRequest;
    if (!message || !card || !payload) return { claimed: false, state: "not_found" };
    if (args.behavior !== "allow" && args.behavior !== "deny") {
      return { claimed: true, state: "invalid", error: "This helper card must be turned on or dismissed", status: 400 };
    }
    if (payload.botId !== args.botId || payload.threadId !== args.threadId) {
      return { claimed: true, state: "invalid", error: "This helper belongs to another conversation", status: 403 };
    }
    if (card.answered) return { claimed: true, state: "already_settled", behavior: card.answered };
    if (args.behavior === "deny") {
      this.store.patchMessage(args.threadId, message.id, { card: { ...card, answered: "deny", held: undefined } });
      return { claimed: true, state: "denied" };
    }
    const enabled = this.options.canEnable?.(payload.serverName) ?? { ok: true as const };
    if (!enabled.ok) {
      this.store.patchMessage(args.threadId, message.id, { card: { ...card, held: enabled.error.slice(0, 500) } });
      return { claimed: true, state: "invalid", error: enabled.error, status: enabled.status };
    }
    const settled = this.store.patchMessage(args.threadId, message.id, { card: { ...card, answered: "allow", held: undefined } });
    if (!settled) return { claimed: true, state: "invalid", error: "This helper card is no longer available", status: 409 };
    return { claimed: true, state: "enabled", serverName: payload.serverName };
  }
}
