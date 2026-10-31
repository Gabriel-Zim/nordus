// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppState, Bot, Group, InstanceInfo, Message } from "@/state/store";
import type { SidebarDensity } from "@/lib/sidebar-preferences";

const fixture = vi.hoisted(() => ({ density: "icons" as SidebarDensity, desktop: true, chosen: [] as SidebarDensity[] }));
vi.mock("@/lib/sidebar-preferences", async (original) => ({
  ...await original<typeof import("@/lib/sidebar-preferences")>(),
  useSidebarDensity: () => fixture.density,
  setSidebarDensity: (density: SidebarDensity) => { fixture.chosen.push(density); },
}));
vi.mock("@/lib/use-media-query", async (original) => ({
  ...await original<typeof import("@/lib/use-media-query")>(),
  useMediaQuery: () => fixture.desktop,
}));
vi.mock("@/lib/interface-mode", async (original) => ({
  ...await original<typeof import("@/lib/interface-mode")>(),
  useAdvancedMode: () => true,
}));
vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: { dictation: { available: false }, host: { packaged: true, platform: "other" }, localComputer: { available: false } }, ready: true }),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/cloud-guest", () => ({ useCanWriteIn: () => true, useReactor: () => "user" }));
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => true }));

const { Sidebar } = await import("./Sidebar");
const { BotEditorStore, initialState } = await import("@/state/store");
const { setLocale, t } = await import("@/lib/i18n");
const { SIDEBAR_RESIZE_HANDLE_CLASS } = await import("@/lib/sidebar-rail");

const NOW = new Date(2026, 9, 4, 12, 0).getTime();
const said = (id: string, at: number): Message => ({ id, role: "bot", kind: "text", text: `Fala ${id}`, at });
const profile = (id: string, name: string, at: number, extra: Partial<Bot> = {}): Bot => ({
  id, threadId: `${id}-thread`, name, title: "", description: "", color: "green",
  notifications: true, unread: false, busy: false, messages: [said(`${id}-m`, at)], modelSelection: { instanceId: "test", model: "m" },
  tasks: [{ threadId: `${id}-thread`, title: "Conversa", createdAt: 1, updatedAt: at, lastThreadOrderAt: at }], ...extra,
});
const room: Group = {
  id: "equipe", threadId: "equipe-thread", name: "Equipe", memberIds: ["luna", "teo"], defaultResponder: "all", bulletin: "",
  unread: false, createdAt: 1, messages: [said("equipe-m", NOW - 500)],
} as unknown as Group;
const state: AppState = {
  ...initialState,
  connected: true,
  selectedId: "luna",
  activeView: "chat",
  bots: [
    profile("luna", "Luna", NOW - 1000),
    profile("boss", "Chefe", NOW - 3000, { chiefOfStaff: true }),
    profile("teo", "Teo", NOW - 2000),
  ],
  groups: [room],
  instances: [{ instanceId: "test", driverKind: "codex", displayName: "Test", snapshot: { state: "available" } } as InstanceInfo],
};

