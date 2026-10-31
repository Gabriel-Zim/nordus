// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { NotchSettingsRow } from "./NotchSettingsRow";

type Bridge = { state: ReturnType<typeof vi.fn>; setEnabled: ReturnType<typeof vi.fn> };

describe("the notch setting", () => {
  let root: Root;
  let container: HTMLDivElement;
  const bridge: Bridge = { state: vi.fn(), setEnabled: vi.fn() };
  const show = async () => {
    flushSync(() => root.render(createElement(NotchSettingsRow)));
  };
  const switchButton = () => container.querySelector<HTMLButtonElement>("button[role=switch]");

  beforeEach(() => {
    setLocale("en");
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    bridge.state.mockReset();
    bridge.setEnabled.mockReset();
  });
  afterEach(() => {
    flushSync(() => root.unmount());
    container.remove();
    delete (window as unknown as { ogb?: unknown }).ogb;
  });

  it("is not there outside the Mac desktop app", async () => {
    await show();
    expect(container.textContent).toBe("");
  });

  it("is on when the desktop says so, and turns off with a tap", async () => {
    (window as unknown as { ogb?: unknown }).ogb = { notch: bridge };
    bridge.state.mockResolvedValue({ supported: true, enabled: true, saved: false, display: "notch" });
    bridge.setEnabled.mockResolvedValue({ supported: true, enabled: false, saved: true, display: "notch" });

    await show();
    await vi.waitFor(() => expect(container.textContent).toContain("Show agents in the notch"));
    expect(container.textContent).toContain("approve simple requests without opening the app");
    expect(switchButton()!.getAttribute("aria-checked")).toBe("true");

    switchButton()!.click();

    await vi.waitFor(() => expect(switchButton()!.getAttribute("aria-checked")).toBe("false"));
    expect(bridge.setEnabled).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("says plainly when this Mac has no notch", async () => {
    (window as unknown as { ogb?: unknown }).ogb = { notch: bridge };
    bridge.state.mockResolvedValue({ supported: true, enabled: false, saved: false, display: "pill" });

    await show();

    await vi.waitFor(() => expect(container.textContent).toContain("This Mac has no notch"));
    expect(switchButton()!.getAttribute("aria-checked")).toBe("false");
  });

  it("keeps showing the current choice when the desktop does not answer", async () => {
    (window as unknown as { ogb?: unknown }).ogb = { notch: bridge };
    bridge.state.mockResolvedValue({ supported: true, enabled: true, saved: true, display: "notch" });
    bridge.setEnabled.mockRejectedValue(new Error("no"));

    await show();
    await vi.waitFor(() => expect(switchButton()).not.toBeNull());
    switchButton()!.click();

    await vi.waitFor(() => expect(bridge.setEnabled).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(switchButton()!.disabled).toBe(false));
    expect(switchButton()!.getAttribute("aria-checked")).toBe("true");
  });
});
