// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { useChatErrorClear } from "@/state/chat-error";
import { ChatErrorBanner } from "./ChatErrorBanner";

function Harness({ error, informational }: { error: string; informational: boolean }) {
  const [current, setCurrent] = useState<string | null>(error);
  useChatErrorClear(current, () => setCurrent(null), !informational);
  return createElement(ChatErrorBanner, { message: current, onDismiss: () => setCurrent(null) });
}

describe("ChatErrorBanner persistence", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    setLocale("pt-br");
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllTimers();
    vi.useRealTimers();
    setLocale("en");
  });

  it("lets an informational notice disappear on its own", () => {
    act(() => { root.render(createElement(Harness, { error: "A imagem da área de transferência não pôde ser lida", informational: true })); });
    expect(container.textContent).toContain("A imagem");
    act(() => { vi.advanceTimersByTime(6_000); });
    expect(container.textContent).toBe("");
  });

  it("keeps an error that needs to be read, with a close button", () => {
    act(() => { root.render(createElement(Harness, { error: "502 Bad Gateway", informational: false })); });
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="Dispensar"]')).not.toBeNull();
    expect(container.textContent).toContain("Algo deu errado do outro lado. Tente de novo.");
  });

  it("shows Details in Portuguese, collapsed, with the raw message inside", () => {
    act(() => { root.render(createElement(Harness, { error: "502 Bad Gateway", informational: false })); });
    const details = container.querySelector("details");
    expect(details).not.toBeNull();
    expect(details?.hasAttribute("open")).toBe(false);
    expect(details?.querySelector("summary")?.textContent).toBe("Detalhes");
    expect(details?.textContent).toContain("502 Bad Gateway");
  });
});
