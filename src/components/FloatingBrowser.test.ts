// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";

const fixture = vi.hoisted(() => ({ answer: vi.fn(async () => {}), openStage: vi.fn(), help: null as unknown, owner: undefined as symbol | undefined, casts: [] as boolean[] }));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({ state: { ...original.initialState, computerControl: { b1: { held: false, helpReason: null, help: fixture.help } } }, dispatch: vi.fn() }) };
});
vi.mock("@/lib/feature-flags", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/feature-flags")>()), builtInBrowserEnabled: () => true }));
vi.mock("@/lib/browser-stage", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/browser-stage")>()), openBrowserStage: fixture.openStage, useBrowserStageOwner: () => fixture.owner }));
vi.mock("@/lib/sign-in", () => ({ answerSignIn: fixture.answer, signInHostIsHere: () => true }));
vi.mock("./BrowserGoalCard", () => ({
  useScreencast: (_id: string, active: boolean) => { fixture.casts.push(active); return { cast: null, blocked: false }; },
  Frame: ({ onOpen, needsYou }: { onOpen?: () => void; needsYou?: boolean }) => createElement("button", { "data-testid": "frame", "data-needs": needsYou ? "1" : "", onClick: onOpen }),
}));
const { FloatingBrowser } = await import("./FloatingBrowser");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const bot = (busy: boolean, messages: unknown[]) => ({ id: "b1", threadId: "t1", name: "Pepper", busy, messages, activeLeafId: undefined } as unknown as Bot);
const browserStep = { id: "s1", role: "bot", kind: "activity", at: 1, tool: { name: "agent_browser_open", ok: true } };

afterEach(() => { try { window.localStorage.clear(); } catch {} fixture.answer.mockClear(); fixture.openStage.mockReset(); fixture.help = null; fixture.owner = undefined; fixture.casts = []; vi.unstubAllGlobals(); });

async function mount(b: Bot) {
  vi.stubGlobal("EventSource", undefined);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(createElement(FloatingBrowser, { bot: b })));
  return { host, done: () => { act(() => root.unmount()); host.remove(); } };
}

describe("FloatingBrowser", () => {
  it("shows while the bot works with its browser, even for a one-line step, and opens the stage on a tap", async () => {
    const view = await mount(bot(true, [browserStep]));
    const frame = view.host.querySelector<HTMLElement>("[data-testid=frame]")!;
    await act(async () => frame.click());
    expect(fixture.openStage).toHaveBeenCalledWith("b1");
    expect(view.host.querySelector("[data-testid=browser-float-needs-you]")).toBeNull();
    expect(fixture.casts.at(-1)).toBe(true);
    view.done();
  });

  it("is absent when the bot has not used its browser, or is idle", async () => {
    const none = await mount(bot(true, [{ id: "t", role: "bot", kind: "text", at: 1, text: "hi" }]));
    expect(none.host.querySelector("[data-testid=browser-float]")).toBeNull();
    none.done();
    const idle = await mount(bot(false, [browserStep]));
    expect(idle.host.querySelector("[data-testid=browser-float]")).toBeNull();
    idle.done();
  });

  it("hides with the small X and lets go of the connection while the stage is open", async () => {
    const view = await mount(bot(true, [browserStep]));
    await act(async () => view.host.querySelector<HTMLElement>("[data-testid=browser-float-close]")!.click());
    expect(view.host.querySelector("[data-testid=browser-float]")).toBeNull();
    view.done();
    fixture.owner = Symbol("stage");
    const open = await mount(bot(true, [browserStep]));
    expect(fixture.casts.at(-1)).toBe(false);
    open.done();
  });

  it("rings and offers Open screen when a sign-in is pending", async () => {
    fixture.help = { botId: "b1", threadId: "t1", messageId: "m", site: "x.com", place: "browser" };
    const view = await mount(bot(true, [browserStep]));
    expect(view.host.querySelector("[data-testid=frame]")!.getAttribute("data-needs")).toBe("1");
    const line = view.host.querySelector<HTMLElement>("[data-testid=browser-float-needs-you]")!;
    await act(async () => line.querySelector("button")!.click());
    expect(fixture.openStage).toHaveBeenCalledWith("b1");
    view.done();
  });

  it("has three sizes the person picks with buttons on the preview, remembered for each bot", async () => {
    const view = await mount(bot(true, [browserStep]));
    const root = () => view.host.querySelector<HTMLElement>("[data-size]")!;
    expect(root().dataset.size).toBe("normal");
    await act(async () => view.host.querySelector<HTMLElement>("[data-testid=browser-float-size]")!.click());
    expect(root().dataset.size).toBe("wide");
    expect(window.localStorage.getItem("nordus:float-size:b1")).toBe("wide");
    view.done();
    const again = await mount(bot(true, [browserStep]));
    expect(again.host.querySelector<HTMLElement>("[data-size]")!.dataset.size).toBe("wide");
    await act(async () => again.host.querySelector<HTMLElement>("[data-testid=browser-float-full]")!.click());
    expect(fixture.openStage).toHaveBeenCalledWith("b1");
    again.done();
  });

  it("is only a pill with no video connection when minimized, and a click brings the picture back", async () => {
    window.localStorage.setItem("nordus:float-size:b1", "min");
    const view = await mount(bot(true, [browserStep]));
    expect(fixture.casts.at(-1)).toBe(false);
    const pill = view.host.querySelector<HTMLElement>("[data-testid=browser-float-pill]")!;
    expect(pill.textContent).toContain("is using the browser");
    await act(async () => pill.click());
    expect(view.host.querySelector("[data-size=normal]")).not.toBeNull();
    expect(fixture.casts.at(-1)).toBe(true);
    view.done();
  });

  it("keeps a minimized pill when a sign-in waits, in orange, saying it needs the person", async () => {
    window.localStorage.setItem("nordus:float-size:b1", "min");
    fixture.help = { botId: "b1", threadId: "t1", messageId: "m", site: "x.com", place: "browser" };
    const view = await mount(bot(true, [browserStep]));
    const pill = view.host.querySelector<HTMLElement>("[data-testid=browser-float-pill]")!;
    expect(pill.dataset.needsYou).toBe("");
    expect(pill.textContent).toContain("Needs you");
    view.done();
  });

  it("says what the bot is doing, and marks the spot when the step has a position", async () => {
    const view = await mount(bot(true, [{ ...browserStep, tool: { name: "agent_browser_click", ok: true, input: '{"x":640,"y":360}' } }]));
    expect(view.host.querySelector("[data-testid=browser-float-caption]")!.textContent).toBe("Clicking");
    const ripple = view.host.querySelector<HTMLElement>("[data-testid=browser-float-ripple]")!;
    expect(ripple.style.left).toBe("50%");
    expect(ripple.style.top).toBe("50%");
    view.done();
    const fill = await mount(bot(true, [{ ...browserStep, tool: { name: "agent_browser_fill", ok: true, input: '{"selector":"#email"}' } }]));
    expect(fill.host.querySelector("[data-testid=browser-float-caption]")!.textContent).toBe("Filling in a field");
    expect(fill.host.querySelector("[data-testid=browser-float-ripple]")).toBeNull();
    fill.done();
  });

  it("answers the sign-in from the preview with Done", async () => {
    fixture.help = { botId: "b1", threadId: "t1", messageId: "m", site: "x.com", place: "browser" };
    const view = await mount(bot(true, [browserStep]));
    await act(async () => view.host.querySelector<HTMLElement>("[data-testid=browser-float-done]")!.click());
    expect(fixture.answer).toHaveBeenCalledWith(expect.objectContaining({ messageId: "m" }), "done");
    view.done();
  });
});
