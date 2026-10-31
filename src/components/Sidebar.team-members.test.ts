// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppState, Bot, InstanceInfo, Message } from "@/state/store";
import type { SidebarDensity } from "@/lib/sidebar-preferences";

const fixture = vi.hoisted(() => ({ density: "comfortable" as SidebarDensity, advanced: false }));
vi.mock("@/lib/sidebar-preferences", async (original) => ({
  ...await original<typeof import("@/lib/sidebar-preferences")>(),
  useSidebarDensity: () => fixture.density,
  setSidebarDensity: () => {},
}));
vi.mock("@/lib/use-media-query", async (original) => ({
  ...await original<typeof import("@/lib/use-media-query")>(),
  useMediaQuery: () => true,
}));
vi.mock("@/lib/interface-mode", async (original) => ({
  ...await original<typeof import("@/lib/interface-mode")>(),
  useAdvancedMode: () => fixture.advanced,
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
const { setLocale } = await import("@/lib/i18n");
const { appUnreadCount } = await import("@/lib/team-members");

const NOW = new Date(2026, 9, 4, 12, 0).getTime();
const said = (id: string, at: number): Message => ({ id, role: "bot", kind: "text", text: `Fala ${id}`, at });
const profile = (id: string, name: string, at: number, extra: Partial<Bot> = {}): Bot => ({
  id, threadId: `${id}-thread`, name, title: "", description: "", color: "green",
  notifications: true, unread: false, busy: false, messages: [said(`${id}-m`, at)], modelSelection: { instanceId: "test", model: "m" },
  tasks: [{ threadId: `${id}-thread`, title: "Conversa", createdAt: 1, updatedAt: at }], ...extra,
});
const team = "QG DE DESIGN";
const bots = (second?: Bot): Bot[] => [
  profile("designergrafico", "DesignerGrafico", NOW - 1000, { section: team, teamLead: { allow: [], ask: [] } }),
  profile("revisor", "Revisor", NOW - 2000, { section: team }),
  profile("solo", "Solo", NOW - 3000),
  ...(second ? [second] : []),
];
let state: AppState;
let root: Root;
let dispatch = vi.fn();
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
async function draw(list: Bot[] = bots(), selectedId = "designergrafico") {
  state = {
    ...initialState, connected: true, selectedId, activeView: "chat", bots: list, groups: [],
    instances: [{ instanceId: "test", driverKind: "codex", displayName: "Test", snapshot: { state: "available" } } as InstanceInfo],
  };
  dispatch = vi.fn();
  const value = { state, dispatch, flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} };
  flushSync(() => root.render(createElement(BotEditorStore, { value, children: createElement(Sidebar, { open: true, onClose: () => {} }) })));
  await settle();
}
const rowOrder = () => [...document.querySelectorAll<HTMLElement>("[data-sidebar-bot-row]")].map((row) => row.dataset.sidebarBotRow);
const rowIds = () => [...document.querySelectorAll<HTMLElement>("[data-sidebar-bot-row]")].map((row) => row.dataset.sidebarBotRow).sort();

async function search(text: string) {
  if (!document.querySelector("[data-sidebar-search] input")) {
    document.querySelector<HTMLButtonElement>("[data-sidebar-search-toggle]")!.click();
    await settle();
  }
  const input = document.querySelector<HTMLInputElement>("[data-sidebar-search] input")!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await settle();
}

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(NOW);
  vi.stubGlobal("fetch", () => new Promise(() => {}));
  setLocale("en");
});
afterAll(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
beforeEach(() => {
  fixture.density = "comfortable";
  const container = document.createElement("div");
  document.body.replaceChildren(container);
  root = createRoot(container);
});
afterEach(() => root.unmount());

describe.each([["simple", false], ["advanced", true]] as const)("a team member under its leader in %s mode", (_mode, advanced) => {
  beforeEach(() => {
    fixture.advanced = advanced;
  });

  it("is absent from the open list, which keeps the leader and a bot without a team", async () => {
    await draw();
    expect(rowIds()).toEqual(["designergrafico", "solo"]);
  });

  it("is absent from the collapsed icon rail", async () => {
    fixture.density = "icons";
    await draw();
    expect(rowIds()).toEqual(["designergrafico", "solo"]);
  });

  it("shows every bot of a team with two leaders", async () => {
    await draw(bots(profile("segunda", "Segunda", NOW - 4000, { section: team, teamLead: { allow: [], ask: [] } })));
    expect(rowIds()).toEqual(["designergrafico", "revisor", "segunda", "solo"]);
  });

  it("is found by the search", async () => {
    await draw();
    await search("revisor");
    expect(rowIds()).toContain("revisor");
    expect(rowIds()).not.toContain("solo");
  });

  it("stays in the list while its conversation is open, and leaves once another bot is open", async () => {
    await draw(bots(), "revisor");
    expect(rowIds()).toEqual(["designergrafico", "revisor", "solo"]);
    await draw(bots(), "solo");
    expect(rowIds()).toEqual(["designergrafico", "solo"]);
  });

  it("stays out of the list while it waits, and its leader's row carries the wait and opens it", async () => {
    const list = bots();
    list[1] = { ...list[1]!, activity: "waiting-on-you", unread: true, tasks: [
      { threadId: "revisor-thread", title: "Conversa", createdAt: 1, updatedAt: NOW - 20 },
      { threadId: "revisor-pergunta", title: "Pergunta", createdAt: 2, updatedAt: NOW - 10, unread: true, activity: "waiting-on-you" },
    ] };
    await draw(list, "solo");
    expect(rowIds()).toEqual(["designergrafico", "solo"]);
    expect(appUnreadCount(list, [])).toBe(1);
    const leaderRow = document.querySelector<HTMLElement>('[data-sidebar-bot-row="designergrafico"]')!;
    expect(leaderRow.textContent).toContain("Waiting for you…");
    leaderRow.click();
    await settle();
    expect(dispatch).toHaveBeenCalledWith({ type: "switchTask", botId: "revisor", threadId: "revisor-pergunta" });
  });

  it("leaves its leader's row alone when it only has an unread conversation", async () => {
    const list = bots();
    list[1] = { ...list[1]!, unread: true, tasks: [{ threadId: "revisor-thread", title: "Conversa", createdAt: 1, updatedAt: NOW - 10, unread: true }] };
    await draw(list, "solo");
    expect(rowIds()).toEqual(["designergrafico", "solo"]);
    const leaderRow = document.querySelector<HTMLElement>('[data-sidebar-bot-row="designergrafico"]')!;
    expect(leaderRow.querySelector(".bg-unread")).toBeNull();
    expect(leaderRow.textContent).not.toContain("Waiting for you…");
    leaderRow.click();
    await settle();
    expect(dispatch.mock.calls.flat().some((action) => (action as { botId?: string; id?: string }).botId === "revisor" || (action as { id?: string }).id === "revisor")).toBe(false);
    expect(appUnreadCount(list, [])).toBe(0);
  });

  it("brings its leader to the top of the list while it waits", async () => {
    const list = bots(profile("recente", "Recente", NOW - 100));
    list[1] = { ...list[1]!, activity: "waiting-on-you", tasks: [{ threadId: "revisor-thread", title: "Conversa", createdAt: 1, updatedAt: NOW - 5000, activity: "waiting-on-you" }] };
    await draw(list, "solo");
    expect(rowOrder()[0]).toBe("designergrafico");
  });

  it("shows no approval badge on its leader's rail icon when it only has an unread conversation", async () => {
    fixture.density = "icons";
    const list = bots();
    list[1] = { ...list[1]!, unread: true, tasks: [{ threadId: "revisor-thread", title: "Conversa", createdAt: 1, updatedAt: NOW - 10, unread: true }] };
    await draw(list, "solo");
    expect(document.querySelector('[data-sidebar-bot-row="designergrafico"]')?.parentElement?.querySelector("[data-rail-approval-badge]")).toBeNull();
  });

  it("lights a Chief leader at the top while its own side conversation waits, and opens that conversation", async () => {
    const list = bots();
    list[0] = { ...list[0]!, chiefOfStaff: true, activity: "idle", tasks: [
      { threadId: "designergrafico-thread", title: "Conversa", createdAt: 1 },
      { threadId: "designergrafico-pedido", title: "Pedido do Revisor", createdAt: 2, activity: "waiting-on-you" },
    ] };
    await draw(list, "solo");
    const hero = document.querySelector<HTMLElement>('[data-pinned-hero-bot="designergrafico"]')!;
    expect(hero.querySelector<HTMLElement>("[data-estado]")?.dataset.estado).toBe("alerta");
    hero.click();
    await settle();
    expect(dispatch).toHaveBeenCalledWith({ type: "switchTask", botId: "designergrafico", threadId: "designergrafico-pedido" });
  });

  it("keeps a member's unread and running work out of the activity list, and keeps its wait", async () => {
    fixture.advanced = true;
    const list = bots();
    list[1] = { ...list[1]!, tasks: [
      { threadId: "revisor-thread", title: "Conversa", createdAt: 1, unread: true },
      { threadId: "revisor-lamina", title: "Lâmina 2", createdAt: 2, busy: true, activity: "working" },
      { threadId: "revisor-pergunta", title: "Pergunta", createdAt: 3, activity: "waiting-on-you" },
    ] };
    await draw(list, "solo");
    const { attentionForPerson } = await import("@/lib/team-members");
    const { crossBotAttentionThreads } = await import("./SidebarBotActivity");
    const shown = attentionForPerson(crossBotAttentionThreads(list, {}, undefined, []), list, "solo").map((entry) => entry.task.threadId);
    expect(shown).toContain("revisor-pergunta");
    expect(shown).not.toContain("revisor-thread");
    expect(shown).not.toContain("revisor-lamina");
  });

  it("puts its idle leader to work with its own step while it works", async () => {
    const list = bots();
    list[1] = { ...list[1]!, busy: true, tasks: [{ threadId: "revisor-lamina", title: "Lâmina 2", createdAt: 2, updatedAt: NOW - 10, busy: true, activity: "working", doing: "Revisando a lâmina 2" }] };
    await draw(list, "solo");
    expect(rowIds()).toEqual(["designergrafico", "solo"]);
    const step = document.querySelector<HTMLElement>('[data-sidebar-bot-row="designergrafico"] [data-bot-step]');
    expect(step?.textContent).toBe("Revisor: revisando a lâmina 2");
    expect(step?.title).toBe("Revisor · Lâmina 2: revisando a lâmina 2");
  });

  it("puts its leader to work with its step while the leader only runs a routine", async () => {
    const list = bots();
    list[0] = { ...list[0]!, tasks: [{ threadId: "designergrafico-run", title: "Rotina", createdAt: 1, busy: true, activity: "working", routineRunId: "run" }] };
    list[1] = { ...list[1]!, busy: true, tasks: [{ threadId: "revisor-lamina", title: "Lâmina 2", createdAt: 2, updatedAt: NOW - 10, busy: true, activity: "working", doing: "Revisando a lâmina 2" }] };
    await draw(list, "solo");
    expect(document.querySelector('[data-sidebar-bot-row="designergrafico"] [data-bot-step]')?.textContent).toBe("Revisor: revisando a lâmina 2");
  });

  it("shows the most recent working member and how many more, apart so the count is never cut", async () => {
    const list = bots(profile("designer", "Designer", NOW - 4000, { section: team, busy: true,
      tasks: [{ threadId: "designer-carrossel", title: "Carrossel", createdAt: 1, busy: true, activity: "working", doing: "Analisando o briefing", turnStartedAt: NOW - 60_000 }] }));
    list[1] = { ...list[1]!, busy: true, tasks: [{ threadId: "revisor-lamina", title: "Lâmina 2", createdAt: 2, busy: true, activity: "working", doing: "Revisando a lâmina 2", turnStartedAt: NOW - 1_000 }] };
    await draw(list, "solo");
    expect(document.querySelector('[data-sidebar-bot-row="designergrafico"] [data-bot-step]')?.textContent).toBe("Revisor: revisando a lâmina 2");
    expect(document.querySelector('[data-sidebar-bot-row="designergrafico"] [data-team-others]')?.textContent).toBe("+1");
  });

  it("lets a working leader show its own step over its member's", async () => {
    const list = bots();
    list[0] = { ...list[0]!, busy: true, tasks: [{ threadId: "designergrafico-thread", title: "Conversa", createdAt: 1, updatedAt: NOW - 10, busy: true, activity: "working", doing: "Montando o briefing" }] };
    list[1] = { ...list[1]!, busy: true, tasks: [{ threadId: "revisor-lamina", title: "Lâmina 2", createdAt: 2, updatedAt: NOW - 10, busy: true, activity: "working", doing: "Revisando a lâmina 2" }] };
    await draw(list, "solo");
    expect(document.querySelector('[data-sidebar-bot-row="designergrafico"] [data-bot-step]')?.textContent).toBe("Montando o briefing");
  });

  it("shows the wait, not the work, when one member waits and another works", async () => {
    const list = bots(profile("designer", "Designer", NOW - 4000, { section: team, busy: true,
      tasks: [{ threadId: "designer-carrossel", title: "Carrossel", createdAt: 1, busy: true, activity: "working", doing: "Analisando o briefing" }] }));
    list[1] = { ...list[1]!, tasks: [{ threadId: "revisor-pergunta", title: "Pergunta", createdAt: 2, updatedAt: NOW - 10, activity: "waiting-on-you" }] };
    await draw(list, "solo");
    const row = document.querySelector('[data-sidebar-bot-row="designergrafico"]')!;
    expect(row.textContent).toContain("Waiting for you…");
    expect(row.querySelector("[data-bot-step]")).toBeNull();
  });

  it("puts a Chief leader at the top to work while its member works", async () => {
    const list = bots();
    list[0] = { ...list[0]!, chiefOfStaff: true };
    list[1] = { ...list[1]!, busy: true, tasks: [{ threadId: "revisor-lamina", title: "Lâmina 2", createdAt: 2, busy: true, activity: "working", doing: "Revisando a lâmina 2" }] };
    await draw(list, "solo");
    expect(document.querySelector<HTMLElement>('[data-pinned-hero-bot="designergrafico"] [data-estado]')?.dataset.estado).toBe("trabalhando");
    expect(document.querySelector('[data-pinned-hero-bot="designergrafico"] [data-hero-step]')?.textContent).toBe("Revisor: revisando a lâmina 2");
  });

  it("keeps the member's line off a Chief leader at the top that works in a side conversation of its own", async () => {
    const list = bots();
    list[0] = { ...list[0]!, chiefOfStaff: true, busy: false, tasks: [
      { threadId: "designergrafico-thread", title: "Conversa", createdAt: 1 },
      { threadId: "designergrafico-lateral", title: "Lateral", createdAt: 2, busy: true, activity: "working", doing: "Montando o briefing" },
    ] };
    list[1] = { ...list[1]!, busy: true, tasks: [{ threadId: "revisor-lamina", title: "Lâmina 2", createdAt: 2, busy: true, activity: "working", doing: "Revisando a lâmina 2" }] };
    await draw(list, "solo");
    expect(document.querySelector('[data-pinned-hero-bot="designergrafico"] [data-hero-step]')).toBeNull();
    expect(document.querySelector<HTMLElement>('[data-pinned-hero-bot="designergrafico"]')?.title).toBe("");
  });

  it.each([["pinned", { pinned: true }], ["the Chief", { chiefOfStaff: true }]] as const)("carries its wait to a leader that is %s, at the top", async (_kind, extra) => {
    const list = bots();
    list[0] = { ...list[0]!, ...extra };
    list[1] = { ...list[1]!, activity: "waiting-on-you", tasks: [
      { threadId: "revisor-thread", title: "Conversa", createdAt: 1 },
      { threadId: "revisor-pergunta", title: "Pergunta", createdAt: 2, activity: "waiting-on-you" },
    ] };
    await draw(list, "solo");
    document.querySelector<HTMLElement>('[data-pinned-hero-bot="designergrafico"]')!.click();
    await settle();
    expect(dispatch).toHaveBeenCalledWith({ type: "switchTask", botId: "revisor", threadId: "revisor-pergunta" });
  });
});
