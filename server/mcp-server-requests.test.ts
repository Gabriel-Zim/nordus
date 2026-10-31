import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { McpServerRequestService, type McpServerRequestStore } from "./mcp-server-requests.ts";
import type { OptionCardLike } from "./app-setting-requests.ts";

interface StoredMessage {
  id: string;
  card?: OptionCardLike;
}

class MemoryStore implements McpServerRequestStore {
  readonly threads = new Map<string, StoredMessage[]>();
  private sequence = 0;

  messagesFor(threadId: string): StoredMessage[] {
    return this.threads.get(threadId) ?? [];
  }

  appendMessage(threadId: string, message: { role: "bot"; kind: "options"; card: OptionCardLike }): StoredMessage {
    const stored: StoredMessage = { id: "message-" + ++this.sequence, card: message.card };
    this.threads.set(threadId, [...this.messagesFor(threadId), stored]);
    return stored;
  }

  patchMessage(threadId: string, messageId: string, patch: { card: OptionCardLike }): StoredMessage | null {
    const message = this.messagesFor(threadId).find((candidate) => candidate.id === messageId);
    if (!message) return null;
    message.card = patch.card;
    return message;
  }
}

const ids = () => ({ botId: randomUUID(), threadId: randomUUID() });

describe("McpServerRequestService", () => {
  it("saves the helper off and only turns it on when the card is confirmed", () => {
    const store = new MemoryStore();
    const { botId, threadId } = ids();
    const enable = vi.fn(() => ({ ok: true as const }));
    const service = new McpServerRequestService(store, { canEnable: enable });
    const proposal = service.propose({ botId, threadId, serverName: "notes" });
    const card = store.messagesFor(threadId)[0]!.card!;
    expect(card).toMatchObject({ tool: "add_mcp_server", options: ["Turn on", "Not now"] });
    expect(card.mcpServerRequest).toMatchObject({ serverName: "notes", botId, threadId });
    expect(card.answered).toBeUndefined();
    expect(enable).not.toHaveBeenCalled();
    const result = service.resolve({ botId, threadId, requestId: proposal.requestId, behavior: "allow" });
    expect(result).toMatchObject({ claimed: true, state: "enabled", serverName: "notes" });
    expect(enable).toHaveBeenCalledWith("notes");
    expect(store.messagesFor(threadId)[0]!.card).toMatchObject({ answered: "allow" });
  });

  it("stays off when the person dismisses the card", () => {
    const store = new MemoryStore();
    const { botId, threadId } = ids();
    const enable = vi.fn(() => ({ ok: true as const }));
    const service = new McpServerRequestService(store, { canEnable: enable });
    const proposal = service.propose({ botId, threadId, serverName: "notes" });
    expect(service.resolve({ botId, threadId, requestId: proposal.requestId, behavior: "deny" }))
      .toMatchObject({ claimed: true, state: "denied" });
    expect(enable).not.toHaveBeenCalled();
    expect(store.messagesFor(threadId)[0]!.card).toMatchObject({ answered: "deny" });
  });

  it("reports a refusal and keeps the card open, without claiming it is on", () => {
    const store = new MemoryStore();
    const { botId, threadId } = ids();
    const service = new McpServerRequestService(store, {
      canEnable: () => ({ ok: false, error: "That helper is blocked by the workspace policy.", status: 403 }),
    });
    const proposal = service.propose({ botId, threadId, serverName: "notes" });
    const result = service.resolve({ botId, threadId, requestId: proposal.requestId, behavior: "allow" });
    expect(result).toMatchObject({ claimed: true, state: "invalid", status: 403 });
    const card = store.messagesFor(threadId)[0]!.card!;
    expect(card.answered).toBeUndefined();
    expect(card.held).toContain("blocked");
  });

  it("refuses a card from another conversation", () => {
    const store = new MemoryStore();
    const { botId, threadId } = ids();
    const service = new McpServerRequestService(store);
    const proposal = service.propose({ botId, threadId, serverName: "notes" });
    expect(service.resolve({ botId: randomUUID(), threadId, requestId: proposal.requestId, behavior: "allow" }))
      .toMatchObject({ claimed: true, state: "invalid", status: 403 });
  });
});
