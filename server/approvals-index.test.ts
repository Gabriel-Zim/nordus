import { describe, expect, it, vi } from "vitest";

import { approvalId } from "../shared/approvals.ts";
import { createApprovalsIndex, type ApprovalsStore, type ApprovalsViewer } from "./approvals-index.ts";
import type { Message, StoreChange } from "./store.ts";

const NOW = 1_700_000_000_000;
const HOUR = 3_600_000;

interface Bot { id: string; name: string; color?: string; owner?: string; threadId: string }

function fakeStore(bots: Bot[], groups: Array<{ id: string; threadId: string }> = []) {
  const threads = new Map<string, Message[]>();
  const listeners = new Set<(change: StoreChange) => void>();
  const store: ApprovalsStore = {
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    messagesFor: (threadId) => threads.get(threadId) ?? [],
    bot: (id) => bots.find((bot) => bot.id === id),
    botByThread: (threadId) => bots.find((bot) => bot.threadId === threadId),
    groupByThread: (threadId) => groups.find((group) => group.threadId === threadId),
  };
  return {
    store,
    put(threadId: string, message: Message, type: "message" | "message.patch" = "message") {
      const list = threads.get(threadId) ?? [];
      const at = list.findIndex((candidate) => candidate.id === message.id);
      if (at >= 0) list[at] = message;
      else list.push(message);
      threads.set(threadId, list);
      for (const listener of listeners) listener({ type, threadId, message });
    },
    drop(threadId: string) {
      threads.delete(threadId);
      for (const listener of listeners) listener({ type: "thread.deleted", threadId });
    },
    listeners: () => listeners.size,
  };
}

const permission = (id: string, extra: Partial<NonNullable<Message["card"]>> = {}, at = NOW): Message => ({
  id,
  role: "bot",
  kind: "options",
  at,
  card: { title: "Permission", subtitle: "echo hi", options: ["Allow", "Deny"], requestId: `req-${id}`, tool: "bash", intent: "Rodar um comando", ...extra },
});

const ATLAS: Bot = { id: "atlas", name: "Atlas", threadId: "t-atlas", owner: "rafael@example.test" };
const PEPPER: Bot = { id: "pepper", name: "Pepper", threadId: "t-pepper" };
const everything = { bot: () => true, thread: () => true, group: () => true };

const admin: ApprovalsViewer = { who: { admin: true }, visible: everything };
const member = (email: string, visible: Partial<ApprovalsViewer["visible"]> = {}, refusal?: ApprovalsViewer["refusal"]): ApprovalsViewer =>
  ({ who: { admin: false, email }, visible: { ...everything, ...visible }, ...(refusal ? { refusal } : {}) });

function build(bots: Bot[] = [ATLAS, PEPPER], groups: Array<{ id: string; threadId: string }> = []) {
  const fake = fakeStore(bots, groups);
  const index = createApprovalsIndex({ store: fake.store, ttlMs: () => 24 * HOUR, nameOf: (email) => (email === "rafael@example.test" ? "Rafael" : undefined) });
  index.start([]);
  return { ...fake, index };
}

