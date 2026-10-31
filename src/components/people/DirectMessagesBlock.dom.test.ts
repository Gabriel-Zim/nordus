// @vitest-environment happy-dom
// The sidebar's direct messages in a real DOM: who is listed, what stays out of sight, and how a conversation is opened or begun.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DirectConversation, DirectoryPerson } from "../../../shared/people";
import type { SidebarDensity } from "@/lib/sidebar-preferences";

const fixture = vi.hoisted(() => ({
  dispatch: vi.fn(),
  state: { activeView: "chat", directId: null } as { activeView: string; directId: string | null },
  requests: [] as Array<{ path: string; method: string; body?: unknown }>,
  answer: (_path: string, _method: string, _body: unknown): unknown => ({}),
}));
vi.mock("@/state/store", () => ({ useStore: () => ({ state: fixture.state, dispatch: fixture.dispatch }) }));
vi.mock("@/lib/use-viewer", () => ({ useViewer: () => ({ admin: false, guest: false, email: "ana@acme.test" }), useGuest: () => false }));
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
const directory: DirectoryPerson[] = [
  { email: "ana@acme.test", name: "Ana", role: "member" },
  { email: "bia@acme.test", name: "Bia", role: "member" },
  { email: "caio@acme.test", name: "Caio", role: "admin" },
];
const shared = vi.hoisted(() => ({ people: [] as DirectoryPerson[] }));
vi.mock("@/state/people-directory", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/people-directory")>(),
  useDirectory: () => ({ loaded: true, people: shared.people }),
}));

const { ApiError } = await import("@/state/api");
const { DirectMessagesBlock, listedConversations } = await import("./DirectMessagesBlock");
const { loadConversations, resetDirect } = await import("@/state/direct-messages");

const conversation = (id: string, peer: string, peerName: string, extra: Partial<DirectConversation> = {}): DirectConversation => ({ id, threadId: `dm:${id}`, peer, peerName, unread: false, ...extra });
const said = (text: string, from: string, id = "m1") => ({ id, at: 1, from, name: from, text });

let host: HTMLDivElement;
let root: Root;
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0)); };
const show = async (density: SidebarDensity = "comfortable") => {
  flushSync(() => root.render(createElement(DirectMessagesBlock, { density })));
  await settle();
};
const rows = () => [...host.querySelectorAll("[data-sidebar-dm-row]")].map((row) => row.getAttribute("data-sidebar-dm-row"));
const click = (selector: string) => {
  const element = host.querySelector(selector);
  if (!element) throw new Error(`nothing matches ${selector}`);
  flushSync(() => element.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 })));
};
const serve = (dms: DirectConversation[]) => {
  fixture.answer = (path, method) => (path === "/api/dms" && method === "GET" ? { dms } : {});
};

