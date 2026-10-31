// @vitest-environment happy-dom
import { act, createElement, type SetStateAction } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  dispatch: vi.fn(),
  updates: vi.fn(),
  renders: vi.fn(),
  state: { loadingOlder: {}, olderFailed: {}, focusMessage: null },
}));

vi.mock("react", async (importOriginal) => {
  const original = await importOriginal<typeof import("react")>();
  return {
    ...original,
    useState: <T,>(initial: T | (() => T)) => {
      const [value, update] = original.useState(initial);
      return [value, (next: SetStateAction<T>) => { fixture.updates(); update(next); }] as const;
    },
  };
});
vi.mock("@/state/store", () => ({ useStore: () => fixture }));

import { useTranscriptViewport } from "./use-transcript-viewport";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

it("unmounts the real React hook without later dispatches or state updates", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const disconnect = vi.fn();
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    disconnect = disconnect;
  });
  const scrollTo = vi.fn();
  vi.spyOn(HTMLElement.prototype, "scrollTo").mockImplementation(scrollTo);
  const added = vi.spyOn(window, "addEventListener");
  const removed = vi.spyOn(window, "removeEventListener");
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  function Probe() {
    fixture.renders();
    const view = useTranscriptViewport({
      ownerId: "bot", threadId: "thread", messages: [{ id: "m1" }], pinOn: [], hasMore: true,
    });
    return createElement("div", { ref: view.scrollRef }, createElement("div", { ref: view.transcriptRef }));
  }
  try {
    await act(async () => root.render(createElement(Probe)));
    expect(fixture.dispatch).toHaveBeenCalledExactlyOnceWith({ type: "loadOlderMessages", threadId: "thread" });
    const keyHandler = added.mock.calls.find(([name]) => name === "keydown")?.[1];
    expect(keyHandler).toBeTypeOf("function");
    await act(async () => root.unmount());
    expect(disconnect).toHaveBeenCalledOnce();
    expect(removed).toHaveBeenCalledWith("keydown", keyHandler);
    fixture.dispatch.mockClear();
    fixture.updates.mockClear();
    fixture.renders.mockClear();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "PageUp" }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(fixture.dispatch).not.toHaveBeenCalled();
    expect(fixture.updates).not.toHaveBeenCalled();
    expect(fixture.renders).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
