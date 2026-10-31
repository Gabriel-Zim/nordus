// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Message } from "@/state/store";

vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({ state: { ...original.initialState }, dispatch: vi.fn() }) };
});
vi.mock("@/lib/browser-stage", () => ({ openBrowserStage: vi.fn(), useBrowserStageOwner: () => undefined, useBrowserFloat: () => false }));
const { BrowserGoalCard, useScreencast } = await import("./BrowserGoalCard");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

const run = (n: number, ended: boolean) => ({ id: `run${n}`, goal: `goal ${n}`, startedAt: n * 1000, endedAt: ended ? n * 1000 + 500 : null, status: ended ? "done" : "running", steps: [], url: "", botId: "b1", botName: "P" });
const card = (n: number, ok?: boolean): Message => ({ id: `m${n}`, role: "bot", kind: "activity", at: n * 1000, tool: { name: "agent_browser_goal", input: JSON.stringify({ goal: `goal ${n}` }), ...(ok === undefined ? {} : { ok }) } });

describe("BrowserGoalCard polling", () => {
  it("asks about the active run about once a second and never again about ended ones, even while the turn is busy", async () => {
    vi.useFakeTimers();
    const runs = [run(1, true), run(2, true), run(3, true), run(4, true), run(5, true), run(6, false)];
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ runs }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("EventSource", undefined);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(createElement("div", null, [1, 2, 3, 4, 5].map((n) => createElement(BrowserGoalCard, { key: n, message: card(n, true), threadId: "t-poll", botId: "b1", botName: "P", turnBusy: true })), createElement(BrowserGoalCard, { key: 6, message: card(6), threadId: "t-poll", botId: "b1", botName: "P", turnBusy: true }))));
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(12);
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(5);
    act(() => root.unmount());
    host.remove();
  });

  it("slows down on 429 instead of hammering", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => new Response("slow down", { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("EventSource", undefined);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(createElement(BrowserGoalCard, { message: card(7), threadId: "t-429", botId: "b1", botName: "P", turnBusy: true })));
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(5);
    act(() => root.unmount());
    host.remove();
  });

  it("says the screen is open elsewhere when the live stream is refused, and retries slowly", async () => {
    vi.useFakeTimers();
    const opened: string[] = [];
    class RefusedStream {
      constructor(url: string) { opened.push(url); }
      addEventListener(name: string, handler: () => void) { if (name === "error") setTimeout(handler, 0); }
      close() {}
    }
    vi.stubGlobal("EventSource", RefusedStream);
    const View = () => { const { blocked } = useScreencast("b1", true); return createElement("p", null, blocked ? "refused" : "opening"); };
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(createElement(View)));
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(host.textContent).toContain("refused");
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(opened.length).toBeLessThanOrEqual(5);
    expect(opened.length).toBeGreaterThanOrEqual(2);
    act(() => root.unmount());
    host.remove();
  });
});
