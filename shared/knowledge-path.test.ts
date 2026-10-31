import { describe, expect, it } from "vitest";

import { breadcrumbOf, DEPTH_MAX, extensionOf, foldKey, hasUnsafeCharacter, isInside, joinPath, matchesFolded, nameOf, parentOf, parsePath, PATH_MAX, replaceUnsafe, SEGMENT_MAX, stemOf } from "./knowledge-path.ts";

const ok = (input: string) => {
  const parsed = parsePath(input);
  if (!parsed.ok) throw new Error(`expected ${JSON.stringify(input)} to parse, got ${parsed.problem}`);
  return parsed;
};

describe("parsePath", () => {
  it("keeps plain names and joins them with single slashes", () => {
    expect(ok("Reports/2026/summary.md")).toMatchObject({ path: "Reports/2026/summary.md", segments: ["Reports", "2026", "summary.md"] });
  });

  it("drops empty segments and surrounding spaces instead of failing", () => {
    expect(ok("/a//b/ c ///d.txt/").path).toBe("a/b/c/d.txt");
  });

  it("normalises to NFC so one name has one spelling", () => {
    expect(ok("café.txt").path).toBe("café.txt");
  });

  it.each(["..", "../secret", "a/../b", "a/./b", ".", "a/...", "a/../../etc/passwd"])("refuses traversal in %s", (input) => {
    expect(parsePath(input)).toEqual({ ok: false, problem: "dot" });
  });

  it.each(["a\\b", "..\\..\\windows", "a/b\\c"])("refuses a backslash in %s", (input) => {
    expect(parsePath(input)).toEqual({ ok: false, problem: "character" });
  });

  it.each(["a\u0000b", "a\nb", "a\tb", "a\u007fb", "a​b", "a‮b.txt", "a⁦b", "a﻿b", "a b", "a\ud800b"])("refuses hidden or direction-changing characters in %j", (input) => {
    expect(parsePath(input)).toEqual({ ok: false, problem: "character" });
  });

  it("refuses non-text and empty paths unless the root is allowed", () => {
    expect(parsePath(undefined)).toEqual({ ok: false, problem: "type" });
    expect(parsePath(7)).toEqual({ ok: false, problem: "type" });
    expect(parsePath("")).toEqual({ ok: false, problem: "empty" });
    expect(parsePath(" / ")).toEqual({ ok: false, problem: "empty" });
    expect(parsePath("", { allowRoot: true })).toEqual({ ok: true, path: "", segments: [] });
  });

  it("caps the length of a name, the depth and the whole path", () => {
    expect(parsePath("a".repeat(SEGMENT_MAX)).ok).toBe(true);
    expect(parsePath("a".repeat(SEGMENT_MAX + 1))).toEqual({ ok: false, problem: "segment-length" });
    expect(parsePath(Array.from({ length: DEPTH_MAX }, () => "d").join("/")).ok).toBe(true);
    expect(parsePath(Array.from({ length: DEPTH_MAX + 1 }, () => "d").join("/"))).toEqual({ ok: false, problem: "depth" });
    const long = Array.from({ length: 8 }, () => "n".repeat(SEGMENT_MAX)).join("/");
    expect(long.length).toBeGreaterThan(PATH_MAX);
    expect(parsePath(long)).toEqual({ ok: false, problem: "length" });
  });

  it("counts a name in characters, not UTF-16 units", () => {
    expect(parsePath("\u{1F600}".repeat(SEGMENT_MAX)).ok).toBe(true);
  });
});

describe("path helpers", () => {
  it("splits names, parents, stems and extensions", () => {
    expect(nameOf("a/b/c.tar.gz")).toBe("c.tar.gz");
    expect(parentOf("a/b/c.txt")).toBe("a/b");
    expect(parentOf("c.txt")).toBe("");
    expect(joinPath("", "x")).toBe("x");
    expect(joinPath("a", "x")).toBe("a/x");
    expect(extensionOf("Photo.JPG")).toBe("jpg");
    expect(extensionOf(".env")).toBe("");
    expect(extensionOf("noext")).toBe("");
    expect(stemOf("a.b.md")).toBe("a.b");
    expect(stemOf(".hidden")).toBe(".hidden");
  });

  it("compares names without caring for case or accents in searches", () => {
    expect(foldKey("Relatório")).toBe(foldKey("RELATÓRIO"));
    expect(matchesFolded("Relatório Mensal", "relatorio")).toBe(true);
    expect(matchesFolded("Relatório Mensal", "mensais")).toBe(false);
  });

  it("knows what sits inside a folder, case-insensitively and only on whole names", () => {
    expect(isInside("Docs", "docs/a.md")).toBe(true);
    expect(isInside("Docs", "Docs")).toBe(true);
    expect(isInside("Docs", "Docs2/a.md")).toBe(false);
    expect(isInside("", "anything")).toBe(true);
  });

  it("builds a breadcrumb that keeps the full path of each step", () => {
    expect(breadcrumbOf("a/b/c")).toEqual([
      { name: "a", path: "a" },
      { name: "b", path: "a/b" },
      { name: "c", path: "a/b/c" },
    ]);
    expect(breadcrumbOf("")).toEqual([]);
  });

  it("flags and replaces unsafe characters", () => {
    expect(hasUnsafeCharacter("plain é text")).toBe(false);
    expect(hasUnsafeCharacter("a\u0007b")).toBe(true);
    expect(replaceUnsafe("a\u0007b‮c", "-")).toBe("a-b-c");
  });
});
