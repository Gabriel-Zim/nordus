// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { approvalId, HOLD_TO_APPROVE_MS, type ApprovalItem, type InboxNote } from "../../shared/approvals";

const fixture = vi.hoisted(() => ({
  api: vi.fn(),
  dispatch: vi.fn(),
  openThread: vi.fn(),
  admin: false as boolean | null,
  state: {} as Record<string, unknown>,
  items: [] as unknown[],
  forYou: [] as unknown[],
  before: [] as unknown[],
  failApprovals: false,
}));
vi.mock("@/state/api", async (importOriginal) => ({ ...await importOriginal<typeof import("@/state/api")>(), api: fixture.api }));
vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  openThread: fixture.openThread,
  useStore: () => ({ state: fixture.state, dispatch: fixture.dispatch }),
}));
vi.mock("@/lib/live-events", async (importOriginal) => ({ ...await importOriginal<typeof import("@/lib/live-events")>(), listenLiveFrames: () => () => {} }));
vi.mock("./DesktopCapabilities", () => ({
  useCaptionChrome: () => ({ dragProps: {}, noDragStyle: undefined }),
  useDesktopCapabilities: () => ({ capabilities: { host: { platform: "darwin" }, windowChrome: "web" } }),
}));
vi.mock("@/lib/thread-preferences", () => ({ useShowThreads: () => true }));
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => fixture.admin }));
vi.mock("@/lib/session", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/session")>(),
  sessionOnce: async () => ({ kind: "session", id: "s-1", label: "phone", scopes: ["client"], expiresAt: 0, name: "Marina" }),
}));
vi.mock("./Avatar", () => ({ BotAvatar: () => null }));
const { InboxPage } = await import("./InboxPage");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
const HOUR = 3_600_000;
const atlas = { id: "atlas", name: "Atlas", threadId: "t-atlas", color: "#4f46e5", tasks: [] };

const item = (messageId: string, extra: Partial<ApprovalItem> = {}): ApprovalItem => ({
  id: approvalId("t-atlas", messageId), kind: "permission", botId: "atlas", botName: "Atlas", threadId: "t-atlas", messageId, requestId: `req-${messageId}`,
  title: `Atlas quer rodar ${messageId}`, summary: "Roda um comando no terminal", fields: [{ label: "Ação", value: "Rodar", code: "action" }, { label: "Quem decide", value: "Administradores", code: "decider" }],
  risk: "normal", requestedAt: Date.now() - 5 * 60_000, expiresAt: Date.now() + 13 * HOUR, decider: "Administradores", canDecide: true, action: "decide", ...extra,
});
const note = (id: string, extra: Partial<InboxNote> = {}): InboxNote => ({
  id, at: Date.now() - 2 * HOUR, kind: "done", botId: "atlas", botName: "Atlas", threadId: "t-atlas", title: `Aviso ${id}`, body: `Texto ${id}`, read: false, ...extra,
});

const body = () => host.textContent ?? "";
const row = (id: string) => host.querySelector<HTMLElement>(`[data-approval-item="${CSS.escape(id)}"]`);
const rowOf = (messageId: string) => row(approvalId("t-atlas", messageId))!;
const buttonIn = (scope: ParentNode, label: string) => Array.from(scope.querySelectorAll("button")).find((button) => button.textContent?.trim() === label)!;
const submit = (form: Element) => act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
const click = (element: Element) => act(async () => { element.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 })); });
const decisions = () => fixture.api.mock.calls.filter(([path, init]) => /\/(approve|decline)$/.test(String(path)) && (init as { method?: string } | undefined)?.method === "POST");

async function render() {
  await act(async () => root.render(createElement(InboxPage)));
  await act(async () => {});
}

