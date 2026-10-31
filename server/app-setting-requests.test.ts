import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { AppSettingRequestError, AppSettingRequestService, type AppSettingRequestStore, type OptionCardLike } from "./app-setting-requests.ts";
import type { BotRecord } from "./store.ts";
import type { ApprovalMode } from "../shared/approval-mode.ts";
import type { ModelSelection } from "./contracts.ts";

interface StoredMessage {
  id: string;
  card?: OptionCardLike;
}

interface GuardTask {
  modelSelection?: ModelSelection;
  approvalMode?: ApprovalMode;
}

class MemoryStore implements AppSettingRequestStore {
  readonly bots = new Map<string, BotRecord>();
  readonly threads = new Map<string, StoredMessage[]>();
  readonly modes: Array<{ id: string; mode: string }> = [];
  readonly botTasks = new Map<string, GuardTask[]>();
  readonly busyBots = new Set<string>();
  private sequence = 0;

  bot(id: string): BotRecord | undefined {
    return this.bots.get(id);
  }

  messagesFor(threadId: string): StoredMessage[] {
    return this.threads.get(threadId) ?? [];
  }

  tasks(botId: string): GuardTask[] {
    return this.botTasks.get(botId) ?? [];
  }

  appendMessage(
    threadId: string,
    message: { role: "bot"; kind: "options"; card: OptionCardLike; from?: { botId: string; name: string; color: string } },
  ): StoredMessage {
    const stored: StoredMessage = { id: "message-" + ++this.sequence, card: message.card };
    const messages = this.threads.get(threadId) ?? [];
    messages.push(stored);
    this.threads.set(threadId, messages);
    return stored;
  }

  patchMessage(threadId: string, messageId: string, patch: { card: OptionCardLike }): StoredMessage | null {
    const message = this.messagesFor(threadId).find((candidate) => candidate.id === messageId);
    if (!message) return null;
    message.card = patch.card;
    return message;
  }

  applyApprovalMode(id: string, mode: Exclude<ApprovalMode, "custom">): BotRecord | null {
    const bot = this.bots.get(id);
    if (!bot) return null;
    this.modes.push({ id, mode });
    bot.approvalMode = mode;
    return bot;
  }
}

function addBot(store: MemoryStore, name: string, approvalMode: ApprovalMode = "ask"): BotRecord {
  const record = {
    id: randomUUID(), threadId: randomUUID(), name, title: "", description: "", soul: "",
    notifications: true, color: "blue", unread: false, resumeCursors: {},
    approvalMode,
    modelSelection: { instanceId: "claude", model: "sonnet" },
  } as unknown as BotRecord;
  store.bots.set(record.id, record);
  return record;
}

const serviceFor = (store: MemoryStore, options: Partial<ConstructorParameters<typeof AppSettingRequestService>[0]> = {}) =>
  new AppSettingRequestService({
    store,
    busy: (botId) => store.busyBots.has(botId),
    ...options,
  });

const errorOf = (run: () => unknown): AppSettingRequestError | null => {
  try {
    run();
    return null;
  } catch (error) {
    return error as AppSettingRequestError;
  }
};

/** The Chief may only reach its own section. */
const chiefRule = (allowed: Set<string>) => (from: string, to: string) =>
  from !== to && !allowed.has(to) ? "that bot is not in a team this Chief is allowed to manage" : null;

