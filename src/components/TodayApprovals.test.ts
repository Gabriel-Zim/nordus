// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { BotEditorStore, initialState, type useStore } from "@/state/store";
import type { ApprovalItem } from "../../shared/approvals";

const feed = vi.hoisted(() => ({ items: [] as unknown[] }));
vi.mock("@/lib/approvals-feed", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/approvals-feed")>(),
  useApprovalsFeed: () => ({ items: feed.items, loaded: true, failed: false }),
}));
const { TodayApprovals } = await import("./TodayApprovals");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root;
const dispatch = vi.fn();
const waiting = (id: string, canDecide = true): ApprovalItem => ({
  id: `t.${id}`, kind: "permission", botId: "atlas", botName: "Atlas", threadId: "t", messageId: id, title: "x", summary: "", fields: [], risk: "normal",
  requestedAt: 1, decider: "Administradores", canDecide, action: "decide",
});
async function render() {
  const store = { state: initialState, dispatch } as unknown as ReturnType<typeof useStore>;
  await act(async () => root.render(createElement(BotEditorStore, { value: store, children: createElement(TodayApprovals) })));
}

beforeEach(() => {
  setLocale("en");
  dispatch.mockReset();
  feed.items = [];
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

it("says nothing when nothing waits on the person", async () => {
  await render();
  expect(host.querySelector("[data-testid=today-approvals]")).toBeNull();
  feed.items = [waiting("a", false)];
  await render();
  expect(host.querySelector("[data-testid=today-approvals]")).toBeNull();
});

it("tells how many wait, and leads to the inbox where they are answered", async () => {
  feed.items = [waiting("a"), waiting("b"), waiting("c", false)];
  await render();
  const section = host.querySelector("[data-testid=today-approvals]")!;
  expect(section.querySelector("h2")?.textContent).toBe("Waiting for you: 2");
  expect(section.textContent).toContain("Approve or decline in your inbox.");
  await act(async () => section.querySelector("button")!.click());
  expect(dispatch).toHaveBeenCalledWith({ type: "showInbox" });
});
