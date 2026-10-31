import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ServerFrame } from "../../shared/wire";
import type { DirectConversation, DirectMessage } from "../../shared/people";

const server = vi.hoisted(() => ({
  requests: [] as Array<{ path: string; method: string; body?: unknown }>,
  answer: (_path: string, _method: string, _body: unknown): unknown => ({}),
}));
const stream = vi.hoisted(() => ({ listeners: 0 }));
vi.mock("@/lib/live-events", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/live-events")>();
  return { ...actual, listenLiveFrames: (listener: Parameters<typeof actual.listenLiveFrames>[0]) => { stream.listeners++; return actual.listenLiveFrames(listener); } };
});
vi.mock("./api", async (importOriginal) => ({
  ...await importOriginal<typeof import("./api")>(),
  api: async (path: string, init?: { method?: string; body?: string }) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(init.body) : undefined;
    server.requests.push({ path, method, body });
    const result = server.answer(path, method, body);
    if (result instanceof Error) throw result;
    return result;
  },
}));

import { publishLiveFrame, publishMissedFrames } from "@/lib/live-events";
import { ApiError } from "./api";
import {
  DIRECT_PAGE, directIdOf, directSnapshot, EMPTY_DIRECT, loadConversations, loadEarlier, markRead, openThread, parseConversation, parseMessage,
  readDirectFrame, reduceDirectFrame, resetDirect, sendLine, startConversation, startDirect, syncDirect, unreadCount, withEarlierPage,
  withLatestPage, withLine, withRead, type DirectState,
} from "./direct-messages";

const ME = "ana@acme.test";
const line = (id: string, at: number, from = "bia@acme.test", text = `line ${id}`): DirectMessage => ({ id, at, from, name: from, text });
const conversation = (id: string, peer: string, last?: DirectMessage, unread = false): DirectConversation => ({
  id, threadId: `dm:${id}`, peer, peerName: peer.split("@")[0]!, unread, ...(last ? { last } : {}),
});
const stateOf = (dms: DirectConversation[], threads: DirectState["threads"] = {}): DirectState => ({ ...EMPTY_DIRECT, loaded: true, dms, threads });
const thread = (messages: DirectMessage[], hasMore = false) => ({ messages, hasMore, loading: false, failed: false });
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0)); };
const live = (frame: object) => publishLiveFrame(frame as ServerFrame);

describe("direct message frames", () => {
  it("reads the two frames the server sends and nothing else", () => {
    const dm = conversation("d1", "bia@acme.test", line("m1", 5));
    expect(readDirectFrame({ kind: "dm", dm } as { kind: string })).toEqual({ kind: "dm", dm });
    expect(readDirectFrame({ kind: "dm.message", dmId: "d1", message: line("m2", 6) } as { kind: string })).toEqual({ kind: "dm.message", dmId: "d1", message: line("m2", 6) });
    expect(readDirectFrame({ kind: "dm", dm: { id: "d1" } } as { kind: string })).toBeNull();
    expect(readDirectFrame({ kind: "dm.message", dmId: 7, message: line("m2", 6) } as { kind: string })).toBeNull();
    expect(readDirectFrame({ kind: "dm.message", dmId: "d1", message: { id: "x" } } as { kind: string })).toBeNull();
    expect(readDirectFrame({ kind: "bot" })).toBeNull();
  });

  it("falls back on the thread id and the address when the server leaves them out", () => {
    expect(parseConversation({ id: "d1", peer: "bia@acme.test" })).toEqual({ id: "d1", threadId: "dm:d1", peer: "bia@acme.test", peerName: "bia@acme.test", unread: false });
    expect(parseConversation({ peer: "bia@acme.test" })).toBeNull();
    expect(parseMessage({ id: "m", at: 1, from: "a@b.test", text: "oi" })).toEqual({ id: "m", at: 1, from: "a@b.test", name: "", text: "oi" });
  });

  it("names the conversation a notification thread points to", () => {
    expect(directIdOf("dm:abc")).toBe("abc");
    expect(directIdOf("dm:")).toBeNull();
    expect(directIdOf("thread-1")).toBeNull();
    expect(directIdOf(undefined)).toBeNull();
  });
});

