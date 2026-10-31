import { afterEach, describe, expect, it, vi } from "vitest";

import { APPROVAL_TTL_MS, EXPIRED_DECLINE_REASON } from "../shared/approvals.ts";
import { createApprovalExpiry } from "./approval-expiry.ts";
import { createApprovalsIndex } from "./approvals-index.ts";
import type { Message, StoreChange } from "./store.ts";

const T0 = 1_700_000_000_000;
const HOUR = 3_600_000;
const BOT = { id: "atlas", name: "Atlas", threadId: "t-atlas" };

function fakeStore() {
  const messages = new Map<string, Message[]>();
  const listeners = new Set<(change: StoreChange) => void>();
  const emit = (change: StoreChange) => { for (const listener of listeners) listener(change); };
  return {
    onChange(listener: (change: StoreChange) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    messagesFor: (threadId: string) => messages.get(threadId) ?? [],
    bot: () => BOT,
    botByThread: () => BOT,
    groupByThread: () => undefined,
    add(threadId: string, message: Message) {
      messages.set(threadId, [...(messages.get(threadId) ?? []), message]);
      emit({ type: "message", threadId, message });
    },
    patchMessage(threadId: string, messageId: string, patch: Partial<Message>) {
      const list = messages.get(threadId) ?? [];
      const at = list.findIndex((message) => message.id === messageId);
      if (at < 0) return undefined;
      const next = { ...list[at]!, ...patch } as Message;
      list[at] = next;
      emit({ type: "message.patch", threadId, message: next });
      return next;
    },
    read: (threadId: string, id: string) => (messages.get(threadId) ?? []).find((message) => message.id === id),
  };
}

const card = (id: string, extra: Partial<NonNullable<Message["card"]>> = {}, at = T0): Message => ({
  id, role: "bot", kind: "options", at,
  card: { title: "Permission", subtitle: "echo hi", options: ["Allow", "Deny"], requestId: `req-${id}`, tool: "bash", ...extra },
});

function setup(options: { ttl?: number; decline?: (reason: string) => Promise<boolean>; now?: { value: number }; store?: ReturnType<typeof fakeStore> } = {}) {
  const store = options.store ?? fakeStore();
  const ttl = options.ttl ?? APPROVAL_TTL_MS;
  const clock = options.now ?? { value: T0 };
  const index = createApprovalsIndex({ store, ttlMs: () => ttl, nameOf: () => undefined });
  const decline = vi.fn(async (_card: unknown, reason: string) => (options.decline ? options.decline(reason) : true));
  const expiry = createApprovalExpiry({ index, store, ttlMs: () => ttl, now: () => clock.value, decline, everyMs: 3_600_000 });
  return { store, index, expiry, decline, clock };
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("a pending permission runs out", () => {
  const running: Array<{ stop(): void }> = [];
  afterEach(() => { for (const one of running.splice(0)) one.stop(); });

  it("is stamped with its deadline on the card, so a restart still knows it", async () => {
    const { store, index, expiry } = setup();
    running.push(expiry, index);
    index.start([]);
    expiry.start();
    store.add("t-atlas", card("a"));
    store.add("t-atlas", card("lesson", { lessonRequest: { lesson: "Pergunte antes" }, tool: "propose_lesson" }));
    await flush();
    expect(store.read("t-atlas", "a")?.card?.approval?.expiresAt).toBe(T0 + APPROVAL_TTL_MS);
    expect(store.read("t-atlas", "lesson")?.card?.approval?.expiresAt).toBeUndefined();
  });

  it("keeps the deadline it was stamped with when the workspace changes the wait later", async () => {
    const store = fakeStore();
    store.add("t-atlas", card("a", { approval: { expiresAt: T0 + 2 * HOUR } }));
    const { index, expiry } = setup({ store, ttl: 48 * HOUR });
    running.push(expiry, index);
    index.start([{ threadId: "t-atlas", messageId: "a" }]);
    expiry.start();
    await flush();
    expect(store.read("t-atlas", "a")?.card?.approval?.expiresAt).toBe(T0 + 2 * HOUR);
  });

  it("is declined for the person with the plain reason 'expirou' once the time is up", async () => {
    const { store, index, expiry, decline, clock } = setup();
    index.start([]);
    store.add("t-atlas", card("a"));
    clock.value = T0 + APPROVAL_TTL_MS - 1;
    expect(await expiry.sweep()).toBe(0);
    expect(decline).not.toHaveBeenCalled();

    clock.value = T0 + APPROVAL_TTL_MS;
    expect(await expiry.sweep()).toBe(1);
    expect(decline).toHaveBeenCalledTimes(1);
    expect(decline.mock.calls[0]?.[1]).toBe(EXPIRED_DECLINE_REASON);
    expect(EXPIRED_DECLINE_REASON).toBe("expirou");
    const settled = store.read("t-atlas", "a")?.card;
    expect(settled).toMatchObject({ expired: true, approval: { lapsed: true, expiresAt: T0 + APPROVAL_TTL_MS } });
    expect(index.size).toBe(0);
    expect(await expiry.sweep()).toBe(0);
    expect(decline).toHaveBeenCalledTimes(1);
  });

  it("is settled even when the request behind it is gone and nobody could take the decline", async () => {
    const { store, index, expiry, decline, clock } = setup({ decline: async () => { throw new Error("no listener"); } });
    index.start([]);
    store.add("t-atlas", card("a"));
    clock.value = T0 + APPROVAL_TTL_MS + 1;
    expect(await expiry.sweep()).toBe(1);
    expect(decline).toHaveBeenCalledTimes(1);
    expect(store.read("t-atlas", "a")?.card?.expired).toBe(true);
  });

  it("is declined once, not twice, when two sweeps meet", async () => {
    let release: (value: boolean) => void = () => {};
    const { store, index, expiry, decline, clock } = setup({ decline: () => new Promise<boolean>((resolve) => { release = resolve; }) });
    index.start([]);
    store.add("t-atlas", card("a"));
    clock.value = T0 + APPROVAL_TTL_MS;
    const first = expiry.sweep();
    const second = expiry.sweep();
    await flush();
    release(true);
    expect((await first) + (await second)).toBe(1);
    expect(decline).toHaveBeenCalledTimes(1);
  });

  it("does not touch a proposal, a question, a card already answered, or one a person is still deciding", async () => {
    const { store, index, expiry, decline, clock } = setup();
    index.start([]);
    store.add("t-atlas", card("lesson", { lessonRequest: { lesson: "x" }, tool: "propose_lesson" }));
    store.add("t-atlas", card("skill", { skillRequest: { name: "x", gist: "y" } as never }));
    store.add("t-atlas", card("done", { answered: "allow" }));
    store.add("t-atlas", card("fresh", {}, T0 + 10 * HOUR));
    clock.value = T0 + APPROVAL_TTL_MS + 5 * HOUR;
    expect(await expiry.sweep()).toBe(0);
    expect(decline).not.toHaveBeenCalled();
    expect(store.read("t-atlas", "lesson")?.card?.expired).toBeUndefined();
  });

  it("is settled quietly after a restart, with no answer to deliver, and the deadline on the card still decides", async () => {
    const store = fakeStore();
    const first = setup({ store });
    running.push(first.expiry, first.index);
    first.index.start([]);
    first.expiry.start();
    store.add("t-atlas", card("late"));
    store.add("t-atlas", card("ok", {}, T0 + 20 * HOUR));
    await flush();
    first.expiry.stop();
    first.index.stop();

    const clock = { value: T0 + 30 * HOUR };
    const second = setup({ store, now: clock });
    running.push(second.expiry, second.index);
    second.index.start([{ threadId: "t-atlas", messageId: "late" }, { threadId: "t-atlas", messageId: "ok" }]);
    second.expiry.start();
    await flush();
    await flush();
    expect(second.decline).not.toHaveBeenCalled();
    expect(store.read("t-atlas", "late")?.card).toMatchObject({ expired: true, approval: { lapsed: true } });
    expect(store.read("t-atlas", "ok")?.card?.expired).toBeUndefined();
    expect(second.index.items({ who: { admin: true }, visible: { bot: () => true, thread: () => true, group: () => true } }).map((item) => item.messageId)).toEqual(["ok"]);

    clock.value = T0 + 20 * HOUR + APPROVAL_TTL_MS;
    expect(await second.expiry.sweep()).toBe(1);
    expect(second.decline).toHaveBeenCalledTimes(1);
  });
});
