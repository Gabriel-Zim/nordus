// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { copyText } from "@/lib/copy-text";
import { showToast, TOAST_MS } from "@/lib/toast";
import { ToastHost } from "./ToastHost";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  setLocale("pt-br");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(createElement(ToastHost)));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  setLocale("en");
});

const live = () => host.querySelector('[role="status"][aria-live="polite"]')!;

describe("toasts", () => {
  it("shows a short message in a polite live region and takes it away by itself", () => {
    expect(live().textContent).toBe("");
    act(() => showToast("Salvo"));
    expect(live().textContent).toBe("Salvo");
    act(() => { vi.advanceTimersByTime(TOAST_MS + 10); });
    expect(live().textContent).toBe("");
  });

  it("replaces the message and restarts the clock when a second one arrives", () => {
    act(() => showToast("Um"));
    act(() => { vi.advanceTimersByTime(TOAST_MS - 200); });
    act(() => showToast("Dois"));
    act(() => { vi.advanceTimersByTime(500); });
    expect(live().textContent).toBe("Dois");
  });

  it("confirms a copy", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: async () => {} } });
    await act(async () => { await copyText("texto"); });
    expect(live().textContent).toBe("Copiado");
  });
});
