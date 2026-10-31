// @vitest-environment happy-dom
import { createElement, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import type { RailCardData } from "./sidebar-preview";
import { railCardTop, SidebarRailCard, useRailCardTrigger } from "./SidebarRailCard";

describe("railCardTop", () => {
  const anchor = { top: 300, height: 56 };

  it("centres the card on the avatar", () => {
    expect(railCardTop(anchor, 100, 900)).toBe(278);
  });

  it("keeps the card inside the window at the top", () => {
    expect(railCardTop({ top: 4, height: 56 }, 100, 900)).toBe(8);
  });

  it("keeps the card inside the window at the bottom", () => {
    expect(railCardTop({ top: 860, height: 56 }, 120, 900)).toBe(772);
  });
});

const data: RailCardData = { kind: "bot", name: "Atlas", preview: "Pronto, mandei o resumo.", state: "idle", unread: false };
let root: Root;
let host: HTMLDivElement;

function Row({ card = data, enabled = true, children }: { card?: RailCardData; enabled?: boolean; children?: ReactNode }) {
  const rail = useRailCardTrigger(enabled);
  return createElement("div", null,
    createElement("button", { "data-row": "", ...rail.triggerProps }, "row"),
    rail.anchor && createElement(SidebarRailCard, { anchor: rail.anchor, data: card, avatar: createElement("i"), ...rail.cardProps }, children),
  );
}
const draw = (element: ReactNode) => flushSync(() => root.render(element));
const row = () => host.querySelector<HTMLElement>("[data-row]")!;
const card = () => document.querySelector<HTMLElement>("[data-sidebar-rail-card]");
const fire = (target: Element, type: string) => flushSync(() => { target.dispatchEvent(new MouseEvent(type, { bubbles: true })); });
const focus = (target: Element, type: "focusin" | "focusout") => flushSync(() => { target.dispatchEvent(new FocusEvent(type, { bubbles: true })); });
const advance = (ms: number) => flushSync(() => { vi.advanceTimersByTime(ms); });

beforeEach(() => {
  vi.useFakeTimers();
  setLocale("pt-BR");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  setLocale("en");
});

describe("the avatar rail's hover card", () => {
  it("opens shortly after the pointer enters the avatar, not instantly", () => {
    draw(createElement(Row));
    fire(row(), "mouseover");
    expect(card()).toBeNull();
    advance(119);
    expect(card()).toBeNull();
    advance(2);
    expect(card()).not.toBeNull();
  });

  it("shows the name and the last message, and no state line while idle", () => {
    draw(createElement(Row));
    fire(row(), "mouseover");
    advance(130);
    expect(card()!.textContent).toContain("Atlas");
    expect(card()!.textContent).toContain("Pronto, mandei o resumo.");
    expect(card()!.querySelector("[data-rail-card-state]")).toBeNull();
  });

  it("names the wait in the warning colour when someone waits on the person", () => {
    draw(createElement(Row, { card: { ...data, state: "waiting" } }));
    fire(row(), "mouseover");
    advance(130);
    const line = card()!.querySelector("[data-rail-card-state='waiting']")!;
    expect(line.textContent).toBe("Esperando por você…");
    expect(line.className).toContain("text-warning");
  });

  it("names the work while a bot works", () => {
    draw(createElement(Row, { card: { ...data, state: "working" } }));
    fire(row(), "mouseover");
    advance(130);
    expect(card()!.querySelector("[data-rail-card-state='working']")!.textContent).toBe("Trabalhando…");
  });

  it("shows the step a working bot is on instead of the generic work line", () => {
    draw(createElement(Row, { card: { ...data, state: "working", step: "Revisando a lâmina 2" } }));
    fire(row(), "mouseover");
    advance(130);
    expect(card()!.querySelector("[data-rail-card-state='working']")!.textContent).toBe("Revisando a lâmina 2");
  });

  it("keeps the wait line when the bot waits on the person even with a step known", () => {
    draw(createElement(Row, { card: { ...data, state: "waiting", step: "Revisando a lâmina 2" } }));
    fire(row(), "mouseover");
    advance(130);
    expect(card()!.querySelector("[data-rail-card-state='waiting']")!.textContent).toBe("Esperando por você…");
  });

  it("closes after a short grace when the pointer leaves", () => {
    draw(createElement(Row));
    fire(row(), "mouseover");
    advance(130);
    fire(row(), "mouseout");
    advance(100);
    expect(card()).not.toBeNull();
    advance(100);
    expect(card()).toBeNull();
  });

  it("stays open while the pointer is on the card itself", () => {
    draw(createElement(Row));
    fire(row(), "mouseover");
    advance(130);
    fire(row(), "mouseout");
    advance(50);
    fire(card()!, "mouseover");
    advance(500);
    expect(card()).not.toBeNull();
    fire(card()!, "mouseout");
    advance(200);
    expect(card()).toBeNull();
  });

  it("closes on Esc", () => {
    draw(createElement(Row));
    fire(row(), "mouseover");
    advance(130);
    flushSync(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(card()).toBeNull();
  });

  it("opens on keyboard focus and closes when focus leaves", () => {
    draw(createElement(Row));
    focus(row(), "focusin");
    advance(1);
    expect(card()).not.toBeNull();
    focus(row(), "focusout");
    advance(1);
    expect(card()).toBeNull();
  });

  it("does nothing outside the avatar rail", () => {
    draw(createElement(Row, { enabled: false }));
    fire(row(), "mouseover");
    focus(row(), "focusin");
    advance(500);
    expect(card()).toBeNull();
  });

  it("leaves a slot at the bottom for what a card can offer to do", () => {
    draw(createElement(Row, null, createElement("button", { "data-approve": "" }, "Aprovar")));
    fire(row(), "mouseover");
    advance(130);
    expect(card()!.querySelector("[data-rail-card-actions] [data-approve]")).not.toBeNull();
  });

  it("draws the slot only when it has content", () => {
    draw(createElement(Row));
    fire(row(), "mouseover");
    advance(130);
    expect(card()!.querySelector("[data-rail-card-actions]")).toBeNull();
  });
});