describe("AppSettingRequestService", () => {
  it("applies a language change at once, with Undo, and leaves the before value to the client", () => {
    const store = new MemoryStore();
    const bot = addBot(store, "Scout");
    const service = serviceFor(store);
    const proposal = service.submit({ botId: bot.id, threadId: bot.threadId, setting: "language", value: "pt-br", reason: "asked for Portuguese" });
    expect(proposal.state).toBe("applied");
    const card = store.messagesFor(bot.threadId)[0]!.card!;
    expect(card).toMatchObject({ tool: "update_app_setting", answered: "allow", autoApplied: true, dismissed: true });
    expect(card.options).toEqual([]);
    expect(card.appSettingRequest).toMatchObject({ setting: "language", value: "pt-br", requiresConfirmation: false });
    expect(card.appSettingRequest?.before).toBeUndefined();
    expect(card.appSettingRequest?.appliedAt).toBeTypeOf("number");
  });

  it("applies theme and interface mode at once", () => {
    const store = new MemoryStore();
    const bot = addBot(store, "Scout");
    const service = serviceFor(store);
    for (const [setting, value] of [["theme", "light"], ["interface_mode", "advanced"]] as const) {
      const proposal = service.submit({ botId: bot.id, threadId: bot.threadId, setting, value, reason: "asked" });
      expect(proposal.state).toBe("applied");
    }
    expect(store.messagesFor(bot.threadId).map((message) => message.card?.answered)).toEqual(["allow", "allow"]);
  });

  it("rejects a value outside the setting's own enum", () => {
    const store = new MemoryStore();
    const bot = addBot(store, "Scout");
    const service = serviceFor(store);
    expect(() => service.submit({ botId: bot.id, threadId: bot.threadId, setting: "theme", value: "purple", reason: "asked" }))
      .toThrow(AppSettingRequestError);
    expect(() => service.submit({ botId: bot.id, threadId: bot.threadId, setting: "language", value: "dark", reason: "asked" }))
      .toThrow(AppSettingRequestError);
    expect(() => service.submit({ botId: bot.id, threadId: bot.threadId, setting: "nonsense", value: "dark", reason: "asked" }))
      .toThrow(AppSettingRequestError);
    expect(() => service.submit({ botId: bot.id, threadId: bot.threadId, setting: "theme", value: "dark" } as never))
      .toThrow(/reason/);
    expect(store.messagesFor(bot.threadId)).toHaveLength(0);
  });

  it("makes every approval-mode change a pending card, lowering included", () => {
    for (const [before, value] of [["ask", "edits"], ["ask", "auto"], ["ask", "full"], ["auto", "ask"], ["full", "edits"]] as const) {
      const store = new MemoryStore();
      const bot = addBot(store, "Scout", before);
      const service = serviceFor(store);
      const proposal = service.submit({ botId: bot.id, threadId: bot.threadId, setting: "approval_mode", value, reason: "asked" });
      expect(proposal.state, `${before} → ${value}`).toBe("pending");
      const card = store.messagesFor(bot.threadId)[0]!.card!;
      expect(card).toMatchObject({ options: ["Confirm", "Cancel"], tool: "update_app_setting" });
      expect(card.answered).toBeUndefined();
      expect(card.autoApplied).toBeUndefined();
      expect(card.dismissed).toBeUndefined();
      expect(card.appSettingRequest).toMatchObject({ before, value, requiresConfirmation: true });
      expect(bot.approvalMode, `${before} → ${value}`).toBe(before);
      expect(store.modes).toHaveLength(0);
    }
  });

  it("applies a change only on confirmation and leaves it off when the person cancels", () => {
    const store = new MemoryStore();
    const bot = addBot(store, "Scout", "ask");
    const service = serviceFor(store);
    const confirmed = service.submit({ botId: bot.id, threadId: bot.threadId, setting: "approval_mode", value: "edits", reason: "asked" });
    expect(confirmed.state).toBe("pending");
    expect(bot.approvalMode).toBe("ask");
    expect(service.resolve({ botId: bot.id, threadId: bot.threadId, requestId: confirmed.requestId, behavior: "allow" }))
      .toMatchObject({ claimed: true, state: "applied" });
    expect(bot.approvalMode).toBe("edits");

    const cancelled = service.submit({ botId: bot.id, threadId: bot.threadId, setting: "approval_mode", value: "auto", reason: "asked" });
    expect(cancelled.state).toBe("pending");
    expect(service.resolve({ botId: bot.id, threadId: bot.threadId, requestId: cancelled.requestId, behavior: "deny" }))
      .toMatchObject({ claimed: true, state: "denied" });
    expect(bot.approvalMode).toBe("edits");
  });

  it("keeps the card pending with a friendly refusal while the bot is still working", () => {
    const store = new MemoryStore();
    const bot = addBot(store, "Scout", "ask");
    store.busyBots.add(bot.id);
    const service = serviceFor(store);
    const proposal = service.submit({ botId: bot.id, threadId: bot.threadId, setting: "approval_mode", value: "auto", reason: "asked" });
    expect(proposal.state).toBe("pending");

    const busy = service.resolve({ botId: bot.id, threadId: bot.threadId, requestId: proposal.requestId, behavior: "allow" });
    expect(busy).toMatchObject({ claimed: true, state: "invalid", status: 409 });
    expect(busy.state === "invalid" && busy.error).toMatch(/Espere Scout terminar o que está fazendo e confirme de novo/);
    expect(bot.approvalMode).toBe("ask");
    expect(store.messagesFor(bot.threadId)[0]!.card?.answered).toBeUndefined();
    expect(store.modes).toHaveLength(0);

    store.busyBots.delete(bot.id);
    expect(service.resolve({ botId: bot.id, threadId: bot.threadId, requestId: proposal.requestId, behavior: "allow" }))
      .toMatchObject({ claimed: true, state: "applied" });
    expect(bot.approvalMode).toBe("auto");
  });

  it("refuses at proposal and at confirmation while an approval grant is in flight", () => {
    const store = new MemoryStore();
    const bot = addBot(store, "Scout", "ask");
    const service = serviceFor(store);
    const proposal = service.submit({ botId: bot.id, threadId: bot.threadId, setting: "approval_mode", value: "auto", reason: "asked" });
    store.bots.get(bot.id)!.approvalGrant = { requestId: "grant-1", mode: "full", phase: "prepared" };
    const blocked = service.resolve({ botId: bot.id, threadId: bot.threadId, requestId: proposal.requestId, behavior: "allow" });
    expect(blocked).toMatchObject({ claimed: true, state: "invalid", status: 409 });
    expect(bot.approvalMode).toBe("ask");
    expect(store.messagesFor(bot.threadId)[0]!.card?.answered).toBeUndefined();

    const other = addBot(store, "Writer", "ask");
    store.bots.get(other.id)!.approvalGrant = { requestId: "grant-2", mode: "full", phase: "prepared" };
    const refused = errorOf(() => service.submit({
      botId: other.id, threadId: other.threadId, setting: "approval_mode", value: "auto", reason: "asked",
    }));
    expect(refused).toMatchObject({ status: 409 });
    expect(store.messagesFor(other.threadId)).toHaveLength(0);
  });

  it("refuses a level that is currently Custom", () => {
    const store = new MemoryStore();
    const bot = addBot(store, "Scout", "custom");
    const service = serviceFor(store);
    const refused = errorOf(() => service.submit({
      botId: bot.id, threadId: bot.threadId, setting: "approval_mode", value: "ask", reason: "asked",
    }));
    expect(refused).toMatchObject({ status: 403 });
    expect(refused?.message).toBe("Essa permissão só muda no app do computador");
    expect(bot.approvalMode).toBe("custom");
    expect(store.messagesFor(bot.threadId)).toHaveLength(0);
  });

  it("refuses Full access on a hosted workspace at proposal", () => {
    const store = new MemoryStore();
    const bot = addBot(store, "Scout", "ask");
    const service = serviceFor(store, { hosted: true, hostedFullAccessRefusal: "Full comes from the operator" });
    const refused = errorOf(() => service.submit({
      botId: bot.id, threadId: bot.threadId, setting: "approval_mode", value: "full", reason: "asked",
    }));
    expect(refused).toMatchObject({ status: 403, message: "Full comes from the operator" });
    expect(bot.approvalMode).toBe("ask");
    expect(store.messagesFor(bot.threadId)).toHaveLength(0);
  });

  it("carries the local-computer Auto warning and treats confirmation as acknowledging it", () => {
    const store = new MemoryStore();
    const bot = addBot(store, "Scout", "ask");
    (bot as { computer?: string }).computer = "local";
    const service = serviceFor(store);
    const proposal = service.submit({ botId: bot.id, threadId: bot.threadId, setting: "approval_mode", value: "auto", reason: "asked" });
    expect(proposal.state).toBe("pending");
    expect(store.messagesFor(bot.threadId)[0]!.card?.appSettingRequest).toMatchObject({
      before: "ask", value: "auto", requiresConfirmation: true, localAutoWarning: true,
    });
    expect(bot.approvalMode).toBe("ask");
    expect(service.resolve({ botId: bot.id, threadId: bot.threadId, requestId: proposal.requestId, behavior: "allow" }))
      .toMatchObject({ claimed: true, state: "applied" });
    expect(bot.approvalMode).toBe("auto");
  });

  it("stops a confirmed change when the level moved again after the card", () => {
    const store = new MemoryStore();
    const bot = addBot(store, "Scout", "ask");
    const service = serviceFor(store);
    const proposal = service.submit({ botId: bot.id, threadId: bot.threadId, setting: "approval_mode", value: "auto", reason: "asked" });
    bot.approvalMode = "edits";
    const result = service.resolve({ botId: bot.id, threadId: bot.threadId, requestId: proposal.requestId, behavior: "allow" });
    expect(result).toMatchObject({ claimed: true, state: "invalid", status: 409 });
    expect(bot.approvalMode).toBe("edits");
    expect(store.modes).toHaveLength(0);
  });

  it("refuses a permission card that never asked the person to confirm", () => {
    const store = new MemoryStore();
    const bot = addBot(store, "Scout", "ask");
    const service = serviceFor(store);
    const proposal = service.submit({ botId: bot.id, threadId: bot.threadId, setting: "approval_mode", value: "auto", reason: "asked" });
    const card = store.messagesFor(bot.threadId)[0]!.card!;
    store.patchMessage(bot.threadId, "message-1", {
      card: { ...card, appSettingRequest: { ...card.appSettingRequest!, requiresConfirmation: false } },
    });
    const result = service.resolve({ botId: bot.id, threadId: bot.threadId, requestId: proposal.requestId, behavior: "allow" });
    expect(result).toMatchObject({ claimed: true, state: "invalid", status: 409, error: expect.stringContaining("always needs the person's confirmation") });
    expect(bot.approvalMode).toBe("ask");
    expect(store.modes).toHaveLength(0);
  });

  it("keeps Full access waiting for the card and applies it only on confirmation", () => {
    const store = new MemoryStore();
    const bot = addBot(store, "Scout", "ask");
    const service = serviceFor(store);
    const proposal = service.submit({ botId: bot.id, threadId: bot.threadId, setting: "approval_mode", value: "full", reason: "asked" });
    expect(proposal.state).toBe("pending");
    const card = store.messagesFor(bot.threadId)[0]!.card!;
    expect(card).toMatchObject({ options: ["Confirm", "Cancel"], tool: "update_app_setting" });
    expect(card.appSettingRequest?.requiresConfirmation).toBe(true);
    expect(card.answered).toBeUndefined();
    expect(card.autoApplied).toBeUndefined();
    expect(bot.approvalMode).toBe("ask");
    const result = service.resolve({ botId: bot.id, threadId: bot.threadId, requestId: proposal.requestId, behavior: "allow" });
    expect(result).toMatchObject({ claimed: true, state: "applied", targetBotId: bot.id });
    expect(bot.approvalMode).toBe("full");
  });

  it("leaves Full access off when the card is dismissed", () => {
    const store = new MemoryStore();
    const bot = addBot(store, "Scout", "ask");
    const service = serviceFor(store);
    const proposal = service.submit({ botId: bot.id, threadId: bot.threadId, setting: "approval_mode", value: "full", reason: "asked" });
    const result = service.resolve({ botId: bot.id, threadId: bot.threadId, requestId: proposal.requestId, behavior: "deny" });
    expect(result).toMatchObject({ claimed: true, state: "denied" });
    expect(bot.approvalMode).toBe("ask");
    expect(store.messagesFor(bot.threadId)[0]!.card).toMatchObject({ answered: "deny" });
  });

  it("does not open the Full access card when the conversation cannot hold cards", () => {
    const store = new MemoryStore();
    const bot = addBot(store, "Scout", "ask");
    const service = serviceFor(store, {
      canPersist: () => ({ ok: false, status: 409, error: "This conversation cannot hold another card right now." }),
    });
    expect(() => service.submit({ botId: bot.id, threadId: bot.threadId, setting: "approval_mode", value: "full", reason: "asked" }))
      .toThrow(/another card/);
    expect(bot.approvalMode).toBe("ask");
  });

  it("keeps the rest of the app's settings to the bot itself, even for a Chief", () => {
    const store = new MemoryStore();
    const chief = addBot(store, "Chief");
    chief.chiefOfStaff = true;
    const other = addBot(store, "Writer");
    const service = serviceFor(store, { validateTarget: chiefRule(new Set([other.id])) });
    expect(() => service.submit({
      botId: chief.id, threadId: chief.threadId, targetBotId: other.id, setting: "language", value: "en", reason: "asked",
    })).toThrow(/whole app/);
  });

  it("lets only an allowed Chief change another bot's level, and re-checks at confirm time", () => {
    const store = new MemoryStore();
    const chief = addBot(store, "Chief");
    chief.chiefOfStaff = true;
    const other = addBot(store, "Writer", "auto");
    const allowed = new Set([other.id]);
    const service = serviceFor(store, { validateTarget: chiefRule(allowed) });
    const proposal = service.submit({
      botId: chief.id, threadId: chief.threadId, targetBotId: other.id, setting: "approval_mode", value: "ask", reason: "asked",
    });
    expect(proposal.state).toBe("pending");
    expect(store.messagesFor(chief.threadId)[0]!.card?.appSettingRequest).toMatchObject({ targetBotId: other.id, targetName: "Writer", before: "auto" });
    expect(other.approvalMode).toBe("auto");
    expect(service.resolve({ botId: chief.id, threadId: chief.threadId, requestId: proposal.requestId, behavior: "allow" }))
      .toMatchObject({ claimed: true, state: "applied" });
    expect(other.approvalMode).toBe("ask");

    const second = service.submit({
      botId: chief.id, threadId: chief.threadId, targetBotId: other.id, setting: "approval_mode", value: "full", reason: "asked",
    });
    expect(second.state).toBe("pending");
    allowed.clear();
    const result = service.resolve({ botId: chief.id, threadId: chief.threadId, requestId: second.requestId, behavior: "allow" });
    expect(result).toMatchObject({ claimed: true, state: "invalid", status: 404 });
    expect(other.approvalMode).toBe("ask");
  });

  it("refuses a level the target's engine does not offer, at proposal and at confirmation", () => {
    const store = new MemoryStore();
    const bot = addBot(store, "Scout", "ask");
    let offersEdits = false;
    const service = serviceFor(store, { supports: (_selection, mode) => mode !== "edits" || offersEdits });
    const refused = errorOf(() => service.submit({
      botId: bot.id, threadId: bot.threadId, setting: "approval_mode", value: "edits", reason: "asked",
    }));
    expect(refused).toMatchObject({ status: 400 });
    expect(refused?.message).toMatch(/does not offer/);

    offersEdits = true;
    const proposal = service.submit({ botId: bot.id, threadId: bot.threadId, setting: "approval_mode", value: "edits", reason: "asked" });
    expect(proposal.state).toBe("pending");
    offersEdits = false;
    expect(service.resolve({ botId: bot.id, threadId: bot.threadId, requestId: proposal.requestId, behavior: "allow" }))
      .toMatchObject({ claimed: true, state: "invalid", status: 400 });
    expect(bot.approvalMode).toBe("ask");
  });

  it("refuses a whole-bot change while one of its conversations is on Custom", () => {
    const store = new MemoryStore();
    const bot = addBot(store, "Scout", "ask");
    store.botTasks.set(bot.id, [{ modelSelection: { instanceId: "codex", model: "gpt" }, approvalMode: "custom" }]);
    const service = serviceFor(store);
    const refused = errorOf(() => service.submit({
      botId: bot.id, threadId: bot.threadId, setting: "approval_mode", value: "auto", reason: "asked",
    }));
    expect(refused).toMatchObject({ status: 403, message: "Essa permissão só muda no app do computador" });
    expect(store.messagesFor(bot.threadId)).toHaveLength(0);
  });

  it("says nothing would change when the level is already the requested one", () => {
    const store = new MemoryStore();
    const bot = addBot(store, "Scout", "auto");
    const service = serviceFor(store);
    expect(() => service.submit({ botId: bot.id, threadId: bot.threadId, setting: "approval_mode", value: "auto", reason: "asked" }))
      .toThrow("Nothing would change");
  });

  it("is idempotent after the card settled and never applies twice", () => {
    const store = new MemoryStore();
    const bot = addBot(store, "Scout", "ask");
    const service = serviceFor(store);
    const proposal = service.submit({ botId: bot.id, threadId: bot.threadId, setting: "approval_mode", value: "edits", reason: "asked" });
    expect(proposal.state).toBe("pending");
    expect(service.resolve({ botId: bot.id, threadId: bot.threadId, requestId: proposal.requestId, behavior: "allow" }))
      .toMatchObject({ claimed: true, state: "applied" });
    const again = service.resolve({ botId: bot.id, threadId: bot.threadId, requestId: proposal.requestId, behavior: "allow" });
    expect(again).toMatchObject({ claimed: true, state: "already_settled", behavior: "allow" });
    expect(store.modes).toHaveLength(1);
  });

  it("rejects a card that belongs to another conversation", () => {
    const store = new MemoryStore();
    const bot = addBot(store, "Scout");
    const other = addBot(store, "Writer");
    const service = serviceFor(store);
    const proposal = service.submit({ botId: bot.id, threadId: bot.threadId, setting: "theme", value: "light", reason: "asked" });
    expect(service.resolve({ botId: other.id, threadId: bot.threadId, requestId: proposal.requestId, behavior: "deny" }))
      .toMatchObject({ claimed: true, state: "invalid", status: 403 });
    expect(store.messagesFor(bot.threadId)[0]!.card?.answered).toBe("allow");
  });

  it("only accepts allow or deny", () => {
    const store = new MemoryStore();
    const bot = addBot(store, "Scout");
    const service = serviceFor(store);
    const proposal = service.submit({ botId: bot.id, threadId: bot.threadId, setting: "theme", value: "dark", reason: "asked" });
    expect(service.resolve({ botId: bot.id, threadId: bot.threadId, requestId: proposal.requestId, behavior: "answer" }))
      .toMatchObject({ claimed: true, state: "invalid", status: 400 });
  });
});
