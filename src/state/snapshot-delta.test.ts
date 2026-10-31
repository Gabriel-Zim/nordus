import { describe, expect, it } from "vitest";

import { askedThreads, initialState, reducer, snapshotPath, type AppState, type Bot, type Group, type Message } from "./store";

const message = (id: string, at: number): Message => ({ id, at, role: "bot", kind: "text", text: id });
const page = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, index) => message(`m${from + index}`, from + index));

const bot = (id: string, threadId: string, messages: Message[], extra: Partial<Bot> = {}): Bot => ({
  id, threadId, name: id, title: "", description: "", notifications: true, color: "green", unread: false, busy: false,
  modelSelection: { instanceId: "default", model: "m" }, approvalMode: "ask", alwaysAllow: [], messages, ...extra,
});
const room = (id: string, threadId: string, messages: Message[]): Group => ({
  id, threadId, name: id, memberIds: [], createdAt: 1, defaultResponder: { kind: "everyone" }, bulletin: "", unread: false, messages,
});
const thin = <T extends { messages: Message[]; hasMore?: boolean; activeLeafId?: string | null }>(owner: T) => {
  const { messages: _messages, hasMore: _hasMore, activeLeafId: _leaf, ...rest } = owner;
  return rest;
};

function holding(): AppState {
  return {
    ...initialState,
    hydrated: true,
    bots: [
      bot("quiet", "quiet-thread", page(1, 3), { hasMore: true, activeLeafId: "m3" }),
      bot("busy", "busy-thread", page(1, 80), { hasMore: false }),
    ],
    groups: [room("room", "room-thread", page(1, 2))],
    transcriptGeneration: { "quiet-thread": 4, "busy-thread": 7 },
    loadingOlder: { "quiet-thread": true, "busy-thread": true },
  };
}

