// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import type { SidebarDensity } from "@/lib/sidebar-preferences";
import { BotEditorStore, initialState, reducer, type AppState, type useStore } from "@/state/store";
import type { ApprovalItem } from "../../shared/approvals";

const feed = vi.hoisted(() => ({ items: [] as unknown[] }));
vi.mock("@/lib/approvals-feed", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/approvals-feed")>(),
  useApprovalsFeed: () => ({ items: feed.items, loaded: true, failed: false }),
}));
const { SidebarInboxNav } = await import("./SidebarInboxNav");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root;
const dispatch = vi.fn();
const waiting = (id: string, canDecide = true): ApprovalItem => ({
  id: `t.${id}`, kind: "permission", botId: "atlas", botName: "Atlas", threadId: "t", messageId: id, title: "x", summary: "", fields: [], risk: "normal",
  requestedAt: 1, decider: "Administradores", canDecide, action: "decide",
});

async function render(density: SidebarDensity, state: Partial<AppState> = {}, inline = false) {
  const store = { state: { ...initialState, ...state }, dispatch } as unknown as ReturnType<typeof useStore>;
  await act(async () => root.render(createElement(BotEditorStore, { value: store, children: createElement(SidebarInboxNav, { density, inline }) })));
}
const entry = () => host.querySelector<HTMLButtonElement>('[data-sidebar-nav="inbox"]');
const badge = () => host.querySelector('[data-testid="inbox-badge"]');

beforeEach(() => {
  setLocale("en");
  dispatch.mockReset();
  feed.items = [];
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

it("offers the inbox on the rail and on the list's top row, and opens the page", async () => {
  await render("icons");
  expect(entry()!.getAttribute("aria-label")).toBe("Inbox");
  await act(async () => entry()!.click());
  expect(dispatch).toHaveBeenCalledWith({ type: "showInbox" });
  await render("comfortable", {}, true);
  expect(entry()!.getAttribute("title")).toBe("Inbox");
  expect(entry()!.getAttribute("data-preload")).toBe("inbox");
  dispatch.mockReset();
  await act(async () => entry()!.click());
  expect(dispatch).toHaveBeenCalledWith({ type: "showInbox" });
});

it("takes no room on the list unless it is the top row's icon", async () => {
  await render("comfortable");
  expect(entry()).toBeNull();
  await render("compact");
  expect(entry()).toBeNull();
});

it("counts the requests this person may decide, and no more", async () => {
  feed.items = [waiting("a"), waiting("b", false), waiting("c")];
  await render("icons");
  expect(badge()?.textContent).toBe("2");
  expect(entry()!.getAttribute("aria-label")).toBe("Inbox: 2 waiting for you");
  expect(entry()!.dataset.waiting).toBe("2");
});

it("shows no badge when nothing waits, or when what waits is for someone else", async () => {
  await render("icons");
  expect(badge()).toBeNull();
  feed.items = [waiting("a", false)];
  await render("icons");
  expect(badge()).toBeNull();
  expect(entry()!.getAttribute("aria-label")).toBe("Inbox");
});

it("caps a long count", async () => {
  feed.items = Array.from({ length: 14 }, (_, index) => waiting(`m${index}`));
  await render("icons");
  expect(badge()?.textContent).toBe("9+");
  expect(entry()!.getAttribute("aria-label")).toBe("Inbox: 14 waiting for you");
});

it("marks the inbox as the current page while it is open", async () => {
  await render("icons", { activeView: "inbox" });
  expect(entry()!.getAttribute("aria-current")).toBe("page");
  await render("icons", { activeView: "chat" });
  expect(entry()!.getAttribute("aria-current")).toBeNull();
});

it("opening the inbox closes the side panels, and choosing a bot leaves it", () => {
  const open = reducer({ ...initialState, settingsOpen: true, pluginsOpen: true }, { type: "showInbox" });
  expect(open).toMatchObject({ activeView: "inbox", settingsOpen: false, pluginsOpen: false });
  expect(reducer(open, { type: "showChat" }).activeView).toBe("chat");
  expect(reducer(open, { type: "showToday" }).activeView).toBe("today");
});
