// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fixture = vi.hoisted(() => ({
  admin: true,
  state: {} as Record<string, unknown>,
  dispatch: vi.fn(),
  api: vi.fn(async () => ({ onboarding: { hintsSeen: ["getting-started"] } })),
  openBot: vi.fn(),
}));
vi.mock("@/state/store", () => ({
  api: fixture.api,
  openBot: fixture.openBot,
  useStore: () => ({ state: fixture.state, dispatch: fixture.dispatch }),
}));
vi.mock("@/lib/use-viewer", () => ({ useViewer: () => ({ admin: fixture.admin, guest: false }) }));
vi.mock("@/lib/thread-preferences", () => ({ useShowThreads: () => false }));
vi.mock("./connected-apps", () => ({ preloadConnectedApps: async () => ({ services: {}, authoritative: true }) }));

const { SidebarGettingStarted } = await import("./SidebarGettingStarted");

let host: HTMLDivElement;
let root: Root;

const render = async () => {
  await act(async () => root.render(createElement(SidebarGettingStarted)));
};

beforeEach(() => {
  setLocale("pt-br");
  fixture.admin = true;
  fixture.dispatch.mockClear();
  fixture.api.mockClear();
  fixture.state = {
    config: { onboarding: { completedAt: "x", version: 1, reelSeen: true, hintsSeen: [] } },
    instances: [{ snapshot: { state: "available" } }],
    bots: [{ id: "ana", name: "Ana", tasks: [{ threadId: "t", createdAt: 1 }] }],
    routines: [],
    selectedId: "ana",
  };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  setLocale("en");
});

const step = (id: string) => host.querySelector<HTMLButtonElement>(`[data-step="${id}"]`)!;

describe("the getting started list in the sidebar", () => {
  it("shows the progress and ticks what is already done", async () => {
    await render();
    expect(host.textContent).toContain("Primeiros passos");
    expect(host.textContent).toContain("2 de 5");
    expect(step("engine").disabled).toBe(true);
    expect(step("bot").disabled).toBe(true);
    expect(step("ask").disabled).toBe(false);
  });

  it("takes the person straight to each open step", async () => {
    await render();
    act(() => step("ask").click());
    expect(fixture.openBot).toHaveBeenCalledWith(fixture.dispatch, expect.objectContaining({ id: "ana" }), false);
    act(() => step("app").click());
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "togglePlugins", open: true, surface: "apps" });
    act(() => step("routine").click());
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "showRoutines" });
  });

  it("hides for good once the person closes it", async () => {
    await render();
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Esconder os primeiros passos"]')!.click());
    expect(host.querySelector("[data-sidebar-getting-started]")).toBeNull();
    expect(fixture.api).toHaveBeenCalledWith("/api/config", { method: "PUT", body: JSON.stringify({ onboarding: { hintsSeen: ["getting-started"] } }) });
  });

  it("stays away from members who cannot change the workspace", async () => {
    fixture.admin = false;
    await render();
    expect(host.querySelector("[data-sidebar-getting-started]")).toBeNull();
  });
});
