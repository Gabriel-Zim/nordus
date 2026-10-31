// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cardFocusTarget, focusCardWhenShown } from "./card-focus";

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

function addCard(requestId: string): HTMLElement {
  const card = document.createElement("div");
  for (const [name, value] of Object.entries(cardFocusTarget(requestId))) card.setAttribute(name === "tabIndex" ? "tabindex" : name, String(value));
  card.scrollIntoView = vi.fn();
  document.body.append(card);
  return card;
}

describe("a tap on a banner", () => {
  it("waits for the conversation to draw the card, then scrolls to it and focuses it", async () => {
    vi.useFakeTimers();
    focusCardWhenShown("req-7");
    addCard("req-other");
    const card = addCard("req-7");
    await vi.advanceTimersByTimeAsync(500);
    expect(card.scrollIntoView).toHaveBeenCalledWith({ block: "center" });
    expect(document.activeElement).toBe(card);
  });

  it("lands through the card's transcript row, so the conversation stops following its end", async () => {
    vi.useFakeTimers();
    const rows: string[] = [];
    focusCardWhenShown("req-7", (messageId) => rows.push(messageId));
    const row = document.createElement("div");
    row.setAttribute("data-mid", "m-42");
    document.body.append(row);
    const card = addCard("req-7");
    row.append(card);
    await vi.advanceTimersByTimeAsync(500);
    expect(rows).toEqual(["m-42"]);
    expect(card.scrollIntoView).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(card);
  });

  it("drops an older wait when a newer tap comes in", async () => {
    vi.useFakeTimers();
    focusCardWhenShown("req-old");
    focusCardWhenShown("req-new");
    const old = addCard("req-old");
    await vi.advanceTimersByTimeAsync(500);
    expect(old.scrollIntoView).not.toHaveBeenCalled();
  });

  it("gives up quietly when the card never shows", async () => {
    vi.useFakeTimers();
    focusCardWhenShown("req-7", undefined, 1_000);
    await vi.advanceTimersByTimeAsync(1_500);
    const card = addCard("req-7");
    await vi.advanceTimersByTimeAsync(500);
    expect(card.scrollIntoView).not.toHaveBeenCalled();
  });

  it("ignores a request id that is not one", () => {
    expect(cardFocusTarget(undefined)).toEqual({});
    expect(focusCardWhenShown('a"]b')).toBeTypeOf("function");
  });
});
