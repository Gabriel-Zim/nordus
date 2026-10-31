import { describe, expect, it } from "vitest";

import {
  analyzeWikiPage,
  cleanTag,
  cleanWikiTitle,
  createWikiResolver,
  frontmatterFields,
  inlineTags,
  markdownImageTargets,
  maskCode,
  scanWikiLinks,
  splitFrontmatter,
} from "./wiki-markdown.ts";

describe("scanWikiLinks", () => {
  it("reads the three link forms", () => {
    const links = scanWikiLinks("See [[Plain]], [[Target|nickname]] and [[Page#Section]].");
    expect(links.map(({ target, heading, alias, embed }) => ({ target, heading, alias, embed }))).toEqual([
      { target: "Plain", heading: undefined, alias: undefined, embed: false },
      { target: "Target", heading: undefined, alias: "nickname", embed: false },
      { target: "Page", heading: "Section", alias: undefined, embed: false },
    ]);
  });

  it("reads a section and a nickname together", () => {
    const [link] = scanWikiLinks("[[Page#Section|shown]]");
    expect(link).toMatchObject({ target: "Page", heading: "Section", alias: "shown", raw: "[[Page#Section|shown]]" });
  });

  it("marks embeds and keeps the offset into the original text", () => {
    const text = "Intro ![[photo.png]] and [[Other]]";
    const links = scanWikiLinks(text);
    expect(links[0]).toMatchObject({ embed: true, target: "photo.png" });
    expect(text.slice(links[0]!.index, links[0]!.index + links[0]!.raw.length)).toBe("![[photo.png]]");
    expect(links[1]).toMatchObject({ embed: false, target: "Other" });
  });

  it("ignores links in code blocks, inline code and links with no name", () => {
    const text = ["Use `[[inline]]` here.", "```", "[[fenced]]", "```", "~~~md", "[[tilde]]", "~~~", "[[Real]]", "[[]]", "[[#only-heading]]"].join("\n");
    expect(scanWikiLinks(text).map((link) => link.target)).toEqual(["Real", ""]);
  });

  it("accepts accents, spaces, paths and a escaped pipe", () => {
    const targets = scanWikiLinks("[[Ação rápida]] [[Pasta/Nota]] [[a\\|b]]").map((link) => link.target);
    expect(targets[0]).toBe("Ação rápida");
    expect(targets[1]).toBe("Pasta/Nota");
  });

  it("keeps a code-only line from hiding the next one", () => {
    expect(maskCode("`a`\n[[x]]").includes("[[x]]")).toBe(true);
  });
});

describe("front matter and tags", () => {
  const note = ["---", "title: Plan", "tags: [alpha, \"beta gamma\", #delta]", "aliases:", "  - Roadmap", "  - 'Q4 plan'", "---", "Body #inline and #nested/tag and not# this.", "```", "#incode", "```"].join("\n");

  it("splits the front matter from the body and keeps both", () => {
    const { frontmatter, body, offset } = splitFrontmatter(note);
    expect(frontmatter).toContain("title: Plan");
    expect(body.startsWith("Body")).toBe(true);
    expect(note.slice(offset)).toBe(body);
    expect(splitFrontmatter("no front matter")).toEqual({ frontmatter: null, body: "no front matter", offset: 0 });
  });

  it("reads tags and aliases written as a list or inline", () => {
    expect(frontmatterFields(splitFrontmatter(note).frontmatter)).toEqual({ tags: ["alpha", "beta-gamma", "delta"], aliases: ["Roadmap", "Q4 plan"] });
    expect(frontmatterFields("tags: one, two\nalias: Single").tags).toEqual(["one", "two"]);
  });

  it("finds inline tags outside code and ignores numbers", () => {
    expect(inlineTags(splitFrontmatter(note).body)).toEqual(["inline", "nested/tag"]);
    expect(cleanTag("#2026")).toBeNull();
    expect(cleanTag("ok tag")).toBe("ok-tag");
  });

  it("summarises a page for the list and the graph", () => {
    const analysis = analyzeWikiPage(`${note}\n[[Other]] ![[img.png]] ![alt](pics/a%20b.png) ![web](https://x.test/y.png)`);
    expect(analysis.tags).toEqual(["alpha", "beta-gamma", "delta", "inline", "nested/tag"]);
    expect(analysis.aliases).toEqual(["Roadmap", "Q4 plan"]);
    expect(analysis.links).toEqual(["Other"]);
    expect(analysis.embeds).toEqual(["img.png"]);
    expect(analysis.images).toEqual(["pics/a b.png"]);
    expect(analysis.excerpt.length).toBeLessThanOrEqual(200);
    expect(analysis.excerpt).not.toContain("[[");
  });

  it("keeps the hyphens inside words in the excerpt and drops list markers, rules and table rules", () => {
    const { excerpt } = analyzeWikiPage("# Bem-vindo\n\n- primeiro item\n- segundo guarda-chuva\n\n---\n\n| a | b |\n| - | - |\n| 2026-10-27 | x |\n");
    expect(excerpt).toBe("Bem-vindo primeiro item segundo guarda-chuva a b 2026-10-27 x");
  });

  it("lists local images only", () => {
    expect(markdownImageTargets("![a](x.png) ![b](http://x/y.png) ![c](<my pic.png> \"title\") ![d](data:image/png;base64,AA) ![e](//cdn/z.png)")).toEqual(["x.png", "my pic.png"]);
  });
});

