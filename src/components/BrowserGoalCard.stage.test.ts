// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Message } from "@/state/store";

const fixture = vi.hoisted(() => ({ dispatch: vi.fn(), openStage: vi.fn(), help: null as unknown }));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({ state: { ...original.initialState, computerControl: { b1: { held: false, helpReason: null, help: fixture.help } } }, dispatch: fixture.dispatch }) };
});
vi.mock("@/lib/browser-stage", () => ({ openBrowserStage: fixture.openStage, useBrowserStageOwner: () => undefined, useBrowserFloat: () => false }));
const { BrowserGoalCard } = await import("./BrowserGoalCard");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const message: Message = { id: "m", role: "bot", kind: "activity", at: 1, tool: { name: "agent_browser_goal", input: '{"goal":"find a flat"}' } };

afterEach(() => { fixture.dispatch.mockReset(); fixture.openStage.mockReset(); fixture.help = null; vi.unstubAllGlobals(); });

describe("BrowserGoalCard is a compact line that opens the stage, never the side panel", () => {
  it("Take over and See screen open the stage and leave the panel shut, with no picture in the card", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ runs: [] }), { status: 200 })));
    vi.stubGlobal("EventSource", undefined);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(createElement(BrowserGoalCard, { message, threadId: "t1", botId: "b1", botName: "Pepper" })));
    expect(host.querySelector("img")).toBeNull();
    const see = host.querySelector<HTMLElement>("[data-testid=browser-goal-see-screen]")!;
    await act(async () => see.click());
    const takeOver = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Take over"))!;
    await act(async () => takeOver.click());
    expect(fixture.openStage).toHaveBeenCalledTimes(2);
    expect(fixture.openStage).toHaveBeenCalledWith("b1");
    expect(fixture.dispatch).not.toHaveBeenCalled();
    act(() => root.unmount());
    host.remove();
  });

  it("shows Needs you and Open screen on the line when the bot waits for a sign-in in its browser", async () => {
    fixture.help = { botId: "b1", threadId: "t1", messageId: "s", site: "x.com", place: "browser" };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ runs: [] }), { status: 200 })));
    vi.stubGlobal("EventSource", undefined);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(createElement(BrowserGoalCard, { message, threadId: "t1", botId: "b1", botName: "Pepper" })));
    const line = host.querySelector<HTMLElement>("[data-testid=browser-goal-needs-you]")!;
    expect(line.textContent).toContain("Needs you");
        await act(async () => line.querySelector("button")!.click());
    expect(fixture.openStage).toHaveBeenCalledWith("b1");
    act(() => root.unmount());
    host.remove();
  });
});
