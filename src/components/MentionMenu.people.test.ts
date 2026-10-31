import { createElement, createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MentionMenu, type MentionChoice } from "./MentionMenu";

const motion = { shown: true, className: "", exitProps: {} } as unknown as Parameters<typeof MentionMenu>[0]["motion"];
const render = (choices: MentionChoice[]) => renderToStaticMarkup(createElement(MentionMenu, {
  listRef: createRef<HTMLDivElement>(), motion, choices, highlight: 0, everyoneCount: 2, onPick() {}, onHighlight() {},
}));

describe("the @ list with a person in it", () => {
  it("shows the person's name, their address and that they are a person", () => {
    const html = render([{ id: "person:bruno@acme.test", name: "Bruno", person: { email: "bruno@acme.test" } }]);
    expect(html).toContain("Bruno");
    expect(html).toContain("bruno@acme.test");
    expect(html).toContain("Person");
    expect(html).not.toContain("Agent");
  });

  it("keeps the other rows as they were", () => {
    const html = render([{ id: "__everyone__", name: "everyone" }]);
    expect(html).toContain("Group chat");
    expect(html).not.toContain("Person");
  });
});
