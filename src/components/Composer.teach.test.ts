// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";

const fixture = vi.hoisted(() => ({ dispatch: vi.fn(), api: vi.fn(), advanced: false }));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return {
    ...original,
    api: fixture.api,
    useStore: () => ({ state: { ...original.initialState, bots: [bot] }, dispatch: fixture.dispatch }),
  };
});
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => true }));
vi.mock("@/lib/interface-mode", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/interface-mode")>()),
  useAdvancedMode: () => fixture.advanced,
}));
vi.mock("./CallView", () => ({ CallButton: () => null }));

import { Composer } from "./Composer";
import { readComputerPanelView } from "@/lib/computer-panel-view";

const bot: Bot = {
  id: "teach-bot", threadId: "teach-thread", name: "Programador", title: "", description: "",
  color: "blue", notifications: false, unread: false, busy: false, messages: [],
  modelSelection: { instanceId: "fake", model: "fake" },
};

const recording = {
  recording: true,
  startedAt: 1,
  threadId: "teach-thread",
  steps: [
    { n: 1, at: 1, url: "https://suporte.com/", title: "Suporte", action: { kind: "navigate", url: "https://suporte.com/" } },
    { n: 2, at: 2, url: "https://suporte.com/", title: "Suporte", action: { kind: "click", text: "Responder", role: "button", selector: "#r" } },
  ],
};

function mount(width: number): { root: Root; container: HTMLDivElement } {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: width >= 768 && query.includes("768"),
    addEventListener() {}, removeEventListener() {},
  }));
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(createElement(Composer, { bot, onEditLast: vi.fn() })));
  return { root, container };
}

async function flush() {
  await act(async () => { await Promise.resolve(); });
}

describe("Ensinar uma tarefa no compositor", () => {
  let mounted: { root: Root; container: HTMLDivElement } | null = null;
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(() => {});
    fixture.advanced = false;
    fixture.api.mockReset();
    fixture.dispatch.mockReset();
    fixture.api.mockImplementation(async (path: string) => {
      if (path === `/api/bots/${bot.id}/teach`) return { recording: false, steps: [] };
      if (path === `/api/bots/${bot.id}/teach/start`) return recording;
      return {};
    });
  });
  afterEach(() => {
    act(() => mounted?.root.unmount());
    mounted?.container.remove();
    mounted = null;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  for (const [name, width] of [["celular", 400], ["desktop", 1200]] as const) {
    it(`mostra o item no menu + do ${name}, inicia a gravação e abre o navegador`, async () => {
      mounted = mount(width);
      await flush();
      const plus = mounted.container.querySelector<HTMLElement>("[data-composer-plus]")!.closest("button")!;
      act(() => plus.click());
      const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((el) => el.textContent?.includes("Teach a task"));
      expect(item).toBeTruthy();
      expect([...document.querySelectorAll('[role="menuitem"]')].some((el) => el.textContent?.includes("Attach a file"))).toBe(true);
      await act(async () => { item!.click(); await Promise.resolve(); });
      await flush();
      expect(fixture.api).toHaveBeenCalledWith(`/api/bots/${bot.id}/teach/start`, { method: "POST", body: JSON.stringify({ threadId: bot.threadId }) });
      expect(fixture.dispatch).toHaveBeenCalledWith({ type: "toggleComputer", open: true });
      expect(readComputerPanelView(bot.id)).toBe("browser");
    });
  }

  it("no Simples a barra mostra só Gravando, Parar de gravar e os passos fechados", async () => {
    fixture.api.mockImplementation(async () => recording);
    mounted = mount(1200);
    await flush();
    const bar = mounted.container.querySelector("[data-teach-bar]")!;
    expect(bar.textContent).toContain("Recording");
    expect(bar.textContent).not.toMatch(/2 steps/);
    expect(bar.querySelector("[data-teach-stop]")).toBeTruthy();
    const details = bar.querySelector("details")!;
    expect(details.open).toBe(false);
  });

  it("no Avançado mostra o número de passos e parar chama a rota stop", async () => {
    fixture.advanced = true;
    let stopped = false;
    fixture.api.mockImplementation(async (path: string) => {
      if (path.endsWith("/stop")) { stopped = true; return { ok: true }; }
      return stopped ? { recording: false, state: "summarizing", steps: recording.steps } : recording;
    });
    mounted = mount(1200);
    await flush();
    const bar = mounted.container.querySelector("[data-teach-bar]")!;
    expect(bar.textContent).toContain("2 steps");
    await act(async () => { bar.querySelector<HTMLElement>("[data-teach-stop]")!.click(); await Promise.resolve(); });
    expect(fixture.api).toHaveBeenCalledWith(`/api/bots/${bot.id}/teach/stop`, { method: "POST", body: "{}" });
    await flush();
    expect(mounted.container.querySelector("[data-teach-summarizing]")).toBeTruthy();
  });

  it("mostra a recusa do servidor e não abre o painel", async () => {
    fixture.api.mockImplementation(async (path: string) => {
      if (path.endsWith("/start")) throw new Error("Ligue o navegador deste robô primeiro.");
      return { recording: false, steps: [] };
    });
    mounted = mount(1200);
    await flush();
    act(() => mounted!.container.querySelector<HTMLElement>("[data-composer-plus]")!.closest("button")!.click());
    const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((el) => el.textContent?.includes("Teach a task"))!;
    await act(async () => { item.click(); await Promise.resolve(); });
    await flush();
    expect(mounted.container.textContent).toContain("Ligue o navegador deste robô primeiro.");
    expect(fixture.dispatch).not.toHaveBeenCalledWith({ type: "toggleComputer", open: true });
  });
});