let root: Root;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
async function draw(props: { collapseToIcons?: boolean } = {}) {
  const value = { state, dispatch: vi.fn(), flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} };
  flushSync(() => root.render(createElement(BotEditorStore, { value, children: createElement(Sidebar, { open: true, onClose: () => {}, ...props }) })));
  await settle();
  return value.dispatch;
}
const rowIds = () => [...document.querySelectorAll<HTMLElement>("[data-sidebar-bot-row],[data-sidebar-group-row]")]
  .map((row) => row.dataset.sidebarBotRow ?? row.dataset.sidebarGroupRow);

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(NOW);
  vi.stubGlobal("fetch", () => new Promise(() => {}));
  setLocale("en");
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterAll(() => {
  root.unmount();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
beforeEach(() => {
  fixture.density = "icons";
  fixture.desktop = true;
  fixture.chosen = [];
});
afterEach(() => { setLocale("en"); });

describe("the collapsed avatar rail", () => {
  it("marks a bot whose conversation waits for an approval and answers it from the hover card", async () => {
    const teo = state.bots.find((bot) => bot.id === "teo")!;
    const original = teo.messages;
    teo.activity = "waiting-on-you";
    teo.messages = [...original, {
      id: "ask", role: "bot", kind: "options", at: NOW,
      card: { title: "Approval needed", subtitle: "rm -rf build", options: ["Allow", "Deny"], requestId: "r1", tool: "Bash" },
    } as Message];
    try {
      await draw();
      const row = document.querySelector<HTMLElement>('[data-sidebar-bot-row="teo"]')!;
      expect(row.parentElement!.querySelector("[data-rail-approval-badge]")).not.toBeNull();
      expect(document.querySelector('[data-sidebar-bot-row="luna"]')!.parentElement!.querySelector("[data-rail-approval-badge]")).toBeNull();
      row.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 20));
      await settle();
      const card = document.querySelector("[data-rail-approval]");
      expect(card).not.toBeNull();
      expect(card!.textContent).not.toContain("rm -rf");
      expect(card!.querySelectorAll("button").length).toBeGreaterThanOrEqual(3);
      expect(document.querySelector('[data-sidebar-rail-card] [role="dialog"]')).not.toBeNull();
    } finally {
      teo.messages = original;
      teo.activity = undefined;
    }
  });

  it.each([
    ["offers the task release from the hover card when the card carries it", { subtitle: "pnpm build" }, ["Allow once", "Allow everything in this task", "Deny", "See details"]],
    ["offers no release around the hold on a critical action", { subtitle: "git push", heldCode: "approval.held.sensitive" }, ["Hold to approve", "Deny", "See details"]],
  ])("%s", async (_name, extra, expected) => {
    const teo = state.bots.find((bot) => bot.id === "teo")!;
    const original = teo.messages;
    teo.activity = "waiting-on-you";
    teo.messages = [...original, {
      id: "ask", role: "bot", kind: "options", at: NOW,
      card: { title: "Approval needed", options: ["Allow", "Deny"], requestId: "r1", tool: "Bash", canReleaseTask: true, ...extra },
    } as Message];
    try {
      await draw();
      const row = document.querySelector<HTMLElement>('[data-sidebar-bot-row="teo"]')!;
      row.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 20));
      await settle();
      const card = document.querySelector("[data-rail-approval]")!;
      const labels = [...card.querySelectorAll("button")].map((button) => button.textContent);
      expect(labels).toEqual(expected);
    } finally {
      teo.messages = original;
      teo.activity = undefined;
    }
  });

  it("in the open list, drops the alert line under a waiting bot and answers its approval from the row's hover card", async () => {
    fixture.density = "comfortable";
    const teo = state.bots.find((bot) => bot.id === "teo")!;
    const original = teo.messages;
    teo.activity = "waiting-on-you";
    teo.messages = [...original, {
      id: "ask", role: "bot", kind: "options", at: NOW,
      card: { title: "Approval needed", subtitle: "rm -rf build", options: ["Allow", "Deny"], requestId: "r1", tool: "Bash" },
    } as Message];
    try {
      await draw();
      expect(document.querySelector("[data-sidebar-bot-activity]")).toBeNull();
      const row = document.querySelector<HTMLElement>('[data-sidebar-bot-row="teo"]')!;
      row.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 20));
      await settle();
      const card = document.querySelector("[data-rail-approval]");
      expect(card).not.toBeNull();
      expect(card!.textContent).toContain("Allow once");
      expect(card!.textContent).not.toContain("rm -rf");
      document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      await settle();
      expect(document.querySelector("[data-sidebar-rail-card]")).toBeNull();
      row.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      row.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 20));
      await settle();
      const luna = document.querySelector<HTMLElement>('[data-sidebar-bot-row="luna"]')!;
      row.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      luna.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 20));
      await settle();
      expect(document.querySelector("[data-sidebar-rail-card]")).toBeNull();
    } finally {
      teo.messages = original;
      teo.activity = undefined;
    }
  });

  it("opens the thread that waits for the person when the waiting bot is clicked", async () => {
    fixture.density = "comfortable";
    const teo = state.bots.find((bot) => bot.id === "teo")!;
    const original = teo.tasks;
    teo.tasks = [...original!, { threadId: "teo-pedido", title: "Lamina", createdAt: 2, updatedAt: NOW, activity: "waiting-on-you" }];
    try {
      const dispatch = await draw();
      const row = document.querySelector<HTMLElement>('[data-sidebar-bot-row="teo"]')!;
      row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      expect(dispatch).toHaveBeenCalledWith({ type: "switchTask", botId: "teo", threadId: "teo-pedido" });
      dispatch.mockClear();
      row.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      expect(dispatch).toHaveBeenCalledWith({ type: "switchTask", botId: "teo", threadId: "teo-pedido" });
    } finally {
      teo.tasks = original;
    }
  });

  it("puts the Boss alone in a tile at the top, above a divider, and never repeats it in the list", async () => {
    await draw();
    const tile = document.querySelector("[data-sidebar-rail-boss]")!;
    expect(tile).not.toBeNull();
    expect([...tile.querySelectorAll("[data-sidebar-bot-row],[data-sidebar-group-row]")].length).toBe(1);
    expect(tile.querySelector('[data-sidebar-bot-row="boss"]')).not.toBeNull();
    expect(tile.querySelector("[class*='bg-white/[0.05]']")).not.toBeNull();
    expect(tile.querySelector("[aria-hidden='true'][class*='h-px']")).not.toBeNull();
    expect(document.querySelectorAll('[data-sidebar-bot-row="boss"]').length).toBe(1);
  });

  it("lists bots and rooms after the Boss in the same order as the expanded flat list", async () => {
    await draw();
    const rail = rowIds();
    fixture.density = "comfortable";
    await draw();
    // Expanded, the Boss is the highlight above the list instead of a row.
    expect(rowIds()).toEqual(["equipe", "luna", "teo"]);
    expect(rail).toEqual(["boss", ...rowIds()]);
    expect(document.querySelector("[data-sidebar-rail-boss]")).toBeNull();
  });

  it("draws a room as the members' mosaic", async () => {
    await draw();
    expect(document.querySelector('[data-sidebar-group-row="equipe"] [data-room-mosaic]')).not.toBeNull();
  });

  it("ends in New, Apps and the profile avatar, as glass pills", async () => {
    await draw();
    const foot = document.querySelector("[data-sidebar-rail-foot]")!;
    const pills = [...foot.querySelectorAll("button, [data-profile-avatar]")];
    const buttons = [...foot.querySelectorAll("button")];
    expect(buttons[0]!.getAttribute("aria-label")).toBe(t("sidebar.newOrShare"));
    expect(foot.querySelector('[data-sidebar-nav="apps"]')).not.toBeNull();
    expect(foot.querySelector("[data-profile-avatar]")).not.toBeNull();
    expect(pills.length).toBeGreaterThanOrEqual(3);
    for (const pill of [buttons[0]!, foot.querySelector('[data-sidebar-nav="apps"]')!, foot.querySelector("[data-profile-avatar]")!]) {
      expect(pill.className).toContain("nb-pill");
    }
    expect(document.querySelectorAll('aside [aria-label="' + t("sidebar.newOrShare") + '"]').length).toBe(1);
  });

  it("keeps the divider handle on the rail and the list, neutral in both", async () => {
    for (const density of ["icons", "comfortable"] as const) {
      fixture.density = density;
      await draw();
      const handle = document.querySelector("[data-sidebar-resize]")!;
      expect(handle).not.toBeNull();
      expect(handle.className).toBe(SIDEBAR_RESIZE_HANDLE_CLASS);
      expect(handle.className).not.toMatch(/accent/);
    }
  });

  it("expands from the divider with the keyboard", async () => {
    await draw();
    const handle = document.querySelector<HTMLElement>("[data-sidebar-resize]")!;
    handle.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(fixture.chosen).toEqual(["comfortable"]);
  });

  it("has no divider while side panels force the rail", async () => {
    await draw({ collapseToIcons: true });
    expect(document.querySelector("[data-sidebar-resize]")).toBeNull();
    expect(document.querySelector("[data-sidebar-rail-boss]")).not.toBeNull();
  });
});

