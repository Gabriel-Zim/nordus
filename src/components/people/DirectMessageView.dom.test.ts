// @vitest-environment happy-dom
// A direct message in a real DOM: the lines appear, the dot clears, a line is sent, and earlier ones come on request.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DirectConversation, DirectMessage } from "../../../shared/people";

const fixture = vi.hoisted(() => ({
  requests: [] as Array<{ path: string; method: string; body?: unknown }>,
  answer: (_path: string, _method: string, _body: unknown): unknown => ({}),
}));
vi.mock("@/state/store", () => ({ useStore: () => ({ state: {}, dispatch: () => {} }), formatTime: () => "10:30" }));
vi.mock("@/lib/use-viewer", () => ({ useViewer: () => ({ admin: false, guest: false, email: "ana@acme.test" }), useGuest: () => false }));
vi.mock("../DesktopCapabilities", () => ({ useCaptionChrome: () => ({ dragProps: {}, padClass: "" }) }));
vi.mock("@/state/api", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/api")>(),
  api: async (path: string, init?: { method?: string; body?: string }) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(init.body) : undefined;
    fixture.requests.push({ path, method, body });
    const result = fixture.answer(path, method, body);
    if (result instanceof Error) throw result;
    return result;
  },
}));

const { DirectMessageView } = await import("./DirectMessageView");
const { loadConversations, resetDirect, startDirect } = await import("@/state/direct-messages");

const line = (id: string, at: number, from = "bia@acme.test", text = `line ${id}`): DirectMessage => ({ id, at, from, name: from, text });
const conversation = (unread = false): DirectConversation => ({ id: "d1", threadId: "dm:d1", peer: "bia@acme.test", peerName: "Bia", unread, last: line("m2", 2) });

let host: HTMLDivElement;
let root: Root;
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0)); };
const lines = () => [...host.querySelectorAll("[data-dm-line]")].map((element) => element.getAttribute("data-dm-line"));
const click = (selector: string) => {
  const element = host.querySelector(selector);
  if (!element) throw new Error(`nothing matches ${selector}`);
  flushSync(() => element.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 })));
};
const typeInto = (selector: string, text: string) => {
  const element = host.querySelector<HTMLTextAreaElement>(selector)!;
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(element, text);
  flushSync(() => element.dispatchEvent(new Event("input", { bubbles: true })));
};
const enter = (selector: string, init: KeyboardEventInit = {}) => flushSync(() => host.querySelector(selector)!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, ...init })));

beforeEach(async () => {
  resetDirect();
  startDirect("ana@acme.test");
  fixture.requests = [];
  fixture.answer = (path, method) => {
    if (path === "/api/dms") return { dms: [conversation(true)] };
    if (path.startsWith("/api/dms/d1/messages") && method === "GET") return { messages: [line("m1", 1), line("m2", 2)], hasMore: false };
    return {};
  };
  await loadConversations();
  fixture.requests = [];
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  resetDirect();
});

describe("a direct message conversation", () => {
  it("opens on the newest lines, names the other person and says only the two of them see it", async () => {
    flushSync(() => root.render(createElement(DirectMessageView, { id: "d1" })));
    await settle();
    expect(lines()).toEqual(["m1", "m2"]);
    expect(host.querySelector("h1")?.textContent).toBe("Bia");
    expect(host.textContent).toContain("Only the two of you see this conversation.");
    expect(fixture.requests.map((request) => request.path)).toContain("/api/dms/d1/messages?limit=30");
  });

  it("tells the server it was read when it opens unread", async () => {
    flushSync(() => root.render(createElement(DirectMessageView, { id: "d1" })));
    await settle();
    expect(fixture.requests).toContainEqual({ path: "/api/dms/d1/read", method: "POST", body: {} });
  });

  it("sends a line on Enter and clears the box, but a Shift+Enter is only a new line", async () => {
    flushSync(() => root.render(createElement(DirectMessageView, { id: "d1" })));
    await settle();
    fixture.answer = (path, method) => (path === "/api/dms/d1/messages" && method === "POST" ? { message: line("m3", 3, "ana@acme.test", "Oi, Bia") } : {});
    typeInto("[data-dm-composer]", "Oi, Bia");
    enter("[data-dm-composer]", { shiftKey: true });
    expect(fixture.requests.some((request) => request.method === "POST" && request.path.endsWith("/messages"))).toBe(false);
    enter("[data-dm-composer]");
    await settle();
    expect(fixture.requests).toContainEqual({ path: "/api/dms/d1/messages", method: "POST", body: { text: "Oi, Bia" } });
    expect(lines()).toEqual(["m1", "m2", "m3"]);
    expect(host.querySelector<HTMLTextAreaElement>("[data-dm-composer]")!.value).toBe("");
  });

  it("keeps what was typed and says so when the line could not be sent", async () => {
    flushSync(() => root.render(createElement(DirectMessageView, { id: "d1" })));
    await settle();
    fixture.answer = () => new Error("offline");
    typeInto("[data-dm-composer]", "Oi, Bia");
    click("[data-dm-send]");
    await settle();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("The message was not sent. Try again.");
    expect(host.querySelector<HTMLTextAreaElement>("[data-dm-composer]")!.value).toBe("Oi, Bia");
  });

  it("does not send an empty line", async () => {
    flushSync(() => root.render(createElement(DirectMessageView, { id: "d1" })));
    await settle();
    expect(host.querySelector<HTMLButtonElement>("[data-dm-send]")!.disabled).toBe(true);
    typeInto("[data-dm-composer]", "   ");
    enter("[data-dm-composer]");
    await settle();
    expect(fixture.requests.some((request) => request.method === "POST" && request.path.endsWith("/messages"))).toBe(false);
  });

  it("brings earlier lines in on request, from the oldest one shown", async () => {
    fixture.answer = (path) => {
      if (path.includes("before=m1")) return { messages: [line("m0", 0)], hasMore: false };
      if (path.startsWith("/api/dms/d1/messages")) return { messages: [line("m1", 1), line("m2", 2)], hasMore: true };
      return path === "/api/dms" ? { dms: [conversation()] } : {};
    };
    flushSync(() => root.render(createElement(DirectMessageView, { id: "d1" })));
    await settle();
    expect(host.textContent).toContain("Show earlier messages");
    click("[data-dm-earlier]");
    await settle();
    expect(lines()).toEqual(["m0", "m1", "m2"]);
    expect(host.querySelector("[data-dm-earlier]")).toBeNull();
    expect(fixture.requests.map((request) => request.path)).toContain("/api/dms/d1/messages?limit=30&before=m1");
  });

  it("offers another try when the lines could not be loaded", async () => {
    fixture.answer = (path) => (path.startsWith("/api/dms/d1/messages") ? new Error("offline") : path === "/api/dms" ? { dms: [conversation()] } : {});
    flushSync(() => root.render(createElement(DirectMessageView, { id: "d1" })));
    await settle();
    expect(host.textContent).toContain("Could not load the messages.");
    fixture.answer = (path) => (path.startsWith("/api/dms/d1/messages") ? { messages: [line("m1", 1)], hasMore: false } : {});
    const retry = [...host.querySelectorAll("button")].find((button) => button.textContent === "Try again")!;
    flushSync(() => retry.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 })));
    await settle();
    expect(lines()).toEqual(["m1"]);
  });

  it("says the conversation is not available when it is not one of this person's", async () => {
    flushSync(() => root.render(createElement(DirectMessageView, { id: "strangers" })));
    await settle();
    expect(host.textContent).toContain("This conversation is not available.");
    expect(host.querySelector("[data-dm-composer]")).toBeNull();
  });
});
