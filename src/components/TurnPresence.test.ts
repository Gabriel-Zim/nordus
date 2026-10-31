// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { phraseHoldMs } from "@/lib/live-activity";
import { TurnPresence } from "./TurnPresence";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const thinking = ["Thinking", "Mulling it over", "Piecing it together", "Chipping away"];
const seed = "bot:thread:1";

let host: HTMLDivElement;
let root: Root;

function render(props: Record<string, unknown>) {
  act(() => root.render(createElement(TurnPresence, { avatar: null, visible: true, seed, since: null, ...props })));
}

const visibleText = () =>
  Array.from(host.querySelectorAll(".thinking-shimmer:not([aria-hidden])")).map((node) => node.textContent);

beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe("TurnPresence", () => {
  it("is one line with no avatar and no timer, naming the bot", () => {
    render({ phrases: thinking, phase: "think", names: ["Social"], since: Date.now() });
    expect(host.querySelector("[data-turn-presence]")).not.toBeNull();
    expect(host.querySelector("svg, img, [data-nordus-monogram]")).toBeNull();
    expect(visibleText()).toEqual(["Social is thinking…"]);
    expect(host.textContent).not.toMatch(/\d+s/);
  });

  it("says for how long a command has run from the first minute, and keeps counting by itself", () => {
    render({ phrases: ["Running all the tests"], phase: "command:allTests", names: ["PROGRAMADOR"], since: Date.now() - 20_000 });
    expect(visibleText()).toEqual(["PROGRAMADOR is running all the tests…"]);
    act(() => { vi.advanceTimersByTime(45_000); });
    expect(visibleText()).toEqual(["PROGRAMADOR is running all the tests · 1 min ago"]);
    act(() => { vi.advanceTimersByTime(20 * 60_000); });
    expect(visibleText()).toEqual(["PROGRAMADOR is running all the tests · 21 min ago"]);
  });

  it("counts how long the turn has run from ten seconds, as one more word on the line", () => {
    render({ phrases: ["Reading the files"], phase: "tool:read", turnSince: Date.now() - 2_000 });
    expect(visibleText()).toEqual(["Reading the files…"]);
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(visibleText()).toEqual(["Reading the files… · 32 s"]);
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(visibleText()).toEqual(["Reading the files… · 1 min"]);
  });

  it("keeps its phrase still while a command runs", () => {
    render({ phrases: ["Running all the tests"], phase: "command:allTests", names: ["PROGRAMADOR"], since: Date.now() });
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(visibleText()[0]).toContain("running all the tests");
  });

  it("names everyone working in a room", () => {
    render({ phrases: thinking, phase: "think", names: ["Design", "Social", "DesignerDeIA"] });
    expect(visibleText()).toEqual(["Design, Social and DesignerDeIA are working…"]);
  });

  it("in a room roster, lists who works and then the queue on one line, with no phrase and no queue words", () => {
    render({ phrases: thinking, phase: "think", names: ["SOCIAL AVERYMERCER.AI", "MontadorDeVideo!", "DESIGNERDEIA"], roster: true });
    expect(visibleText()).toEqual(["SOCIAL AVERYMERCER.AI, MontadorDeVideo!, DESIGNERDEIA…"]);
    expect(host.textContent).not.toMatch(/thinking|working|queue|fila|aguardando/i);
    expect(host.querySelector(".thinking-shimmer")!.className).toContain("truncate");
  });

  it("draws the room's stop at the end of the same line", () => {
    render({ phrases: thinking, phase: "think", names: ["Social", "DesignerDeIA"], roster: true, after: createElement("button", { "data-testid": "stop" }) });
    const line = host.querySelector("[data-turn-presence]")!.parentElement!;
    expect(line.querySelector("[data-testid=stop]")).not.toBeNull();
  });

  it("follows what the bot is doing as the phrase changes", () => {
    render({ phrases: thinking, phase: "think", names: ["Social"] });
    act(() => void vi.advanceTimersByTime(phraseHoldMs(`${seed}|think`, 0)));
    expect(visibleText()[0]).toMatch(/^Social is (mulling it over|piecing it together|chipping away)…$/);
  });

  it("opens the what-it-is-doing panel when clicked", () => {
    const opened = vi.fn();
    window.addEventListener("nordus:open-working-now", opened);
    render({ phrases: thinking, phase: "think", names: ["Social"] });
    act(() => host.querySelector<HTMLButtonElement>("[data-turn-presence]")!.click());
    expect(opened).toHaveBeenCalledOnce();
    window.removeEventListener("nordus:open-working-now", opened);
  });

  it("adds the browser segment when the tool works in the browser", () => {
    render({ names: ["Pepper"], phrases: ["Working"], place: "browser" });
    expect(host.querySelector("[data-presence-place=browser]")?.textContent).toContain("In the browser");
    render({ names: ["Pepper"], phrases: ["Working"] });
    expect(host.querySelector("[data-presence-place]")).toBeNull();
  });
});
