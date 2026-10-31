// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STACK_POP_EVENT } from "./ios-motion";
import { attachStackSwipe, clearMotion, frontScreen, popScreen } from "./stack-swipe";

function touch(type: string, x: number, y = 300): Event {
  return Object.assign(new Event(type, { bubbles: true, cancelable: true }), { touches: type === "touchend" ? [] : [{ clientX: x, clientY: y }] });
}

function sized(el: Element) {
  (el as HTMLElement).getBoundingClientRect = () => ({ width: 400, height: 800, top: 0, left: 0, right: 400, bottom: 800, x: 0, y: 0, toJSON() {} }) as DOMRect;
}

function stack(withLayer = false) {
  document.body.innerHTML = `
    <div data-mobile-stack data-screen="chat">
      <div data-stack-shade></div>
      <aside data-sidebar></aside>
      <div data-stack-main>${withLayer ? `<aside data-stack-layer><button data-layer-close></button></aside>` : ""}</div>
    </div>`;
  document.querySelectorAll("[data-stack-main], [data-stack-layer]").forEach(sized);
  return document.querySelector<HTMLElement>("[data-mobile-stack]")!;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "requestAnimationFrame", "cancelAnimationFrame"] });
  Object.defineProperty(window, "innerWidth", { value: 400, configurable: true });
});
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("stack swipe", () => {
  it("drags the conversation away with direct transforms and opens the list past half the width", () => {
    const root = stack();
    const onBackToList = vi.fn();
    const stop = attachStackSwipe(root, { enabled: () => true, listShown: () => false, onBackToList });
    const main = root.querySelector<HTMLElement>("[data-stack-main]")!;
    const list = root.querySelector<HTMLElement>("aside[data-sidebar]")!;
    const shade = root.querySelector<HTMLElement>("[data-stack-shade]")!;
    root.dispatchEvent(touch("touchstart", 10));
    root.dispatchEvent(touch("touchmove", 40));
    root.dispatchEvent(touch("touchmove", 260));
    vi.advanceTimersToNextFrame();
    expect(main.style.transform).toBe("translate3d(250px,0,0)");
    expect(list.style.transform).toContain("calc(-30% + 75px)");
    expect(shade.style.opacity).toBe(String(1 - 250 / 400));
    expect(root.style.getPropertyValue("--stack-drag")).toBe("");
    root.dispatchEvent(touch("touchend", 260));
    vi.advanceTimersByTime(400);
    expect(onBackToList).toHaveBeenCalledOnce();
    vi.advanceTimersToNextFrame();
    vi.advanceTimersToNextFrame();
    expect(main.style.transform).toBe("");
    expect(main.style.willChange).toBe("");
    stop();
  });

  it("leaves a vertical scroll alone", () => {
    const root = stack();
    const onBackToList = vi.fn();
    attachStackSwipe(root, { enabled: () => true, listShown: () => false, onBackToList });
    root.dispatchEvent(touch("touchstart", 10, 300));
    const move = Object.assign(new Event("touchmove", { cancelable: true }), { touches: [{ clientX: 14, clientY: 400 }] });
    root.dispatchEvent(move);
    root.dispatchEvent(touch("touchend", 14));
    expect(move.defaultPrevented).toBe(false);
    expect(onBackToList).not.toHaveBeenCalled();
  });

  it("pops the screen in front instead of the conversation", () => {
    const root = stack(true);
    const layer = root.querySelector<HTMLElement>("[data-stack-layer]")!;
    const popped = vi.fn();
    layer.addEventListener(STACK_POP_EVENT, popped);
    const onBackToList = vi.fn();
    attachStackSwipe(root, { enabled: () => true, listShown: () => false, onBackToList });
    root.dispatchEvent(touch("touchstart", 5));
    root.dispatchEvent(touch("touchmove", 30));
    root.dispatchEvent(touch("touchmove", 300));
    vi.advanceTimersToNextFrame();
    expect(layer.style.transform).toBe("translate3d(295px,0,0)");
    root.dispatchEvent(touch("touchend", 300));
    vi.advanceTimersByTime(400);
    expect(popped).toHaveBeenCalledOnce();
    expect(onBackToList).not.toHaveBeenCalled();
  });

  it("finds the front screen and closes one without a pop handler through its close button", () => {
    const root = stack();
    root.querySelector("[data-stack-main]")!.insertAdjacentHTML("beforeend", `<aside data-room-info><button data-layer-close></button></aside>`);
    const room = root.querySelector<HTMLElement>("[data-room-info]")!;
    sized(room);
    expect(frontScreen(root)).toBe(room);
    const click = vi.fn();
    room.querySelector("button")!.addEventListener("click", click);
    popScreen(room);
    expect(click).toHaveBeenCalledOnce();
  });

  it("clears every inline trace of a slide", () => {
    const el = document.createElement("div");
    el.style.transform = "translateX(100%)";
    el.style.transition = "transform 300ms";
    el.style.animation = "none";
    el.style.willChange = "transform";
    clearMotion(el);
    expect(el.getAttribute("style") ?? "").toBe("");
  });
});
