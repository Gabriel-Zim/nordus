import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { BlobStore } from "./blob-store.ts";
import { isKnowledgeError } from "./errors.ts";
import { DEFAULT_KNOWLEDGE_LIMITS, type KnowledgeLimits } from "./limits.ts";
import { ana, beto, gerentedeoperacao } from "./testing.ts";
import { currentVersion, WikiStore } from "./wiki-store.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wiki-store-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const open = (limits: Partial<KnowledgeLimits> = {}) => {
  const blobs = new BlobStore(dir);
  return { blobs, wiki: new WikiStore(join(dir, "wiki.json"), blobs, { ...DEFAULT_KNOWLEDGE_LIMITS, ...limits }) };
};

const fails = (run: () => unknown, code: string) => {
  try {
    run();
  } catch (error) {
    expect(isKnowledgeError(error) && error.code).toBe(code);
    return;
  }
  throw new Error(`expected ${code}`);
};

const everyone = () => true;
const hides = (id: string) => (actor: { kind: string; id?: string }) => actor.kind === "person" || actor.id !== id;

describe("WikiStore: pages and versions", () => {
  it("creates a page and keeps the front matter exactly as written", () => {
    const { wiki } = open();
    const content = "---\ntitle: Plan\ntags: [alpha]\n---\n# Plan\nBody with [[Other]]\n";
    const saved = wiki.createPage({ title: "Plan", folder: "Company", content, actor: ana, summary: "first" }, everyone);
    expect(saved.outcome).toBe("created");
    expect(wiki.content(saved.page)).toBe(content);
    expect(saved.page.analysis.tags).toEqual(["alpha"]);
    expect(saved.page.analysis.links).toEqual(["Other"]);
    expect(currentVersion(saved.page)).toMatchObject({ n: 1, title: "Plan", folder: "Company", summary: "first" });
  });

  it("saves a new version on every change, attributes it, and ignores a save with the same text", () => {
    const { wiki } = open();
    const created = wiki.createPage({ title: "P", content: "one", actor: ana }, everyone);
    const updated = wiki.update(created.page.id, { content: "two", summary: "edit" }, gerentedeoperacao);
    expect(updated.outcome).toBe("updated");
    expect(wiki.versions(created.page.id, everyone).map((version) => [version.n, version.by.name])).toEqual([[2, "GerenteDeOperacao"], [1, "Ana"]]);
    expect(wiki.update(created.page.id, { content: "two" }, ana).outcome).toBe("unchanged");
    expect(wiki.versions(created.page.id, everyone)).toHaveLength(2);
  });

  it("refuses a save made on an older version, so two editors do not overwrite each other", () => {
    const { wiki } = open();
    const { page } = wiki.createPage({ title: "P", content: "one", actor: ana }, everyone);
    wiki.update(page.id, { content: "two", expectedVersion: 1 }, ana);
    try {
      wiki.update(page.id, { content: "mine", expectedVersion: 1 }, beto);
      throw new Error("expected a conflict");
    } catch (error) {
      expect(isKnowledgeError(error) && error.code).toBe("conflict");
      expect(isKnowledgeError(error) && error.detail).toEqual({ currentVersion: 2 });
    }
    expect(wiki.content(page)).toBe("two");
  });

  it("restores an old version as a new one", () => {
    const { wiki } = open();
    const { page } = wiki.createPage({ title: "P", content: "one", actor: ana }, everyone);
    wiki.update(page.id, { content: "two" }, ana);
    const restored = wiki.restoreVersion(page.id, 1, beto);
    expect(wiki.content(restored.page)).toBe("one");
    expect(restored.page.versions.map((version) => version.n)).toEqual([1, 2, 3]);
    expect(currentVersion(restored.page)).toMatchObject({ summary: "restore:1" });
    expect(wiki.restoreVersion(page.id, 3, ana).outcome).toBe("unchanged");
    fails(() => wiki.restoreVersion(page.id, 9, ana), "not_found");
  });

  it("allows the same title in different folders, never twice in one, whatever the capital letters", () => {
    const { wiki } = open();
    wiki.createPage({ title: "Notes", content: "", actor: ana }, everyone);
    wiki.createPage({ title: "Notes", folder: "Clients", content: "", actor: ana }, everyone);
    fails(() => wiki.createPage({ title: "NOTES", content: "", actor: ana }, everyone), "title_taken");
    expect(wiki.createPage({ title: "x", folder: "clients/Sub", content: "", actor: ana }, everyone).page.folder).toBe("Clients/Sub");
  });

  it("renames a page and lets old links keep working through its former title", () => {
    const { wiki } = open();
    const target = wiki.createPage({ title: "Old name", content: "", actor: ana }, everyone).page;
    const source = wiki.createPage({ title: "Source", content: "see [[Old name]]", actor: ana }, everyone).page;
    wiki.update(target.id, { title: "New name" }, ana);
    expect(target.formerTitles).toEqual(["Old name"]);
    expect(wiki.resolve("Old name", everyone)?.id).toBe(target.id);
    expect(wiki.backlinks(target.id, everyone).map((link) => link.page.id)).toEqual([source.id]);
    fails(() => wiki.update(source.id, { title: "new NAME" }, ana), "title_taken");
  });

  it("writes by title: creates the page, then saves new versions of it", () => {
    const { wiki } = open();
    const first = wiki.write({ title: "Daily", content: "a", actor: gerentedeoperacao }, everyone);
    const second = wiki.write({ title: "daily", content: "b", actor: gerentedeoperacao }, everyone);
    expect([first.outcome, second.outcome]).toEqual(["created", "updated"]);
    expect(first.page.id).toBe(second.page.id);
    expect(wiki.findByTitle("DAILY", everyone)?.id).toBe(first.page.id);
    expect(wiki.findByTitle("Missing", everyone)).toBeNull();
  });

  it("rejects bad titles, folders and content, and pages over the size or count allowed", () => {
    const { wiki } = open({ wikiPageMaxBytes: 20, wikiMaxPages: 2 });
    fails(() => wiki.write({ title: "", content: "", actor: ana }, everyone), "bad_title");
    fails(() => wiki.write({ title: "..", content: "", actor: ana }, everyone), "bad_title");
    fails(() => wiki.write({ title: "ok", folder: "../x", content: "", actor: ana }, everyone), "bad_path");
    fails(() => wiki.write({ title: "ok", content: "has\u0000nul", actor: ana }, everyone), "bad_input");
    fails(() => wiki.write({ title: "ok", content: "x".repeat(21), actor: ana }, everyone), "too_large");
    fails(() => wiki.write({ title: "ok", content: 5 as unknown as string, actor: ana }, everyone), "bad_input");
    wiki.write({ title: "one", content: "", actor: ana }, everyone);
    wiki.write({ title: "two", content: "", actor: ana }, everyone);
    fails(() => wiki.write({ title: "three", content: "", actor: ana }, everyone), "limit");
    expect(wiki.write({ title: "one", content: "changed", actor: ana }, everyone).outcome).toBe("updated");
  });

  it("cleans a title the way a file name needs", () => {
    const { wiki } = open();
    expect(wiki.write({ title: "A/B: C?", content: "", actor: ana }, everyone).page.title).toBe("A-B- C-");
  });

  it("moves a deleted page to the trash and brings it back unless its place was taken", () => {
    const { wiki } = open();
    const { page } = wiki.createPage({ title: "Gone", content: "x", actor: ana }, everyone);
    wiki.remove(page.id, beto, () => true);
    fails(() => wiki.get(page.id), "not_found");
    expect(wiki.trashed(everyone).map((entry) => entry.id)).toEqual([page.id]);
    wiki.write({ title: "Gone", content: "new", actor: ana }, everyone);
    fails(() => wiki.restoreFromTrash(page.id), "title_taken");
    wiki.remove(wiki.findByTitle("Gone")!.id, ana, () => true);
    expect(wiki.purge(wiki.expiredTrash(Date.now() + 31 * 86_400_000))).toBe(2);
    expect(wiki.referenced().size).toBe(0);
    fails(() => wiki.remove("nope", ana, () => true), "not_found");
  });

  it("deletes only what the caller may delete", () => {
    const { wiki } = open();
    const { page } = wiki.createPage({ title: "Mine", content: "", actor: ana }, everyone);
    fails(() => wiki.remove(page.id, beto, () => false), "forbidden");
    expect(wiki.count()).toBe(1);
  });
});

