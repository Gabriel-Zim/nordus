import { describe, expect, it } from "vitest";

import { headingKey, parseWikiFileHref, parseWikiHref, plainLine, wikiMarkdown, wikiUrlTransform } from "./wiki-render";

const input = (content: string, files: Record<string, string> = {}) => ({ content, links: {}, files });

describe("Obsidian links become Markdown links", () => {
  it("handles the three forms, with a label and a section", () => {
    const out = wikiMarkdown(input("See [[Pricing]], [[Pricing|the prices]] and [[Pricing#Tiers]]."));
    expect(out).toBe("See [Pricing](wiki:Pricing), [the prices](wiki:Pricing) and [Pricing > Tiers](wiki:Pricing#Tiers).");
  });

  it("keeps spaces, accents and brackets in a name safe to read back", () => {
    const out = wikiMarkdown(input("Go to [[Reunião (2026) de equipe#Próximos passos]]."));
    const href = /\]\((wiki:[^)]*)\)/.exec(out.replace(/%28/g, "%28"))![1]!;
    expect(parseWikiHref(href)).toEqual({ target: "Reunião (2026) de equipe", heading: "Próximos passos" });
  });

  it("leaves code alone, as the server did when it read the page", () => {
    const out = wikiMarkdown(input("Real [[A]] but `[[B]]` and\n\n```\n[[C]]\n```\n"));
    expect(out).toContain("[A](wiki:A)");
    expect(out).toContain("`[[B]]`");
    expect(out).toContain("[[C]]");
  });

  it("shows an embedded picture from the Drive and a file as a link, and an unknown embed as a link to the page", () => {
    const files = { "pic.png": "Wiki/anexos/Vault/img/pic.png", "brief.pdf": "Wiki/anexos/Vault/brief.pdf" };
    const out = wikiMarkdown(input("![[pic.png]] ![[brief.pdf]] ![[Other page]]", files));
    expect(out).toBe("![pic.png](wiki-file:Wiki%2Fanexos%2FVault%2Fimg%2Fpic.png) [brief.pdf](wiki-file:Wiki%2Fanexos%2FVault%2Fbrief.pdf) [Other page](wiki:Other%20page)");
    expect(parseWikiFileHref("wiki-file:Wiki%2Fanexos%2FVault%2Fimg%2Fpic.png")).toBe("Wiki/anexos/Vault/img/pic.png");
  });

  it("does not read the frontmatter as part of the page", () => {
    expect(wikiMarkdown(input("---\ntags: [a]\n---\nHello [[X]]"))).toBe("Hello [X](wiki:X)");
  });
});

describe("addresses", () => {
  it("lets only its own two schemes through the renderer's address filter", () => {
    const fallback = (value: string) => (value.startsWith("javascript:") ? "" : value);
    expect(wikiUrlTransform("wiki:A", fallback)).toBe("wiki:A");
    expect(wikiUrlTransform("wiki-file:A", fallback)).toBe("wiki-file:A");
    expect(wikiUrlTransform("javascript:alert(1)", fallback)).toBe("");
    expect(wikiUrlTransform("https://example.com", fallback)).toBe("https://example.com");
  });

  it("refuses a malformed address instead of throwing", () => {
    expect(parseWikiHref("wiki:%E0%A4%A")).toBeNull();
    expect(parseWikiHref("https://x")).toBeNull();
    expect(parseWikiFileHref("wiki-file:%E0%A4%A")).toBeNull();
  });

  it("reads a line from another page without its brackets", () => {
    expect(plainLine("See [[Target]], [[Other|the other one]] and [[Plan#Next steps]] ![[pic.png]]")).toBe("See Target, the other one and Plan > Next steps");
    expect(plainLine("nothing special")).toBe("nothing special");
  });

  it("compares headings without case or marks", () => {
    expect(headingKey("  Próximos   Passos ")).toBe(headingKey("proximos passos"));
  });
});