describe("delta snapshot", () => {
  it("keeps a held conversation the snapshot left out, with its paging and branch", () => {
    const state = holding();
    const next = reducer(state, {
      type: "hydrate", delta: true, computerControl: {},
      bots: [{ ...thin(state.bots[0]!), busy: true }, { ...thin(state.bots[1]!), messages: page(61, 82), hasMore: true }],
      groups: [thin(state.groups[0]!)],
    });

    const quiet = next.bots.find((candidate) => candidate.id === "quiet")!;
    expect(quiet.busy).toBe(true);
    expect(quiet.messages).toBe(state.bots[0]!.messages);
    expect(quiet).toMatchObject({ hasMore: true, activeLeafId: "m3" });
    expect(next.groups[0]!.messages).toBe(state.groups[0]!.messages);
    expect(next.transcriptGeneration["quiet-thread"]).toBe(4);
    expect(next.loadingOlder["quiet-thread"]).toBe(true);
  });

  it("folds a changed conversation's newest page into the rows it overlaps, keeping the page in flight", () => {
    const state = holding();
    const next = reducer(state, {
      type: "hydrate", delta: true, computerControl: {},
      bots: [thin(state.bots[0]!), { ...thin(state.bots[1]!), messages: page(61, 82), hasMore: true }],
      groups: [thin(state.groups[0]!)],
    });
    const busy = next.bots.find((candidate) => candidate.id === "busy")!;
    expect(busy.messages.map((item) => item.id)).toEqual(page(1, 82).map((item) => item.id));
    expect(busy.hasMore).toBe(true);
    expect(next.transcriptGeneration["busy-thread"]).toBe(7);
    expect(next.loadingOlder["busy-thread"]).toBe(true);
  });

  it("takes a changed conversation's page as its new base when nothing overlaps, and fences the old pages", () => {
    const state = holding();
    const next = reducer(state, {
      type: "hydrate", delta: true, computerControl: {},
      bots: [thin(state.bots[0]!), { ...thin(state.bots[1]!), messages: page(300, 310), hasMore: true }],
      groups: [thin(state.groups[0]!)],
    });
    const busy = next.bots.find((candidate) => candidate.id === "busy")!;
    expect(busy.messages.map((item) => item.id)).toEqual(page(300, 310).map((item) => item.id));
    expect(busy.hasMore).toBe(true);
    expect(next.transcriptGeneration["busy-thread"]).toBe(8);
    expect(next.transcriptGeneration["quiet-thread"]).toBe(4);
  });

  it("keeps what a device shows when it moved to another conversation while the snapshot was on its way", () => {
    const state = holding();
    const asked = askedThreads(state);
    const moved = { ...state, bots: [{ ...state.bots[0]!, threadId: "picked-thread", messages: page(900, 901), awaitingThreadSnapshot: true }, state.bots[1]!] };
    for (const quietPage of [undefined, page(4, 5)]) {
      const next = reducer(moved, {
        type: "hydrate", delta: true, computerControl: {}, askedThreads: asked,
        bots: [{ ...thin(state.bots[0]!), ...(quietPage ? { messages: quietPage } : {}) }, thin(state.bots[1]!)],
        groups: [thin(state.groups[0]!)],
      });
      expect(next.bots[0]).toMatchObject({ threadId: "picked-thread", awaitingThreadSnapshot: true });
      expect(next.bots[0]!.messages.map((item) => item.id)).toEqual(["m900", "m901"]);
    }
  });

  it("follows the server when the conversation changed on its side, not on the device", () => {
    const state = holding();
    const next = reducer(state, {
      type: "hydrate", delta: true, computerControl: {}, askedThreads: askedThreads(state),
      bots: [{ ...thin(state.bots[0]!), threadId: "other-thread", messages: page(500, 501) }, thin(state.bots[1]!)],
      groups: [thin(state.groups[0]!)],
    });
    expect(next.bots[0]).toMatchObject({ threadId: "other-thread" });
    expect(next.bots[0]!.messages.map((item) => item.id)).toEqual(["m500", "m501"]);
  });

  it("drops what the server no longer lists and takes a bot that moved to another conversation from its page", () => {
    const state = holding();
    const next = reducer(state, {
      type: "hydrate", delta: true, computerControl: {},
      bots: [{ ...thin(state.bots[0]!), threadId: "other-thread", messages: page(500, 501) }],
      groups: [],
    });
    expect(next.bots.map((candidate) => candidate.id)).toEqual(["quiet"]);
    expect(next.bots[0]!.messages.map((item) => item.id)).toEqual(["m500", "m501"]);
    expect(next.groups).toEqual([]);
  });

  it("folds a full snapshot into every conversation and moves only a rebased one's generation forward", () => {
    const state = holding();
    const next = reducer(state, {
      type: "hydrate", computerControl: {},
      bots: [{ ...thin(state.bots[0]!), messages: page(9, 9) }, { ...thin(state.bots[1]!), messages: page(61, 82) }],
      groups: [{ ...thin(state.groups[0]!), messages: [] }],
    });
    expect(next.bots.map((candidate) => candidate.messages.length)).toEqual([1, 82]);
    expect(next.groups[0]!.messages).toBe(state.groups[0]!.messages);
    expect(next.transcriptGeneration).toEqual({ "quiet-thread": 5, "busy-thread": 7 });
    expect(next.loadingOlder).toEqual(state.loadingOlder);
  });
});

describe("snapshot request", () => {
  it("asks for everything without a cursor and names the conversations it holds with one", () => {
    const state = holding();
    expect(snapshotPath(null, state)).toBe("/api/bots?messages=60&preview=6");
    expect(snapshotPath(null, { ...state, selectedId: "bot-a" })).toBe("/api/bots?messages=60&preview=6&focus=bot-a");
    const withCursor = new URL(snapshotPath("abcd1234:77", state), "http://x");
    expect(withCursor.searchParams.get("since")).toBe("abcd1234:77");
    expect(withCursor.searchParams.get("held")?.split(",")).toEqual(["quiet-thread", "busy-thread", "room-thread"]);
  });

  it("does not claim a conversation a bot is still waiting to receive", () => {
    const state = holding();
    const switching = { ...state, bots: [{ ...state.bots[0]!, awaitingThreadSnapshot: true }, state.bots[1]!] };
    const held = new URL(snapshotPath("abcd1234:77", switching), "http://x").searchParams.get("held");
    expect(held?.split(",")).toEqual(["busy-thread", "room-thread"]);
  });
});