describe("a line arriving in a conversation", () => {
  it("marks it unread, makes it the latest and puts the conversation first", () => {
    const state = stateOf([conversation("d1", "bia@acme.test", line("m1", 10), false), conversation("d2", "caio@acme.test", line("m2", 20), false)]);
    const next = reduceDirectFrame(state, { kind: "dm.message", dmId: "d1", message: line("m3", 30) }, ME);
    expect(next.dms.map((dm) => dm.id)).toEqual(["d1", "d2"]);
    expect(next.dms[0]).toMatchObject({ unread: true, last: { id: "m3" } });
    expect(next.dms[1]!.unread).toBe(false);
  });

  it("adds the line to a conversation that is open, once", () => {
    const state = stateOf([conversation("d1", "bia@acme.test", line("m1", 10))], { d1: thread([line("m1", 10)]) });
    const once = reduceDirectFrame(state, { kind: "dm.message", dmId: "d1", message: line("m2", 20) }, ME);
    const twice = reduceDirectFrame(once, { kind: "dm.message", dmId: "d1", message: line("m2", 20) }, ME);
    expect(twice.threads.d1!.messages.map((item) => item.id)).toEqual(["m1", "m2"]);
  });

  it("does not leave a conversation unread because of what this person wrote", () => {
    const state = stateOf([conversation("d1", "bia@acme.test", line("m1", 10))]);
    expect(withLine(state, "d1", line("m2", 20, ME), ME).dms[0]).toMatchObject({ unread: false, last: { id: "m2" } });
  });

  it("ignores a line for a conversation this person is not in", () => {
    const state = stateOf([conversation("d1", "bia@acme.test", line("m1", 10))]);
    expect(reduceDirectFrame(state, { kind: "dm.message", dmId: "somebody-elses", message: line("m9", 99) }, ME)).toBe(state);
  });

  it("ignores a conversation frame that names this person as the other side", () => {
    const state = stateOf([]);
    expect(reduceDirectFrame(state, { kind: "dm", dm: conversation("d9", ME) }, ME)).toBe(state);
    expect(reduceDirectFrame(state, { kind: "dm", dm: conversation("d9", "bia@acme.test") }, ME).dms.map((dm) => dm.id)).toEqual(["d9"]);
  });

  it("counts unread conversations and clears one when it is read", () => {
    const state = stateOf([conversation("d1", "bia@acme.test", line("m1", 10), true), conversation("d2", "caio@acme.test", line("m2", 20), true)]);
    expect(unreadCount(state)).toBe(2);
    const read = withRead(state, "d1");
    expect(unreadCount(read)).toBe(1);
    expect(withRead(read, "d1")).toBe(read);
  });
});

describe("paging a conversation", () => {
  it("shows the latest page and what is earlier, oldest first", () => {
    const first = withLatestPage(stateOf([conversation("d1", "bia@acme.test")]), "d1", { messages: [line("m3", 3), line("m4", 4)], hasMore: true });
    expect(first.threads.d1).toMatchObject({ hasMore: true, messages: [{ id: "m3" }, { id: "m4" }] });
    const earlier = withEarlierPage(first, "d1", { messages: [line("m1", 1), line("m2", 2)], hasMore: false });
    expect(earlier.threads.d1!.messages.map((item) => item.id)).toEqual(["m1", "m2", "m3", "m4"]);
    expect(earlier.threads.d1!.hasMore).toBe(false);
  });

  it("merges a refreshed page that connects to what is shown, and replaces it when it does not", () => {
    const shown = stateOf([conversation("d1", "bia@acme.test")], { d1: thread([line("m1", 1), line("m2", 2)], true) });
    const connected = withLatestPage(shown, "d1", { messages: [line("m2", 2), line("m3", 3)], hasMore: false });
    expect(connected.threads.d1).toMatchObject({ hasMore: true, messages: [{ id: "m1" }, { id: "m2" }, { id: "m3" }] });
    const gap = withLatestPage(shown, "d1", { messages: [line("m8", 8), line("m9", 9)], hasMore: true });
    expect(gap.threads.d1!.messages.map((item) => item.id)).toEqual(["m8", "m9"]);
  });
});