describe("WikiStore: links, backlinks and the graph", () => {
  const build = () => {
    const ctx = open();
    const write = (title: string, content: string, folder = "", actor = ana) => ctx.wiki.write({ title, folder, content, actor }, everyone).page;
    const hub = write("Hub", "Links: [[Alpha]], [[Beta|the beta]], [[Gamma#Part]] and [[Missing]].");
    const alpha = write("Alpha", "Back to [[Hub]]. Also ![[diagram.png]] and [[Hub]] again.");
    const beta = write("Beta", "No links.", "Deep/Folder");
    const gamma = write("Gamma", "---\naliases: [G]\n---\nSee [[G]] and [[Deep/Folder/Beta]].");
    return { ...ctx, hub, alpha, beta, gamma };
  };

  it("finds backlinks for all three link forms, once per page, with the line that links", () => {
    const { wiki, hub, alpha, beta, gamma } = build();
    expect(wiki.backlinks(alpha.id, everyone).map((link) => [link.page.title, link.context])).toEqual([["Hub", "Links: [[Alpha]], [[Beta|the beta]], [[Gamma#Part]] and [[Missing]]."]]);
    expect(wiki.backlinks(beta.id, everyone).map((link) => link.page.title)).toEqual(["Gamma", "Hub"]);
    expect(wiki.backlinks(gamma.id, everyone).map((link) => link.page.title)).toEqual(["Hub"]);
    expect(wiki.backlinks(hub.id, everyone).map((link) => link.page.title)).toEqual(["Alpha"]);
  });

  it("says which links of a page lead somewhere and which lead nowhere yet", () => {
    const { wiki, hub, alpha } = build();
    expect(wiki.linkMap(hub, everyone)).toEqual({ Alpha: alpha.id, Beta: wiki.findByTitle("Beta")!.id, Gamma: wiki.findByTitle("Gamma")!.id, Missing: null });
    expect(wiki.linkMap(alpha, everyone)["diagram.png"]).toBeNull();
  });

  it("counts the links written in imported pages", () => {
    const { wiki, hub, gamma } = build();
    expect(wiki.countLinks(new Set([hub.id, gamma.id]))).toEqual({ resolved: 5, missing: 1 });
  });

  it("draws the graph with one edge per link and the busiest pages first", () => {
    const { wiki, hub } = build();
    const graph = wiki.graph(everyone);
    expect(graph.truncated).toBe(false);
    expect(graph.nodes[0]!.id).toBe(hub.id);
    expect(graph.nodes.find((node) => node.id === hub.id)!.degree).toBe(3);
    expect(graph.edges).toHaveLength(5);
    expect(wiki.graph(everyone, 2)).toMatchObject({ truncated: true, nodes: expect.any(Array) });
    expect(wiki.graph(everyone, 2).nodes).toHaveLength(2);
  });

  it("leaves a hidden page out of lists, searches, links, backlinks and the graph", () => {
    const { wiki, alpha } = build();
    const secret = wiki.write({ title: "Secret", content: "Mentions [[Alpha]] and the word pineapple.", actor: gerentedeoperacao }, everyone).page;
    wiki.write({ title: "Public", content: "Mentions [[Secret]].", actor: ana }, everyone);
    const asker = hides("gerentedeoperacao");
    expect(wiki.list(asker).map((page) => page.title)).not.toContain("Secret");
    expect(wiki.search("pineapple", asker)).toEqual([]);
    expect(wiki.search("pineapple", everyone)).toHaveLength(1);
    expect(wiki.backlinks(alpha.id, asker).map((link) => link.page.title)).toEqual(["Hub"]);
    expect(wiki.resolve("Secret", asker)).toBeNull();
    expect(wiki.linkMap(wiki.findByTitle("Public")!, asker)).toEqual({ Secret: null });
    expect(wiki.graph(asker).nodes.map((node) => node.title)).not.toContain("Secret");
    expect(wiki.graph(asker).edges.every((edge) => edge.source !== secret.id && edge.target !== secret.id)).toBe(true);
    expect(wiki.folders(asker)).toEqual(["Deep", "Deep/Folder"]);
    fails(() => wiki.get(secret.id, asker), "not_found");
    fails(() => wiki.update(secret.id, { content: "x" }, ana, asker), "not_found");
    fails(() => wiki.write({ title: "Secret", content: "mine", actor: ana }, asker), "bad_title");
  });

  it("does not follow a link to a page of the same name that the asker cannot see", () => {
    const { wiki } = open();
    wiki.write({ title: "Plan", content: "hidden plan", actor: gerentedeoperacao }, everyone);
    const visible = wiki.write({ title: "Plan", folder: "Team", content: "visible plan", actor: ana }, everyone).page;
    const source = wiki.write({ title: "Source", content: "[[Plan]]", actor: ana }, everyone).page;
    expect(wiki.linkMap(source, hides("gerentedeoperacao"))).toEqual({ Plan: visible.id });
  });
});