describe("what the index keeps", () => {
  it("lists a card that asks, with the fields a person decides on, and holds a rollback of production as critical", () => {
    const { put, index } = build();
    put("t-atlas", permission("m1", { tool: "mcp__render__rollback", intent: "Voltar produção para a v2.14.3", subtitle: "service=api" }));
    const [item] = index.items(admin);
    expect(item).toMatchObject({
      id: approvalId("t-atlas", "m1"),
      kind: "permission",
      botId: "atlas",
      botName: "Atlas",
      threadId: "t-atlas",
      messageId: "m1",
      requestId: "req-m1",
      title: "Atlas quer voltar produção para a v2.14.3",
      risk: "critical",
      requestedAt: NOW,
      expiresAt: NOW + 24 * HOUR,
      decider: "Rafael",
      action: "decide",
    });
    expect(item!.fields.map((field) => field.label)).toEqual(["Ação", "Serviço", "Detalhe", "Quem decide"]);
    expect(item!.fields.at(-1)?.value).toBe("Rafael");
  });

  it("names the administrators as the decider of an agent nobody owns", () => {
    const { put, index } = build();
    put("t-pepper", permission("m1"));
    expect(index.items(admin)[0]).toMatchObject({ decider: "Administradores" });
  });

  it("keeps every kind of thing that waits, and lets only plain yes-or-no cards be decided from the list", () => {
    const { put, index } = build();
    put("t-atlas", permission("perm"));
    put("t-atlas", permission("peer", { tool: "ask_bot", title: "Atlas quer perguntar ao Pepper" }));
    put("t-atlas", permission("lesson", { lessonRequest: { lesson: "Pergunte antes de apagar" }, tool: "propose_lesson" }));
    put("t-atlas", permission("skill", { skillRequest: { name: "Resumo", gist: "Resume e-mails" } as never }));
    put("t-atlas", { id: "sign", role: "bot", kind: "signin", at: NOW, signIn: { site: "Notion", url: "https://notion.so" } as never });
    put("t-atlas", { id: "key", role: "bot", kind: "secret", at: NOW, secret: { label: "Chave", description: "Para enviar", envName: "KEY" } as never });
    put("t-atlas", { id: "app", role: "bot", kind: "connector", at: NOW, connector: { label: "Gmail", description: "Ler e-mails", status: "needed" } as never });
    put("t-atlas", { id: "chat", role: "bot", kind: "text", at: NOW, text: "oi" });
    const byKind = Object.fromEntries(index.items(admin).map((item) => [item.kind, item.action]));
    expect(byKind).toEqual({
      permission: "decide", peer: "decide", lesson: "decide", skill: "open", "sign-in": "open", credential: "open", connector: "open",
    });
  });

  it("drops a card once it is answered, dismissed or run out, and the whole thread when it is deleted", () => {
    const { put, drop, index } = build();
    put("t-atlas", permission("a"));
    put("t-atlas", permission("b"));
    put("t-pepper", permission("c"));
    expect(index.size).toBe(3);
    put("t-atlas", permission("a", { answered: "allow" }), "message.patch");
    put("t-atlas", permission("b", { dismissed: true }), "message.patch");
    expect(index.items(admin).map((item) => item.messageId)).toEqual(["c"]);
    put("t-pepper", permission("c", { expired: true }), "message.patch");
    expect(index.size).toBe(0);
    put("t-pepper", permission("d"));
    drop("t-pepper");
    expect(index.size).toBe(0);
  });

  it("starts from what already waits, and tells listeners when the list changes", () => {
    const fake = fakeStore([ATLAS]);
    fake.put("t-atlas", permission("old"));
    const index = createApprovalsIndex({ store: fake.store, ttlMs: () => 24 * HOUR, nameOf: () => undefined });
    const seen = vi.fn();
    index.onChange(seen);
    index.start([{ threadId: "t-atlas", messageId: "old" }, { threadId: "t-atlas", messageId: "gone" }, { threadId: "nowhere", messageId: "x" }]);
    expect(index.items(admin).map((item) => item.messageId)).toEqual(["old"]);
    expect(seen).toHaveBeenCalledTimes(1);
    fake.put("t-atlas", permission("new"));
    expect(seen).toHaveBeenCalledTimes(2);
    index.stop();
    expect(index.size).toBe(0);
    expect(fake.listeners()).toBe(0);
  });

  it("puts a critical action first, then the oldest", () => {
    const { put, index } = build();
    put("t-atlas", permission("early", {}, NOW));
    put("t-atlas", permission("late", {}, NOW + 5_000));
    put("t-atlas", permission("held", { heldCode: "approval.held.sensitive" }, NOW + 9_000));
    expect(index.items(admin).map((item) => [item.messageId, item.risk])).toEqual([["held", "critical"], ["early", "normal"], ["late", "normal"]]);
  });

  it("speaks for the member a leader's card relays, and for a room's speaker", () => {
    const { put, index } = build([ATLAS, PEPPER]);
    put("t-atlas", permission("relay", { relayFor: { botId: "pepper", name: "Pepper", threadId: "t-pepper" } as never }));
    put("t-atlas", { ...permission("spoken"), from: { botId: "pepper", name: "Pepper", color: "#fff" } });
    expect(index.items(admin).map((item) => [item.messageId, item.botId, item.botName]).sort()).toEqual([
      ["relay", "pepper", "Pepper"], ["spoken", "pepper", "Pepper"],
    ]);
  });
});

describe("who sees what, and who may decide", () => {
  it("shows a member only the bots and conversations they are shown", () => {
    const { put, index } = build();
    put("t-atlas", permission("a"));
    put("t-pepper", permission("p"));
    expect(index.items(member("ada@example.test", { bot: (id) => id === "pepper" })).map((item) => item.messageId)).toEqual(["p"]);
    expect(index.items(member("ada@example.test", { thread: (id) => id === "t-atlas" })).map((item) => item.messageId)).toEqual(["a"]);
    expect(index.items(member("ada@example.test", { bot: () => false }))).toEqual([]);
    const card = index.find("t-atlas", "a")!;
    expect(index.visibleItem(card, member("ada@example.test", { thread: () => false }))).toBeNull();
    expect(index.visibleItem(card, member("ada@example.test"))).not.toBeNull();
  });

  it("hides a room's cards from someone who is not in the room", () => {
    const { put, index } = build([ATLAS], [{ id: "room-1", threadId: "t-room" }]);
    put("t-room", { ...permission("r"), from: { botId: "atlas", name: "Atlas", color: "#fff" } });
    const inRoom = index.items(admin)[0]!;
    expect(inRoom.groupId).toBe("room-1");
    expect(index.items(member("ada@example.test", { group: () => false }))).toEqual([]);
    expect(index.items(member("ada@example.test", { group: (id) => id === "room-1" }))).toHaveLength(1);
  });

  it("lets the administrators and the agent's owner decide, and no one else", () => {
    const { put, index } = build();
    put("t-atlas", permission("a"));
    put("t-pepper", permission("p"));
    const canDecide = (viewer: ApprovalsViewer) => Object.fromEntries(index.items(viewer).map((item) => [item.botId, item.canDecide]));
    expect(canDecide(admin)).toEqual({ atlas: true, pepper: true });
    expect(canDecide(member("rafael@example.test"))).toEqual({ atlas: true, pepper: false });
    expect(canDecide(member("ada@example.test"))).toEqual({ atlas: false, pepper: false });
  });

  it("does not let anyone decide a card the answer route would refuse them", () => {
    const { put, index } = build();
    put("t-atlas", permission("a"));
    const refusing = member("rafael@example.test", {}, () => "Only the person who started this conversation can answer.");
    expect(index.items(refusing)[0]).toMatchObject({ canDecide: false });
    expect(index.items({ ...admin, refusal: () => null })[0]).toMatchObject({ canDecide: true });
  });

  it("finds a card by its request and says who answers for its agent", () => {
    const { put, index } = build();
    put("t-atlas", permission("a"));
    const card = index.byRequest("req-a")!;
    expect(card.message.id).toBe("a");
    expect(index.owner(card)).toBe("rafael@example.test");
    expect(index.byRequest("nope")).toBeUndefined();
    expect(index.voice(card)).toMatchObject({ bot: { id: "atlas", name: "Atlas" }, speaker: false });
  });
});