beforeEach(() => {
  setLocale("en");
  fixture.api.mockReset();
  fixture.dispatch.mockReset();
  fixture.openThread.mockReset();
  fixture.admin = false;
  fixture.items = [];
  fixture.forYou = [];
  fixture.before = [];
  fixture.failApprovals = false;
  fixture.state = { bots: [atlas], groups: [], activeView: "inbox" };
  fixture.api.mockImplementation(async (path: string, init?: { method?: string; body?: string }) => {
    if (path === "/api/approvals") {
      if (fixture.failApprovals) throw new Error("offline");
      return { items: fixture.items };
    }
    if (path === "/api/inbox") return { waiting: fixture.items, forYou: fixture.forYou, before: fixture.before };
    if (path === "/api/approvals/settings") return { ttlMs: 24 * HOUR, minMs: 15 * 60_000, maxMs: 30 * 24 * HOUR };
    if (/^\/api\/approvals\/[^/]+\/(approve|decline)$/.test(path) && init?.method === "POST") return { ok: true };
    throw new Error(`unexpected ${path}`);
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe("the inbox page", () => {
  it("shows what waits for the person, what was sent to them and what came before", async () => {
    fixture.items = [item("m1"), item("m2", { canDecide: false, decider: "Rafael" })];
    fixture.forYou = [note("n1")];
    fixture.before = [note("n2", { read: true, resolvedAt: Date.now() - HOUR }), note("n3", { read: true })];
    await render();
    const text = body();
    expect(host.querySelector("h1")?.textContent).toBe("Inbox");
    const headings = Array.from(host.querySelectorAll("h2")).map((h2) => h2.textContent);
    expect(headings).toEqual(expect.arrayContaining(["Waiting for you", "For you", "Before"]));
    expect(text).toContain("You are Marina here");
    expect(rowOf("m1").textContent).toContain("Atlas quer rodar m1");
    expect(rowOf("m1").textContent).toMatch(/Waiting for you · expires in 13 h/);
    expect(rowOf("m1").textContent).toContain("Roda um comando no terminal");
    expect(rowOf("m1").querySelector("[data-approval-facts]")?.textContent).toContain("Who decides");
    expect(rowOf("m1").querySelector("[data-approval-facts]")?.textContent).toContain("Administrators");
    expect(rowOf("m2").textContent).toContain("Waiting for Rafael");
    expect(host.querySelector("[data-testid=inbox-for-you]")?.textContent).toContain("Aviso n1");
    expect(host.querySelector("[data-testid=inbox-before]")?.textContent).toContain("Aviso n2");
    expect(host.querySelector("[data-testid=inbox-before]")?.textContent).toContain("Resolved");
    expect(host.querySelector("[data-testid=inbox-count]")?.textContent).toContain("1");
  });

  it("says plainly when nothing waits, and nothing is new or old", async () => {
    await render();
    expect(host.querySelector("[data-testid=inbox-empty]")?.textContent).toBe("Nothing is waiting for you right now.");
    expect(body()).toContain("Nothing new for you.");
    expect(body()).toContain("Nothing here yet.");
    expect(host.querySelector("[data-testid=inbox-count]")).toBeNull();
  });

  it("says when it could not load, and tries again", async () => {
    fixture.failApprovals = true;
    await render();
    expect(host.querySelector("[role=alert]")?.textContent).toContain("Couldn't load what is waiting for you.");
    expect(host.querySelector("[data-testid=inbox-empty]")).toBeNull();
    fixture.failApprovals = false;
    fixture.items = [item("m1")];
    await click(buttonIn(host, "Try again"));
    await act(async () => {});
    expect(row(approvalId("t-atlas", "m1"))).not.toBeNull();
    expect(host.querySelector("[role=alert]")).toBeNull();
  });
});

describe("deciding from the page", () => {
  it("approves a plain request in one click and says it was sent", async () => {
    fixture.items = [item("m1")];
    await render();
    expect(rowOf("m1").querySelector("[data-hold-to-approve]")).toBeNull();
    await click(buttonIn(rowOf("m1"), "Approve"));
    expect(decisions()).toEqual([[`/api/approvals/${approvalId("t-atlas", "m1")}/approve`, { method: "POST", body: "{}" }]]);
    expect(rowOf("m1").getAttribute("data-approval-settled")).toBe("approved");
    expect(rowOf("m1").textContent).toContain("Approved by you · sent");
  });

  it("approves a critical request only by holding the button", async () => {
    vi.useFakeTimers();
    fixture.items = [item("m1", { risk: "critical", title: "Atlas quer voltar produção para a v2.14.3" })];
    await render();
    expect(buttonIn(rowOf("m1"), "Approve")).toBeUndefined();
    const hold = rowOf("m1").querySelector<HTMLButtonElement>("[data-hold-to-approve]")!;
    expect(hold.textContent).toContain("Hold to approve");
    await click(hold);
    expect(decisions()).toEqual([]);
    await act(async () => { hold.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 })); });
    await act(async () => { vi.advanceTimersByTime(HOLD_TO_APPROVE_MS - 10); });
    expect(decisions()).toEqual([]);
    await act(async () => { vi.advanceTimersByTime(10); });
    expect(decisions().map(([path]) => path)).toEqual([`/api/approvals/${approvalId("t-atlas", "m1")}/approve`]);
    expect(rowOf("m1").textContent).toContain("Approved by you · sent");
  });

  it("declines with the person's reason, which becomes a lesson", async () => {
    fixture.items = [item("m1")];
    fixture.api.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path === "/api/approvals") return { items: fixture.items };
      if (path === "/api/inbox") return { waiting: fixture.items, forYou: [], before: [] };
      if (init?.method === "POST") return { ok: true, lesson: { messageId: "l-1", requestId: "r-l" } };
      throw new Error(`unexpected ${path}`);
    });
    await render();
    await click(buttonIn(rowOf("m1"), "Decline"));
    const form = rowOf("m1").querySelector<HTMLFormElement>("[data-approval-decline]")!;
    expect(form.textContent).toContain("Why? (optional)");
    const reason = form.querySelector("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(reason, "agora não");
      reason.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await submit(form);
    expect(decisions()).toEqual([[`/api/approvals/${approvalId("t-atlas", "m1")}/decline`, { method: "POST", body: JSON.stringify({ reason: "agora não" }) }]]);
    expect(rowOf("m1").textContent).toContain("Declined by you · the reason becomes a lesson");
  });

  it("declines without a reason in two clicks, and lets the person back out", async () => {
    fixture.items = [item("m1")];
    await render();
    await click(buttonIn(rowOf("m1"), "Decline"));
    await click(buttonIn(rowOf("m1"), "Cancel"));
    expect(rowOf("m1").querySelector("[data-approval-decline]")).toBeNull();
    expect(decisions()).toEqual([]);
    await click(buttonIn(rowOf("m1"), "Decline"));
    await submit(rowOf("m1").querySelector("[data-approval-decline]")!);
    expect(decisions()).toEqual([[`/api/approvals/${approvalId("t-atlas", "m1")}/decline`, { method: "POST", body: "{}" }]]);
    expect(rowOf("m1").textContent).toContain("Declined by you");
    expect(rowOf("m1").textContent).not.toContain("lesson");
  });

  it("keeps the request and says why when the server does not take the answer", async () => {
    fixture.items = [item("m1")];
    await render();
    fixture.api.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (init?.method === "POST") throw new Error("Quem decide aqui é Rafael.");
      if (path === "/api/approvals") return { items: fixture.items };
      if (path === "/api/inbox") return { waiting: fixture.items, forYou: [], before: [] };
      throw new Error(`unexpected ${path}`);
    });
    await click(buttonIn(rowOf("m1"), "Approve"));
    expect(rowOf("m1").getAttribute("data-approval-settled")).toBeNull();
    expect(rowOf("m1").querySelector("[role=alert]")?.textContent).toBe("Quem decide aqui é Rafael.");
    expect(buttonIn(rowOf("m1"), "Approve")).toBeDefined();
  });

  it("offers nothing to decide to someone who is not the one who decides, only the conversation", async () => {
    fixture.items = [item("m2", { canDecide: false, decider: "Rafael" })];
    await render();
    expect(buttonIn(rowOf("m2"), "Approve")).toBeUndefined();
    expect(buttonIn(rowOf("m2"), "Decline")).toBeUndefined();
    expect(rowOf("m2").querySelector("[data-hold-to-approve]")).toBeNull();
    expect(buttonIn(rowOf("m2"), "Open conversation")).toBeDefined();
    expect(host.querySelector("[data-testid=inbox-count]")).toBeNull();
  });

  it("sends a request that has to be read first to its conversation", async () => {
    fixture.items = [item("s1", { kind: "skill", action: "open" })];
    await render();
    expect(buttonIn(rowOf("s1"), "Approve")).toBeUndefined();
    await click(buttonIn(rowOf("s1"), "Open to decide"));
    expect(fixture.openThread).toHaveBeenCalledWith(fixture.dispatch, { botId: "atlas", threadId: "t-atlas", requestId: "req-s1" }, fixture.state, true);
    expect(decisions()).toEqual([]);
  });
});