describe("WikiStore: search, tags and folders", () => {
  it("ranks a title match above a tag, above the text, and needs every word", () => {
    const { wiki } = open();
    wiki.write({ title: "Pricing", content: "how we charge", actor: ana }, everyone);
    wiki.write({ title: "Handbook", content: "Our pricing rules live here. Pricing again.", actor: ana }, everyone);
    wiki.write({ title: "Sales", content: "#pricing is a tag here", actor: ana }, everyone);
    wiki.write({ title: "Other", content: "nothing", actor: ana }, everyone);
    expect(wiki.search("pricing", everyone).map((hit) => hit.page.title)).toEqual(["Pricing", "Sales", "Handbook"]);
    expect(wiki.search("pricing charge", everyone).map((hit) => hit.page.title)).toEqual(["Pricing"]);
    expect(wiki.search("pricing nothing", everyone)).toEqual([]);
    expect(wiki.search("  ", everyone)).toEqual([]);
  });

  it("matches without caring for capitals or accents and quotes the line that matched", () => {
    const { wiki } = open();
    wiki.write({ title: "Reunião", content: "# Ata\n\nDecidimos o orçamento de ação.\n\nOutra linha.", actor: ana }, everyone);
    const [hit] = wiki.search("ORCAMENTO acao", everyone);
    expect(hit!.page.title).toBe("Reunião");
    expect(hit!.snippet).toBe("Decidimos o orçamento de ação.");
  });

  it("lists pages by folder (and the folders under it) or by tag, and counts tags", () => {
    const { wiki } = open();
    wiki.write({ title: "A", folder: "Team", content: "#ops", actor: ana }, everyone);
    wiki.write({ title: "B", folder: "Team/Sub", content: "#ops #hr", actor: ana }, everyone);
    wiki.write({ title: "C", content: "---\ntags: [hr]\n---\n", actor: ana }, everyone);
    expect(wiki.list(everyone, { folder: "team" }).map((page) => page.title).sort()).toEqual(["A", "B"]);
    expect(wiki.list(everyone, { folder: "Team/Sub" }).map((page) => page.title)).toEqual(["B"]);
    expect(wiki.list(everyone, { tag: "#HR" }).map((page) => page.title).sort()).toEqual(["B", "C"]);
    expect(wiki.tags(everyone)).toEqual([{ tag: "hr", count: 2 }, { tag: "ops", count: 2 }]);
    expect(wiki.folders(everyone)).toEqual(["Team", "Team/Sub"]);
  });

  it("writes many pages with one save, reporting the ones that could not go in", () => {
    const { wiki } = open();
    const results = wiki.writeMany(
      [
        { title: "One", content: "1", actor: ana },
        { title: "", content: "2", actor: ana },
        { title: "Three", folder: "../no", content: "3", actor: ana },
        { title: "One", content: "1", actor: ana },
      ],
      everyone,
    );
    expect(results.map((result) => (result.ok ? result.saved.outcome : result.error.code))).toEqual(["created", "bad_title", "bad_path", "unchanged"]);
    expect(new WikiStore(join(dir, "wiki.json"), new BlobStore(dir), DEFAULT_KNOWLEDGE_LIMITS).count()).toBe(1);
  });
});

