// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { HOLD_TO_APPROVE_MS } from "../../shared/approvals";
import { ApprovalHoldButton } from "./ApprovalHoldButton";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
const approve = vi.fn();

async function render(props: { disabled?: boolean; holdMs?: number } = {}) {
  await act(async () => root.render(createElement(ApprovalHoldButton, { onApprove: approve, ...props })));
}
const button = () => host.querySelector<HTMLButtonElement>("[data-hold-to-approve]")!;
const fill = () => host.querySelector<HTMLElement>("[data-hold-fill]")!;
const hint = () => host.querySelector<HTMLElement>("[aria-live]")!.textContent;
const fire = (type: string, init: Record<string, unknown> = {}) => act(async () => {
  const event = type.startsWith("key") ? new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init }) : new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
  button().dispatchEvent(event);
});
const wait = (ms: number) => act(async () => { vi.advanceTimersByTime(ms); });

beforeEach(() => {
  setLocale("en");
  vi.useFakeTimers();
  approve.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe("holding with a pointer", () => {
  it("approves only when the button has been held for the whole time, and fills while it is held", async () => {
    await render();
    expect(button().textContent).toContain("Hold to approve");
    expect(fill().style.width).toBe("0%");
    await fire("pointerdown", { button: 0 });
    expect(button().dataset.holding).toBeDefined();
    expect(fill().style.width).toBe("100%");
    expect(fill().style.transitionDuration).toBe(`${HOLD_TO_APPROVE_MS}ms`);
    await wait(HOLD_TO_APPROVE_MS - 1);
    expect(approve).not.toHaveBeenCalled();
    await wait(1);
    expect(approve).toHaveBeenCalledTimes(1);
    expect(button().dataset.holding).toBeUndefined();
    expect(HOLD_TO_APPROVE_MS).toBeGreaterThanOrEqual(1000);
    expect(HOLD_TO_APPROVE_MS).toBeLessThanOrEqual(1500);
  });

  it("does nothing when let go early, or when the pointer leaves, is cancelled or another button is used", async () => {
    await render();
    // React derives onPointerLeave from pointerout.
    for (const away of ["pointerup", "pointerout", "pointercancel"]) {
      await fire("pointerdown", { button: 0 });
      await wait(HOLD_TO_APPROVE_MS / 2);
      await fire(away);
      expect(button().dataset.holding, away).toBeUndefined();
      expect(fill().style.width, away).toBe("0%");
      await wait(HOLD_TO_APPROVE_MS * 2);
    }
    await fire("pointerdown", { button: 2 });
    await wait(HOLD_TO_APPROVE_MS * 2);
    expect(approve).not.toHaveBeenCalled();
  });

  it("approves once however many presses land during the hold, and not again right after", async () => {
    await render();
    await fire("pointerdown", { button: 0 });
    await fire("pointerdown", { button: 0 });
    await wait(HOLD_TO_APPROVE_MS);
    expect(approve).toHaveBeenCalledTimes(1);
    await fire("pointerdown", { button: 0 });
    await wait(HOLD_TO_APPROVE_MS);
    expect(approve).toHaveBeenCalledTimes(1);
    await wait(2_500);
    await fire("pointerdown", { button: 0 });
    await wait(HOLD_TO_APPROVE_MS);
    expect(approve).toHaveBeenCalledTimes(2);
  });

  it("ignores a hold on a disabled button, and a plain click with a mouse", async () => {
    await render({ disabled: true });
    await fire("pointerdown", { button: 0 });
    await wait(HOLD_TO_APPROVE_MS * 2);
    expect(approve).not.toHaveBeenCalled();
    await render();
    await fire("click", { detail: 1 });
    await wait(HOLD_TO_APPROVE_MS * 2);
    expect(approve).not.toHaveBeenCalled();
  });
});

describe("holding with the keyboard", () => {
  it.each([" ", "Enter"])("approves after holding %j down, and not before", async (key) => {
    await render();
    await fire("keydown", { key });
    expect(button().dataset.holding).toBeDefined();
    await fire("keydown", { key, repeat: true });
    await wait(HOLD_TO_APPROVE_MS - 1);
    expect(approve).not.toHaveBeenCalled();
    await wait(1);
    expect(approve).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the key is let go early, or the focus leaves", async () => {
    await render();
    await fire("keydown", { key: " " });
    await wait(HOLD_TO_APPROVE_MS / 2);
    await fire("keyup", { key: " " });
    await wait(HOLD_TO_APPROVE_MS * 2);
    await fire("keydown", { key: "Enter" });
    await wait(HOLD_TO_APPROVE_MS / 2);
    await act(async () => { button().dispatchEvent(new FocusEvent("focusout", { bubbles: true })); });
    await wait(HOLD_TO_APPROVE_MS * 2);
    await fire("keydown", { key: "a" });
    await wait(HOLD_TO_APPROVE_MS * 2);
    expect(approve).not.toHaveBeenCalled();
  });
});

describe("for a screen reader, which cannot hold", () => {
  const assistiveClick = () => fire("click", { detail: 0 });

  it("asks twice, close together, and says so", async () => {
    await render();
    expect(hint()).toContain("activate it twice");
    await assistiveClick();
    expect(approve).not.toHaveBeenCalled();
    expect(button().textContent).toContain("Press again to approve");
    expect(hint()).toContain("Press again");
    await assistiveClick();
    expect(approve).toHaveBeenCalledTimes(1);
    expect(button().textContent).toContain("Hold to approve");
  });

  it("forgets the first ask when the second takes too long", async () => {
    await render();
    await assistiveClick();
    await wait(6_500);
    expect(button().textContent).toContain("Hold to approve");
    await assistiveClick();
    expect(approve).not.toHaveBeenCalled();
  });

  it("is described to assistive technology by the hint", async () => {
    await render();
    const describedBy = button().getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(host.querySelector(`#${CSS.escape(describedBy!)}`)).not.toBeNull();
  });
});