describe("collapsing from the keyboard", () => {
  const press = (init: KeyboardEventInit) => window.dispatchEvent(new KeyboardEvent("keydown", { key: "\\", bubbles: true, cancelable: true, ...init }));

  it("collapses with Cmd+\\ and expands again with Ctrl+\\", async () => {
    fixture.density = "comfortable";
    await draw();
    press({ metaKey: true });
    expect(fixture.chosen).toEqual(["icons"]);
    fixture.density = "icons";
    await draw();
    press({ ctrlKey: true });
    expect(fixture.chosen).toEqual(["icons", "comfortable"]);
  });

  it("ignores a bare backslash", async () => {
    await draw();
    press({});
    expect(fixture.chosen).toEqual([]);
  });

  it("does not touch the stored choice while side panels force the rail", async () => {
    fixture.density = "comfortable";
    await draw({ collapseToIcons: true });
    press({ metaKey: true });
    expect(fixture.chosen).toEqual([]);
  });

  it("does nothing on a phone", async () => {
    fixture.desktop = false;
    fixture.density = "comfortable";
    await draw();
    press({ metaKey: true });
    expect(fixture.chosen).toEqual([]);
  });
});

describe("on a phone", () => {
  it("ignores the stored rail and draws the full list", async () => {
    fixture.desktop = false;
    fixture.density = "icons";
    await draw();
    expect(document.querySelector("[data-sidebar-rail-boss]")).toBeNull();
    expect(document.querySelector("[data-sidebar-rail-foot]")).toBeNull();
    const aside = document.querySelector("aside")!;
    expect(aside.className).toContain("w-[320px]");
    expect(aside.className).not.toContain("w-[80px]");
    expect(document.querySelector('[data-sidebar-bot-row="luna"] .nb-name')).not.toBeNull();
  });
});