beforeEach(() => {
  resetDirect();
  shared.people = directory;
  fixture.dispatch.mockReset();
  fixture.state = { activeView: "chat", directId: null };
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

describe("which conversations the sidebar lists", () => {
  const spoken = conversation("d1", "bia@acme.test", "Bia", { last: said("Oi", "bia@acme.test") });
  const quiet = conversation("d2", "caio@acme.test", "Caio");

  it("leaves out a conversation nobody has spoken in, unless it is the one open", () => {
    expect(listedConversations([spoken, quiet], null)).toEqual([spoken]);
    expect(listedConversations([spoken, quiet], "d2")).toEqual([spoken, quiet]);
  });
});

describe("the direct messages block", () => {
  it("lists each conversation with the person, the last line and who said it", async () => {
    serve([
      conversation("d1", "bia@acme.test", "Bia", { last: said("Pode olhar isso?", "bia@acme.test") }),
      conversation("d2", "caio@acme.test", "Caio", { last: said("Já mandei", "ana@acme.test") }),
    ]);
    await loadConversations();
    await show();
    expect(host.textContent).toContain("Direct messages");
    expect(rows()).toEqual(["d1", "d2"]);
    expect(host.querySelector('[data-sidebar-dm-row="d1"]')?.textContent).toBe("BBiaPode olhar isso?");
    expect(host.querySelector('[data-sidebar-dm-row="d2"]')?.textContent).toBe("CCaioYou: Já mandei");
  });

  it("marks what is unread, but not the conversation that is open", async () => {
    serve([
      conversation("d1", "bia@acme.test", "Bia", { unread: true, last: said("Oi", "bia@acme.test") }),
      conversation("d2", "caio@acme.test", "Caio", { unread: true, last: said("Olá", "caio@acme.test", "m2") }),
    ]);
    await loadConversations();
    fixture.state = { activeView: "direct", directId: "d2" };
    await show();
    expect(host.querySelector('[data-sidebar-dm-row="d1"] [aria-label="Unread"]')).not.toBeNull();
    expect(host.querySelector('[data-sidebar-dm-row="d2"] [aria-label="Unread"]')).toBeNull();
    expect(host.querySelector('[data-sidebar-dm-row="d2"]')?.getAttribute("aria-current")).toBe("page");
    expect(host.querySelector('[data-sidebar-dm-row="d1"]')?.getAttribute("aria-current")).toBeNull();
  });

  it("opens a conversation when its row is clicked", async () => {
    serve([conversation("d1", "bia@acme.test", "Bia", { last: said("Oi", "bia@acme.test") })]);
    await loadConversations();
    await show();
    click('[data-sidebar-dm-row="d1"]');
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "showDirect", id: "d1" });
  });

  it("stays out of sight when the server refuses direct messages to this person", async () => {
    fixture.answer = () => new ApiError("forbidden", 403);
    await loadConversations();
    await show();
    expect(host.innerHTML).toBe("");
  });

  it("stays out of sight in the icon rail", async () => {
    serve([conversation("d1", "bia@acme.test", "Bia", { last: said("Oi", "bia@acme.test") })]);
    await loadConversations();
    await show("icons");
    expect(host.innerHTML).toBe("");
  });

  it("stays out of sight when there is nobody else to write to", async () => {
    shared.people = [directory[0]!];
    serve([]);
    await loadConversations();
    await show();
    expect(host.innerHTML).toBe("");
  });

  it("offers no way to begin one when only old conversations are left", async () => {
    shared.people = [directory[0]!];
    serve([conversation("d1", "bia@acme.test", "Bia", { last: said("Oi", "bia@acme.test") })]);
    await loadConversations();
    await show();
    expect(rows()).toEqual(["d1"]);
    expect(host.querySelector("[data-direct-new]")).toBeNull();
  });
});

describe("beginning a conversation", () => {
  const open = async () => {
    serve([]);
    await loadConversations();
    await show();
    click("[data-direct-new]");
    await settle();
  };

  it("lists the others, never the person themselves, and puts nobody in the list before it is asked for", async () => {
    serve([]);
    await loadConversations();
    await show();
    expect(host.querySelector("[data-direct-picker]")).toBeNull();
    click("[data-direct-new]");
    expect(host.querySelector("[data-direct-new]")?.getAttribute("aria-expanded")).toBe("true");
    const people = [...host.querySelectorAll("[data-direct-picker] [data-person]")].map((row) => row.getAttribute("data-person"));
    expect(people).toEqual(["bia@acme.test", "caio@acme.test"]);
  });

  it("asks the server for the conversation with that person and opens it", async () => {
    await open();
    fixture.answer = (path, method) => (path === "/api/dms" && method === "POST" ? { dm: conversation("d9", "bia@acme.test", "Bia") } : {});
    click('[data-person="bia@acme.test"]');
    await settle();
    expect(fixture.requests).toContainEqual({ path: "/api/dms", method: "POST", body: { peer: "bia@acme.test" } });
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "showDirect", id: "d9" });
    expect(host.querySelector("[data-direct-picker]")).toBeNull();
    expect(rows()).toEqual([]);
    fixture.state = { activeView: "direct", directId: "d9" };
    await show();
    expect(rows()).toEqual(["d9"]);
  });

  it("says so, and keeps the list open, when the conversation could not be opened", async () => {
    await open();
    fixture.answer = () => new Error("offline");
    click('[data-person="bia@acme.test"]');
    await settle();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("Could not open the conversation. Try again.");
    expect(host.querySelector("[data-direct-picker]")).not.toBeNull();
    expect(fixture.dispatch).not.toHaveBeenCalled();
  });

  it("closes the list when the plus is pressed again", async () => {
    await open();
    click("[data-direct-new]");
    expect(host.querySelector("[data-direct-picker]")).toBeNull();
  });
});
