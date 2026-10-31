import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Message } from "@/state/store";

vi.hoisted(() => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
});
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({ state: { ...original.initialState }, dispatch: vi.fn() }) };
});

const { BrowserGoalCard } = await import("./BrowserGoalCard");

const message = (ok?: boolean): Message => ({
  id: "m", role: "bot", kind: "activity", at: 1,
  tool: { name: "agent_browser_goal", input: '{"goal":"find a flat"}', ...(ok === undefined ? {} : { ok }) },
});
const render = (m: Message) => renderToStaticMarkup(createElement(BrowserGoalCard, { message: m, threadId: "t1", botId: "b1", botName: "Pepper", onStop: () => {} }));

describe("BrowserGoalCard", () => {
  it("renders the open card with controls while the tool runs", () => {
    const markup = render(message());
    expect(markup).toContain('data-testid="browser-goal-card"');
    expect(markup).toContain("goal-shimmer");
    expect(markup).toContain("Take over");
    expect(markup).toContain('data-testid="browser-goal-see-screen"');
    expect(markup).toContain("See screen");
    expect(markup).not.toContain("goal-frame");
    expect(markup).not.toContain("<img");
    expect(markup).not.toContain("browser-goal-needs-you");
    expect(markup).toContain("Stop the browser task");
  });

  it("collapses to a single row once the tool has finished", () => {
    const markup = render(message(true));
    expect(markup).toContain('data-testid="browser-goal-collapsed"');
    expect(markup).toContain("See what it did");
    expect(markup).not.toContain("goal-shimmer");
    expect(markup).not.toContain("Stop the browser task");
  });
});