describe("WikiStore: the index on disk", () => {
  it("comes back the same, including versions and former titles", () => {
    const first = open();
    const { page } = first.wiki.write({ title: "A", content: "one", actor: ana }, everyone);
    first.wiki.update(page.id, { title: "B", content: "two" }, gerentedeoperacao);
    const again = new WikiStore(join(dir, "wiki.json"), first.blobs, DEFAULT_KNOWLEDGE_LIMITS);
    const loaded = again.get(page.id);
    expect(loaded.title).toBe("B");
    expect(loaded.formerTitles).toEqual(["A"]);
    expect(again.versions(page.id, everyone)).toHaveLength(2);
    expect(again.content(loaded)).toBe("two");
  });

  it("refuses to start over a damaged index instead of replacing it", () => {
    const file = join(dir, "wiki.json");
    writeFileSync(file, "garbage");
    expect(() => new WikiStore(file, new BlobStore(dir), DEFAULT_KNOWLEDGE_LIMITS)).toThrow(/could not be read/);
    expect(readFileSync(file, "utf8")).toBe("garbage");
  });
});

describe("WikiStore: a page written to stall the server", () => {
  it("saves a full-size page of open brackets without the writer waiting on it", () => {
    const { wiki } = open();
    const content = "[".repeat(64 * 1024);
    const started = performance.now();
    const created = wiki.createPage({ title: "Brackets", folder: "", content, actor: ana }, everyone);
    expect(performance.now() - started).toBeLessThan(1_000);
    expect(created.page.analysis.excerpt.length).toBeLessThanOrEqual(200);
    const started2 = performance.now();
    wiki.update(created.page.id, { content: `${content}[[` }, beto, everyone);
    expect(performance.now() - started2).toBeLessThan(1_000);
  });
});
