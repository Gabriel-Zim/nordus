import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";

import { setLocale } from "@/lib/i18n";
import { wikiMarkdown } from "@/lib/wiki-render";
import { WikiMarkdown, type WikiMarkdownProps } from "./WikiMarkdown";

function render(content: string, extra: Partial<WikiMarkdownProps> & { files?: Record<string, string>; links?: Record<string, string | null> } = {}) {
  const { files = {}, links = {}, ...rest } = extra;
  return renderToStaticMarkup(createElement(WikiMarkdown, { markdown: wikiMarkdown({ content, links, files }), links, files, ...rest }));
}

beforeEach(() => setLocale("en"));

describe("a wiki page on screen", () => {
  it("draws a link to a page as a button, and a link to nothing as a dashed one that says so", () => {
    const html = render("See [[Refund policy]] and [[Nowhere|a new page]].", { links: { "Refund policy": "page-1", Nowhere: null } });
    expect(html).toMatch(/<button[^>]*>Refund policy<\/button>/);
    expect(html).toMatch(/<button[^>]*title="This page doesn&#x27;t exist yet\. Click to create it\."[^>]*>a new page<\/button>/);
    expect(html).not.toMatch(/<button[^>]*page-1/);
    expect(html.match(/title="This page/g)).toHaveLength(1);
  });

  it("marks every heading with its key, so a link to a section can find it", () => {
    const html = render("# Intro\n\n## Prazos e Métricas\n");
    expect(html).toContain('data-heading="intro"');
    expect(html).toContain('data-heading="prazos e metricas"');
  });

  it("opens web and mail addresses in a new tab and shows any other address as plain text", () => {
    const html = render("[site](https://example.com/a) [mail](mailto:a@example.com) [bad](javascript:alert(1)) [data](data:text/html;base64,AAAA)");
    expect(html).toMatch(/<a href="https:\/\/example\.com\/a" target="_blank" rel="noreferrer noopener"[^>]*>site<\/a>/);
    expect(html).toContain('href="mailto:a@example.com"');
    expect(html).not.toMatch(/javascript:|data:text/);
    expect(html).toContain("<span>bad</span>");
  });

  it("never turns page text into markup", () => {
    const html = render('<script>alert(1)</script> <img src=x onerror="alert(2)"> <iframe src="https://evil.example"></iframe>');
    expect(html).not.toMatch(/<(script|iframe|img)/);
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;img src=x");
  });

  it("does not load pictures from the web, only the Drive files a page embeds", () => {
    const fileUrl = (path: string) => `/api/drive/preview?path=${encodeURIComponent(path)}`;
    const html = render("![tracker](https://tracker.example/p.png) ![[diagram.png]]", { files: { "diagram.png": "Wiki/anexos/Vault/diagram.png" }, fileUrl });
    expect(html).not.toContain("tracker.example/p.png\"");
    expect(html).toContain("tracker");
    expect(html.match(/<img /g)).toHaveLength(1);
    expect(html).toContain('src="/api/drive/preview?path=Wiki%2Fanexos%2FVault%2Fdiagram.png"');
    expect(html).toContain('loading="lazy"');
  });

  it("links an embedded file that is not a picture to its download, and shows nothing for a file it does not know", () => {
    const fileUrl = (path: string) => `/api/drive/download?path=${encodeURIComponent(path)}`;
    const html = render("![[plan.pdf]] and ![[ghost.png]]", { files: { "plan.pdf": "Wiki/anexos/Vault/plan.pdf" }, fileUrl });
    expect(html).toContain('href="/api/drive/download?path=Wiki%2Fanexos%2FVault%2Fplan.pdf"');
    expect(html).not.toContain("<img");
    expect(html).not.toContain("ghost.png\"");
  });

  it("shows tables and code the usual way", () => {
    const html = render("| a | b |\n| - | - |\n| 1 | 2 |\n\n```ts\nconst x = 1;\n```\n\n`inline`");
    expect(html).toContain("<table");
    expect(html).toContain("<pre");
    expect(html).toContain("ui-code-plain");
  });
});
