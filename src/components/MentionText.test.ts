import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { MentionText, personMentionName } from "./MentionText";
import { CRITTER_COLORS } from "@/lib/mascot";

it("uses each bot's avatar palette and updates when its color changes", () => {
  for (const color of ["red", "blue"] as const) {
    const html = renderToStaticMarkup(createElement(MentionText, {
      text: "@Atlas @Juniper @everyone", everyone: true,
      peers: [{ name: "Atlas", color }, { name: "Juniper", color: "purple" }],
    }));
    expect(html).toContain(`style="--mention-color:${CRITTER_COLORS[color]}">@Atlas`);
    expect(html).toContain(`style="--mention-color:${CRITTER_COLORS.purple}">@Juniper`);
    expect(html).toContain('<span class="mention-highlight">@everyone</span>');
  }
});

it("decorates known names while preserving whitespace and escaping text", () => {
  const html = renderToStaticMarkup(createElement(MentionText, {
    text: "<script>\n@Atlas & @Ghost\n@Atlas", peers: [{ name: "Atlas" }],
  }));
  expect(html).toBe('&lt;script&gt;\n<span class="mention-highlight">@Atlas</span> &amp; @Ghost\n<span class="mention-highlight">@Atlas</span>');
});

it("removes decoration when a peer is renamed or archived", () => {
  for (const peers of [[{ name: "Renamed" }], [{ name: "Atlas", hidden: true }]]) {
    expect(renderToStaticMarkup(createElement(MentionText, { text: "@Atlas", peers }))).toBe("@Atlas");
  }
});

it("draws a bot mention in a message as its face and name, without the @ or a chip", () => {
  const html = renderToStaticMarkup(createElement(MentionText, { text: "oi @Atlas", peers: [{ name: "Atlas", id: "b1" }] }));
  expect(html).toContain('data-mention-bot="b1"');
  expect(html).toContain('<span class="mention-inline-name">Atlas</span>');
  expect(html).not.toContain("@Atlas");
  const mirror = renderToStaticMarkup(createElement(MentionText, { text: "oi @Atlas", peers: [{ name: "Atlas", id: "b1" }], mirror: true }));
  expect(mirror).toContain("@");
  expect(mirror).toContain("Atlas");
});

it("names the person instead of @you", () => {
  expect(personMentionName("@you", "Avery Mercer")).toBe("Avery");
  expect(personMentionName("@Jordan", "Avery Mercer")).toBe("Jordan");
  const html = renderToStaticMarkup(createElement(MentionText, { text: "@you, pode olhar?", peers: [], person: { profileName: "Avery" } }));
  expect(html).toContain("data-mention-person");
  expect(html).not.toContain("@you");
});

it("finds any bot by its current name, whatever the case or accents", () => {
  const html = renderToStaticMarkup(createElement(MentionText, { text: "@revisao rodada 1", peers: [{ name: "Revisão", id: "r1" }] }));
  expect(html).toContain('data-mention-bot="r1"');
});