describe("cleanWikiTitle", () => {
  it("replaces what a file name cannot hold and trims", () => {
    expect(cleanWikiTitle("  A/B: C?  ")).toBe("A-B- C-");
    expect(cleanWikiTitle("Nota [x] #1")).toBe("Nota -x- -1");
  });

  it("refuses empty, dot-only and over-long titles", () => {
    expect(cleanWikiTitle("")).toBeNull();
    expect(cleanWikiTitle("...")).toBeNull();
    expect(cleanWikiTitle("x".repeat(121))).toBeNull();
    expect(cleanWikiTitle(3)).toBeNull();
  });
});

describe("createWikiResolver", () => {
  const pages = [
    { id: "root", title: "Roadmap", folder: "" },
    { id: "deep", title: "Roadmap", folder: "Clients/Acme" },
    { id: "meeting", title: "Meeting 1", folder: "Clients/Acme" },
    { id: "alias", title: "Onboarding", folder: "HR", aliases: ["Welcome", "Entrada"] },
    { id: "accent", title: "Ação", folder: "" },
  ];
  const resolve = createWikiResolver(pages);

  it("finds a page by its bare name, ignoring case and accents in the key", () => {
    expect(resolve("meeting 1")).toBe("meeting");
    expect(resolve("AÇÃO")).toBe("accent");
    expect(resolve("Ação.md")).toBe("accent");
  });

  it("prefers the page nearest to the one that links", () => {
    expect(resolve("Roadmap", "Clients/Acme")).toBe("deep");
    expect(resolve("Roadmap", "")).toBe("root");
    expect(resolve("Roadmap", "HR")).toBe("root");
  });

  it("matches a path or the tail of a path", () => {
    expect(resolve("Clients/Acme/Roadmap")).toBe("deep");
    expect(resolve("Acme/Roadmap")).toBe("deep");
    expect(resolve("Other/Roadmap")).toBeNull();
  });

  it("counts aliases and returns null when nothing matches", () => {
    expect(resolve("welcome")).toBe("alias");
    expect(resolve("Missing")).toBeNull();
    expect(resolve("   ")).toBeNull();
  });
});

describe("a page written to stall the parser", () => {
  const runsOfBackticks = (size: number) => {
    let text = "";
    for (let length = 1; text.length < size; length += 1) text += `${"`".repeat(length)} `;
    return text;
  };
  const KIB = 1024;
  const hostile: Array<[string, string]> = [
    ["open brackets", "[".repeat(64 * KIB)],
    ["open links", "[[".repeat(32 * KIB)],
    ["open embeds", "![[".repeat(21_845)],
    ["open images", "![".repeat(32 * KIB)],
    ["open aliases", "[[a|".repeat(16 * KIB)],
    ["open web links", "[a](".repeat(13_107)],
    ["brackets one to a line", "[\n".repeat(32 * KIB)],
    ["spaces after an image start", `![a](${" ".repeat(64 * KIB)}`],
    ["backtick runs that never pair", runsOfBackticks(512 * KIB)],
    ["front matter that never ends", `---\n${"key: value\n".repeat(46_000)}`],
    ["tags", "#a ".repeat(170_000)],
  ];

  it.each(hostile)("analyses %s in well under a second", (_name, content) => {
    const started = performance.now();
    const analysis = analyzeWikiPage(content);
    expect(performance.now() - started).toBeLessThan(1_000);
    expect(analysis.excerpt.length).toBeLessThanOrEqual(200);
  });

  it("still takes the excerpt from the start of a long page", () => {
    const analysis = analyzeWikiPage(`# Plan\n\nThe [[Refund policy|refund rules]] come first.\n\n${"filler words ".repeat(20_000)}`);
    expect(analysis.excerpt.startsWith("Plan The refund rules come first.")).toBe(true);
  });

  it("keeps the links and pictures of a long page whatever comes before them", () => {
    const content = `${"[".repeat(10_000)}\n\nSee [[Pricing]] and ![[logo.png]] and ![chart](charts/q4.png).\n`;
    const analysis = analyzeWikiPage(content);
    expect(analysis.links).toEqual(["Pricing"]);
    expect(analysis.embeds).toEqual(["logo.png"]);
    expect(analysis.images).toEqual(["charts/q4.png"]);
  });
});
