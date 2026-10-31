// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import type { SidebarDensity } from "@/lib/sidebar-preferences";
import { BotEditorStore, initialState, reducer, type AppState, type useStore } from "@/state/store";
import { SidebarBoardNav } from "./SidebarFooterNav";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root;
const dispatch = vi.fn();
async function render(density: SidebarDensity, state: Partial<AppState> = {}) {
  const store = { state: { ...initialState, ...state }, dispatch } as unknown as ReturnType<typeof useStore>;
  await act(async () => root.render(createElement(BotEditorStore, { value: store, children: createElement(SidebarBoardNav, { density }) })));
}
const row = () => host.querySelector<HTMLButtonElement>('[data-sidebar-nav="board"]')!;

beforeEach(() => {
  setLocale("en");
  dispatch.mockReset();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

it.each(["comfortable", "compact", "icons"] as const)("offers Tasks in every sidebar size and opens the board (%s)", async (density) => {
  await render(density);
  if (density === "icons") expect(row().getAttribute("aria-label")).toBe("Tasks");
  else expect(row().textContent).toBe("Tasks");
  expect(row().getAttribute("aria-current")).toBeNull();
  expect(row().getAttribute("data-preload")).toBe("board");
  await act(async () => row().click());
  expect(dispatch).toHaveBeenCalledWith({ type: "showBoard" });
});

it("marks Tasks as the current page while the board is open", async () => {
  await render("comfortable", { activeView: "board" });
  expect(row().getAttribute("aria-current")).toBe("page");
});

it("opening the board closes the side panels, and choosing a bot leaves it", () => {
  const open = reducer({ ...initialState, settingsOpen: true, pluginsOpen: true }, { type: "showBoard" });
  expect(open).toMatchObject({ activeView: "board", settingsOpen: false, pluginsOpen: false });
  expect(reducer(open, { type: "showChat" }).activeView).toBe("chat");
});
