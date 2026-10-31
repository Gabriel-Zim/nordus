import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { t } from "@/lib/i18n";
import { LinkifiedText } from "./LinkifiedText";

const draw = (text: string) => renderToStaticMarkup(createElement(LinkifiedText, { text, render: (run: string) => run }));

describe("an address pasted in chat text", () => {
  it("shows a pasted picture or video as itself", () => {
    const markup = draw("olha https://example.com/a.png e https://example.com/b.mp4");
    expect(markup).toContain('<img src="https://example.com/a.png"');
    expect(markup).toContain('<video src="https://example.com/b.mp4"');
  });

  it("links up to the end of the address, not the sentence's closing mark", () => {
    const markup = draw("veja https://figma.com/x. Ou https://github.com/a?b=1!");
    expect(markup).toContain('href="https://figma.com/x"');
    expect(markup).toContain('href="https://github.com/a?b=1"');
    expect(markup).toContain(`${t("chat.link.seeOn", { site: "Figma" })}</a>. Ou`);
    expect(markup).toMatch(/<\/a>!$/);
  });
});