describe("direct messages against the server", () => {
  beforeEach(() => {
    resetDirect();
    server.requests = [];
    server.answer = () => ({});
  });
  afterEach(() => resetDirect());

  const list = (...dms: DirectConversation[]) => { server.answer = (path) => (path === "/api/dms" ? { dms } : {}); };

  it("lists the conversations newest first", async () => {
    list(conversation("d1", "bia@acme.test", line("m1", 10)), conversation("d2", "caio@acme.test", line("m2", 20)));
    await loadConversations();
    expect(directSnapshot()).toMatchObject({ loaded: true, available: true });
    expect(directSnapshot().dms.map((dm) => dm.id)).toEqual(["d2", "d1"]);
  });

  it("drops the whole block when the server says this person has no address to write from", async () => {
    list(conversation("d1", "bia@acme.test", line("m1", 10)));
    await loadConversations();
    server.answer = () => new ApiError("forbidden", 403);
    resetDirect();
    await loadConversations();
    expect(directSnapshot()).toMatchObject({ loaded: true, available: false, dms: [] });
  });

  it("keeps what it had when the server cannot be reached", async () => {
    list(conversation("d1", "bia@acme.test", line("m1", 10)));
    await loadConversations();
    server.answer = () => new Error("offline");
    await loadConversations();
    expect(directSnapshot()).toMatchObject({ available: true });
    expect(directSnapshot().dms.map((dm) => dm.id)).toEqual(["d1"]);
  });

  it("opens a conversation on its newest page and asks for earlier ones from the oldest line", async () => {
    list(conversation("d1", "bia@acme.test", line("m3", 3)));
    await loadConversations();
    server.answer = (path) => {
      if (path.includes("before=m2")) return { messages: [line("m0", 0), line("m1", 1)], hasMore: false };
      return path.startsWith("/api/dms/d1/messages") ? { messages: [line("m2", 2), line("m3", 3)], hasMore: true } : {};
    };
    await openThread("d1");
    expect(directSnapshot().threads.d1).toMatchObject({ hasMore: true, loading: false, failed: false });
    await loadEarlier("d1");
    expect(directSnapshot().threads.d1!.messages.map((item) => item.id)).toEqual(["m0", "m1", "m2", "m3"]);
    expect(directSnapshot().threads.d1!.hasMore).toBe(false);
    const paths = server.requests.map((request) => request.path);
    expect(paths).toContain(`/api/dms/d1/messages?limit=${DIRECT_PAGE}`);
    expect(paths).toContain(`/api/dms/d1/messages?limit=${DIRECT_PAGE}&before=m2`);
    await loadEarlier("d1");
    expect(server.requests.filter((request) => request.path.includes("/messages"))).toHaveLength(2);
  });

  it("says so when a page cannot be loaded, and loads it on the next try", async () => {
    list(conversation("d1", "bia@acme.test"));
    await loadConversations();
    server.answer = () => new Error("offline");
    await openThread("d1");
    expect(directSnapshot().threads.d1).toMatchObject({ failed: true, loading: false });
    server.answer = () => ({ messages: [line("m1", 1)], hasMore: false });
    await openThread("d1");
    expect(directSnapshot().threads.d1).toMatchObject({ failed: false, messages: [{ id: "m1" }] });
  });

  it("sends a line and shows it at once without leaving the conversation unread", async () => {
    startDirect(ME);
    list(conversation("d1", "bia@acme.test", line("m1", 10), true));
    await loadConversations();
    server.answer = (path, method) => (method === "POST" && path === "/api/dms/d1/messages" ? { message: line("m2", 20, ME, "oi") } : {});
    await sendLine("d1", "oi");
    expect(server.requests.at(-1)).toEqual({ path: "/api/dms/d1/messages", method: "POST", body: { text: "oi" } });
    expect(directSnapshot().dms[0]).toMatchObject({ unread: false, last: { id: "m2", text: "oi" } });
  });

  it("lets the caller keep what was typed when the server refuses the line", async () => {
    list(conversation("d1", "bia@acme.test"));
    await loadConversations();
    server.answer = () => new ApiError("too long", 400);
    await expect(sendLine("d1", "x")).rejects.toThrow("too long");
  });

  it("starts a conversation with a person and lists it", async () => {
    server.answer = (path, method) => (method === "POST" && path === "/api/dms" ? { dm: conversation("d7", "bia@acme.test") } : {});
    const dm = await startConversation("bia@acme.test");
    expect(server.requests.at(-1)).toEqual({ path: "/api/dms", method: "POST", body: { peer: "bia@acme.test" } });
    expect(dm.id).toBe("d7");
    expect(directSnapshot().dms.map((item) => item.id)).toEqual(["d7"]);
    server.answer = () => ({});
    await expect(startConversation("nobody@acme.test")).rejects.toThrow();
  });

  it("clears the unread dot at once and tells the server", async () => {
    list(conversation("d1", "bia@acme.test", line("m1", 10), true));
    await loadConversations();
    server.requests = [];
    const pending = markRead("d1");
    expect(directSnapshot().dms[0]!.unread).toBe(false);
    await pending;
    expect(server.requests).toEqual([{ path: "/api/dms/d1/read", method: "POST", body: {} }]);
  });

  it("asks again after a reconnect: the list, and the newest page of each open conversation", async () => {
    list(conversation("d1", "bia@acme.test", line("m1", 10)), conversation("d2", "caio@acme.test", line("m5", 5)));
    await loadConversations();
    server.answer = (path) => (path.startsWith("/api/dms/d1/messages") ? { messages: [line("m1", 10)], hasMore: false } : {});
    await openThread("d1");
    server.requests = [];
    list(conversation("d1", "bia@acme.test", line("m7", 70), true), conversation("d2", "caio@acme.test", line("m5", 5)));
    const original = server.answer;
    server.answer = (path, method, body) => (path.startsWith("/api/dms/d1/messages") ? { messages: [line("m1", 10), line("m7", 70)], hasMore: false } : original(path, method, body));
    await syncDirect();
    expect(server.requests.map((request) => request.path)).toEqual(["/api/dms", `/api/dms/d1/messages?limit=${DIRECT_PAGE}`]);
    expect(directSnapshot().dms[0]).toMatchObject({ id: "d1", unread: true });
    expect(directSnapshot().threads.d1!.messages.map((item) => item.id)).toEqual(["m1", "m7"]);
    expect(directSnapshot().threads.d2).toBeUndefined();
  });

  it("follows the live stream for the two people, and asks again when it missed frames", async () => {
    startDirect(ME);
    list(conversation("d1", "bia@acme.test", line("m1", 10)));
    await loadConversations();
    live({ kind: "dm.message", dmId: "d1", message: line("m2", 20) });
    expect(directSnapshot().dms[0]).toMatchObject({ unread: true, last: { id: "m2" } });
    live({ kind: "dm", dm: conversation("d3", "caio@acme.test", line("m3", 30)) });
    expect(directSnapshot().dms.map((dm) => dm.id)).toEqual(["d3", "d1"]);
    server.requests = [];
    publishMissedFrames();
    await settle();
    expect(server.requests[0]).toMatchObject({ path: "/api/dms", method: "GET" });
  });

  it("never shows a line for a conversation it does not have, and looks the list up again instead", async () => {
    startDirect(ME);
    list(conversation("d1", "bia@acme.test", line("m1", 10)));
    await loadConversations();
    server.requests = [];
    live({ kind: "dm.message", dmId: "strangers", message: line("m9", 99, "x@acme.test", "secret") });
    await settle();
    expect(directSnapshot().dms.map((dm) => dm.id)).toEqual(["d1"]);
    expect(JSON.stringify(directSnapshot())).not.toContain("secret");
    expect(server.requests.map((request) => request.path)).toEqual(["/api/dms"]);
  });

  it("listens to the stream once however often it is started", () => {
    stream.listeners = 0;
    startDirect(ME);
    startDirect(ME);
    startDirect("other@acme.test");
    expect(stream.listeners).toBe(1);
  });
});
