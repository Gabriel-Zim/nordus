import { rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DATA_DIR } from "./config.ts";
import type { ModelSelection } from "./contracts.ts";
import { Store, toWireTask } from "./store.ts";

const selection = (): ModelSelection => ({ instanceId: "claude", model: "default" });

describe("the stamps that order the bot list", () => {
  beforeEach(() => {
    rmSync(DATA_DIR, { recursive: true, force: true });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_000_000);
  });
  afterEach(() => vi.useRealTimers());

  it("hold still while the bot works and mark when a request starts waiting on the person", () => {
    const store = new Store(selection);
    const bot = store.createBot({}, { seedMessages: false });
    const wire = () => toWireTask(store.taskByThread(bot.id, bot.threadId)!, selection());

    store.appendMessage(bot.threadId, { role: "user", kind: "text", text: "Faz a capa" });
    expect(wire()).toMatchObject({ lastThreadOrderAt: 1_000_000 });
    expect(wire().attentionAt).toBeUndefined();

    vi.setSystemTime(2_000_000);
    store.setTaskActivity(bot.id, bot.threadId, "working");
    store.appendMessage(bot.threadId, { role: "bot", kind: "activity", text: "Escrevendo o briefing", turnId: "t1" });
    store.appendMessage(bot.threadId, { role: "bot", kind: "text", text: "Rascunho", turnId: "t1" });
    expect(wire()).toMatchObject({ lastThreadOrderAt: 1_000_000 });
    expect(wire().attentionAt).toBeUndefined();

    vi.setSystemTime(3_000_000);
    store.setTaskActivity(bot.id, bot.threadId, "waiting-on-you");
    expect(wire()).toMatchObject({ lastThreadOrderAt: 1_000_000, attentionAt: 3_000_000 });

    vi.setSystemTime(4_000_000);
    store.setTaskActivity(bot.id, bot.threadId, "waiting-on-you");
    store.setTaskActivity(bot.id, bot.threadId, "working");
    expect(wire()).toMatchObject({ attentionAt: 3_000_000 });

    vi.setSystemTime(5_000_000);
    store.setTaskAwaitingPerson(bot.id, bot.threadId, true);
    expect(wire()).toMatchObject({ lastThreadOrderAt: 1_000_000, attentionAt: 5_000_000 });
    expect(toWireTask(new Store(selection).taskByThread(bot.id, bot.threadId)!, selection())).toMatchObject({ attentionAt: 5_000_000 });
  });

  it("marks when a conversation the person reads turns unread, not a colleague's request", () => {
    const store = new Store(selection);
    const bot = store.createBot({}, { seedMessages: false });
    const request = store.createTask(bot.id, "Pedido do GerenteDeOperacao", false, undefined, { botId: "gerentedeoperacao", name: "GerenteDeOperacao", kind: "work", at: 1 })!;
    const attentionAt = (threadId: string) => toWireTask(store.taskByThread(bot.id, threadId)!, selection()).attentionAt;

    vi.setSystemTime(2_000_000);
    store.patchTask(bot.id, bot.threadId, { unread: true });
    store.patchTask(bot.id, request.threadId, { unread: true });
    expect(attentionAt(bot.threadId)).toBe(2_000_000);
    expect(attentionAt(request.threadId)).toBeUndefined();

    vi.setSystemTime(3_000_000);
    store.patchTask(bot.id, bot.threadId, { unread: true });
    expect(attentionAt(bot.threadId)).toBe(2_000_000);
    store.patchTask(bot.id, bot.threadId, { unread: false });
    store.patchTask(bot.id, bot.threadId, { unread: true });
    expect(attentionAt(bot.threadId)).toBe(3_000_000);
  });
});
