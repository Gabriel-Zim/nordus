// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useArrivedWhileAway } from "./JumpToLatestButton";

type Line = { id: string; kind: string; role: string };
const bot = (id: string): Line => ({ id, kind: "text", role: "bot" });
const user = (id: string): Line => ({ id, kind: "text", role: "user" });
const page = (prefix: string, size: number): Line[] => Array.from({ length: size }, (_, i) => bot(`${prefix}${i}`));

let host: HTMLDivElement;
let root: Root;
let seen = -1;
function Probe({ messages, following }: { messages: Line[]; following: boolean }) {
  seen = useArrivedWhileAway(messages, following);
  return null;
}
const show = (messages: Line[], following: boolean) => {
  flushSync(() => root.render(createElement(Probe, { messages, following })));
  return seen;
};

beforeEach(() => {
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(() => root.unmount());

describe("useArrivedWhileAway", () => {
  it("counts only bot replies that arrive after the reader scrolled up", () => {
    const latest = [user("u1"), bot("b1")];
    show(latest, true);
    show(latest, false);
    expect(show([...latest, bot("b2"), user("u2"), bot("b3")], false)).toBe(2);
    expect(show([...latest, bot("b2")], true)).toBe(0);
  });

  it("does not count an older page loaded above the reader as new", () => {
    const latest = [user("u1"), bot("b1")];
    show(latest, true);
    show(latest, false);
    expect(show([...page("old", 100), ...latest], false)).toBe(0);
    expect(show([...page("older", 50), ...page("old", 100), ...latest, bot("b2")], false)).toBe(1);
  });

  it("does not count when the older part of the transcript is trimmed", () => {
    const latest = [...page("old", 10), user("u1"), bot("b1")];
    show(latest, true);
    show(latest, false);
    expect(show([user("u1"), bot("b1"), bot("b2")], false)).toBe(1);
  });
});