describe("opening the conversation", () => {
  it("lands on the card from a request, and from a notice that points at one", async () => {
    fixture.items = [item("m1")];
    fixture.forYou = [note("n1", { requestId: "req-old" })];
    fixture.before = [note("n2")];
    await render();
    await click(buttonIn(rowOf("m1"), "Open conversation"));
    expect(fixture.openThread).toHaveBeenLastCalledWith(fixture.dispatch, { botId: "atlas", threadId: "t-atlas", requestId: "req-m1" }, fixture.state, true);
    await click(host.querySelector("[data-inbox-note=n1] button")!);
    expect(fixture.openThread).toHaveBeenLastCalledWith(fixture.dispatch, { botId: "atlas", threadId: "t-atlas", requestId: "req-old" }, fixture.state, true);
    await click(host.querySelector("[data-inbox-note=n2] button")!);
    expect(fixture.openThread).toHaveBeenLastCalledWith(fixture.dispatch, { botId: "atlas", threadId: "t-atlas" }, fixture.state, true);
  });

  it("marks what is new, and shows the request's age", async () => {
    fixture.forYou = [note("n1", { read: false })];
    fixture.before = [note("n2", { read: true })];
    await render();
    expect(host.querySelector("[data-inbox-note=n1]")?.getAttribute("data-inbox-read")).toBe("false");
    expect(host.querySelector("[data-inbox-note=n1]")?.textContent).toContain("New");
    expect(host.querySelector("[data-inbox-note=n2]")?.getAttribute("data-inbox-read")).toBe("true");
    expect(host.querySelector("[data-inbox-note=n1] time")?.textContent).toMatch(/2 hours ago/);
  });
});

describe("the wait setting", () => {
  it("is offered to administrators only", async () => {
    await render();
    expect(body()).not.toContain("Requests expire after");
    expect(fixture.api).not.toHaveBeenCalledWith("/api/approvals/settings");
    fixture.admin = true;
    await render();
    await act(async () => {});
    expect(body()).toContain("Requests expire after");
    expect(body()).toContain("24 h");
  });
});
