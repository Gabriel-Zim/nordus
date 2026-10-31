import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

import { isKnowledgeError } from "./errors.ts";
import type { KnowledgeSession } from "./service.ts";
import { admin, beto, chunksOf, diskOf, isolated, member, tempService } from "./testing.ts";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

const setup = (limits: Parameters<typeof tempService>[0] = {}, who = admin(isolated)) => {
  const made = tempService(limits);
  cleanups.push(made.cleanup);
  const session = made.service.use(who, "internal");
  const imports = made.service.imports;
  const started = imports.start(session.space, session.who, "My Vault");
  const add = (path: string, content: string | Uint8Array, declared?: number) => imports.addFile(session.space, session.who, started.session, path, chunksOf(content), declared);
  const finish = () => imports.finish(session.space, session.who, started.session);
  return { ...made, session, imports, started, add, finish };
};

const codeOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return isKnowledgeError(error) ? error.code : "other";
  }
  return undefined;
};

async function fillVault(add: ReturnType<typeof setup>["add"]) {
  await add("Home.md", "---\ntags: [index]\naliases: [Start]\n---\n# Home\nSee [[Projects/Alpha]], [[Beta|the second]], [[Gamma#Part]] and [[Ghost]].\n![[logo.png]]\n");
  await add("Projects/Alpha.md", "Alpha links back to [[Home]] and [[Start]].\n");
  await add("Beta.md", "");
  await add("Deep/Er/Gamma.md", "Gamma #deep");
  await add("attachments/logo.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));
  await add("attachments/doc.pdf", "%PDF-1.4 pretend");
}

describe("Obsidian folder import", () => {
  it("brings pages in with their folders and keeps what is written in them", async () => {
    const ctx = setup();
    await fillVault(ctx.add);
    const { session } = ctx;
    const summary = await ctx.finish();
    expect(summary).toMatchObject({ root: "My Vault", pages: { created: 4, updated: 0, unchanged: 0 }, attachments: { created: 2, updated: 0, unchanged: 0 }, skipped: [], skippedCount: 0 });
    const wiki = session.wiki;
    const home = wiki.pageByTitle("Home")!;
    expect(home.content).toContain("---\ntags: [index]\naliases: [Start]\n---\n# Home");
    expect(home.tags).toEqual(["index"]);
    expect(home.aliases).toEqual(["Start"]);
    expect(wiki.pageByTitle("Alpha")).toMatchObject({ folder: "Projects" });
    expect(wiki.pageByTitle("Gamma")).toMatchObject({ folder: "Deep/Er", tags: ["deep"] });
    expect(wiki.pageByTitle("Beta")).toMatchObject({ content: "" });
  });

  it("links pages by name, wherever they sit, and by alias; links to nothing are counted", async () => {
    const ctx = setup();
    await fillVault(ctx.add);
    const summary = await ctx.finish();
    expect(summary.links).toEqual({ resolved: 5, missing: 1 });
    const home = ctx.session.wiki.pageByTitle("Home")!;
    expect(home.links).toMatchObject({ "Projects/Alpha": expect.any(String), Beta: expect.any(String), Gamma: expect.any(String), Ghost: null });
    const alpha = ctx.session.wiki.pageByTitle("Alpha")!;
    expect(alpha.links).toEqual({ Home: home.id, Start: home.id });
    expect(alpha.backlinks.map((link) => link.title)).toEqual(["Home"]);
    expect(home.backlinks.map((link) => link.title)).toEqual(["Alpha"]);
  });

  it("puts attachments in the Drive under Wiki/anexos and shows them in the pages that embed them", async () => {
    const ctx = setup();
    await fillVault(ctx.add);
    await ctx.finish();
    const drive = ctx.session.drive;
    expect(drive.list("Wiki/anexos/My Vault/attachments").items.map((item) => item.name)).toEqual(["doc.pdf", "logo.png"]);
    expect(drive.info("Wiki/anexos/My Vault/attachments/logo.png").file).toMatchObject({ size: 7, preview: "image", by: { kind: "person" } });
    expect(ctx.session.wiki.pageByTitle("Home")!.files).toEqual({ "logo.png": "Wiki/anexos/My Vault/attachments/logo.png" });
    expect(drive.list("").items.map((item) => item.name)).toEqual(["Wiki"]);
  });

  it("leaves out hidden folders, files that are not text, names it cannot keep and files that are too big, and says why", async () => {
    const ctx = setup({ wikiPageMaxBytes: 50, driveFileMaxBytes: 50 });
    const results = [
      await ctx.add(".obsidian/app.json", "{}"),
      await ctx.add("Notes/.trash/old.md", "x"),
      await ctx.add(".DS_Store", "x"),
      await ctx.add("../escape.md", "x"),
      await ctx.add("bad\\name.md", "x"),
      await ctx.add("Binary.md", new Uint8Array([0xff, 0xfe, 0xfd])),
      await ctx.add("Long.md", "x".repeat(60)),
      await ctx.add("media/big.mov", "x".repeat(60)),
      await ctx.add("Declared.md", "x", 9999),
      await ctx.add("Fine.md", "ok"),
    ];
    expect(results.map((result) => result.skipped ?? "kept")).toEqual(["hidden", "hidden", "hidden", "bad-path", "bad-path", "unsupported", "too-large", "too-large", "too-large", "kept"]);
    const summary = await ctx.finish();
    expect(summary.pages.created).toBe(1);
    expect(summary.skippedCount).toBe(9);
    expect(summary.skipped.map((entry) => entry.reason)).toEqual(["hidden", "hidden", "hidden", "bad-path", "bad-path", "unsupported", "too-large", "too-large", "too-large"]);
    expect(ctx.session.wiki.list({}).pages.map((page) => page.title)).toEqual(["Fine"]);
  });

  it("updates a page and keeps its history when the same vault is imported again", async () => {
    const ctx = setup();
    await fillVault(ctx.add);
    await ctx.finish();
    const again = ctx.imports.start(ctx.session.space, ctx.session.who, "My Vault");
    const send = (path: string, content: string) => ctx.imports.addFile(ctx.session.space, ctx.session.who, again.session, path, chunksOf(content));
    await send("Home.md", "# Home\nrewritten\n");
    await send("Beta.md", "");
    await send("attachments/doc.pdf", "%PDF-1.4 pretend");
    const summary = await ctx.imports.finish(ctx.session.space, ctx.session.who, again.session);
    expect(summary.pages).toEqual({ created: 0, updated: 1, unchanged: 1 });
    expect(summary.attachments).toEqual({ created: 0, updated: 0, unchanged: 1 });
    const versions = ctx.session.wiki.versions(ctx.session.wiki.pageByTitle("Home")!.id);
    expect(versions.map((version) => version.summary)).toEqual(["import:obsidian", "import:obsidian"]);
    expect(versions).toHaveLength(2);
  });

  it("stops at the number of files and at the total size allowed", async () => {
    const files = setup({ importMaxFiles: 2 });
    await files.add("a.md", "1");
    await files.add("b.md", "2");
    expect(await codeOf(files.add("c.md", "3"))).toBe("limit");
    await files.add("a.md", "replaced");
    const kept = await files.finish();
    expect(kept.pages.created).toBe(2);

    const bytes = setup({ importMaxBytes: 12 });
    await bytes.add("a.md", "123456");
    expect(await codeOf(bytes.add("b.md", "1234567"))).toBe("too_large");
    expect(await codeOf(bytes.add("c.md", "x", 100))).toBe("too_large");
    await bytes.add("a.md", "1234567890");
    const small = await bytes.finish();
    expect(small.pages.created).toBe(1);
  });

  it("refuses a file the space has no room for as it arrives, keeps nothing of it, and keeps the import open", async () => {
    const ctx = setup({ spaceMaxBytes: 5 });
    expect(await codeOf(ctx.add("a.md", "123456789"))).toBe("full");
    expect(ctx.imports.pinned()).toEqual([]);
    expect(diskOf(ctx.session.space)).toEqual({ blobs: [], staging: [] });
    expect(await ctx.add("b.md", "1")).toMatchObject({ accepted: true });
    expect(ctx.imports.pinned()).toHaveLength(1);
  });

  it("refuses to save an import whose files fit one by one but not together, and keeps it open", async () => {
    const ctx = setup({ spaceMaxBytes: 10 });
    await ctx.add("a.md", "123456");
    await ctx.add("b.md", "abcdef");
    expect(await codeOf(ctx.finish())).toBe("full");
    expect(await ctx.add("c.md", "1")).toMatchObject({ accepted: true });
    expect(ctx.imports.pinned()).toHaveLength(3);
  });

  it("belongs to the person who started it and to the space it was started in", async () => {
    const ctx = setup();
    await ctx.add("a.md", "1");
    const other: KnowledgeSession = ctx.service.use(member("ana@zorg.test", { kind: "person", name: "Ana", key: "other", email: "ana@zorg.test" }, isolated, ["ana@zorg.test"]), "internal");
    expect(await codeOf(ctx.imports.addFile(other.space, other.who, ctx.started.session, "b.md", chunksOf("x")))).toBe("not_found");
    expect(await codeOf(ctx.imports.finish(other.space, other.who, ctx.started.session))).toBe("not_found");
    expect(() => ctx.imports.cancel(other.space, other.who, ctx.started.session)).toThrow();
    const root = ctx.service.use(admin(isolated), "client:evergreen");
    expect(await codeOf(ctx.imports.finish(root.space, root.who, ctx.started.session))).toBe("not_found");
    ctx.imports.cancel(ctx.session.space, ctx.session.who, ctx.started.session);
    expect(await codeOf(ctx.finish())).toBe("not_found");
    expect(ctx.imports.pinned()).toEqual([]);
  });

  it("saves into the space of the person who imports and nowhere else", async () => {
    const made = tempService();
    cleanups.push(made.cleanup);
    const mine = made.service.use(member("beto@evergreen.test", beto, isolated));
    const started = made.service.imports.start(mine.space, mine.who, "Client vault");
    await made.service.imports.addFile(mine.space, mine.who, started.session, "Client note.md", chunksOf("hello"));
    await made.service.imports.finish(mine.space, mine.who, started.session);
    expect(mine.wiki.list({}).pages.map((page) => page.title)).toEqual(["Client note"]);
    expect(made.service.use(admin(isolated), "internal").wiki.list({}).pages).toEqual([]);
    expect(made.service.use(admin(isolated), "client:evergreen").wiki.list({}).pages).toHaveLength(1);
  });

  it("finishes an import whose notes are written to stall the parser", async () => {
    const ctx = setup();
    await ctx.add("Brackets.md", "[".repeat(64 * 1024));
    await ctx.add("Embeds.md", "![[".repeat(21_000));
    await ctx.add("Fine.md", "See [[Brackets]].");
    const started = performance.now();
    const summary = await ctx.finish();
    expect(performance.now() - started).toBeLessThan(2_000);
    expect(summary.pages.created).toBe(3);
  });

  it("allows a few imports at a time per person and does not let two finish at once", async () => {
    const ctx = setup();
    ctx.imports.start(ctx.session.space, ctx.session.who, "second");
    expect(() => ctx.imports.start(ctx.session.space, ctx.session.who, "third")).toThrow(/finish or cancel/);
    await ctx.add("a.md", "1");
    const first = ctx.finish();
    expect(await codeOf(ctx.finish())).toBe("conflict");
    await first;
  });
});

describe("what an import leaves on disk", () => {
  const shaOf = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");

  it("replaces the staged copy of a path that is sent again, so the old one does not stay", async () => {
    const ctx = setup();
    await ctx.add("a.md", "first version");
    await ctx.add("a.md", "second version");
    expect(diskOf(ctx.session.space).blobs).toEqual([shaOf("second version")]);
    expect(ctx.imports.pinned()).toEqual([shaOf("second version")]);
    await ctx.add("a.md", "second version");
    expect(diskOf(ctx.session.space).blobs).toEqual([shaOf("second version")]);
    const summary = await ctx.finish();
    expect(summary.pages.created).toBe(1);
    expect(ctx.session.wiki.pageByTitle("a")).toMatchObject({ content: "second version" });
  });

  it("removes everything it staged when the person cancels", async () => {
    const ctx = setup();
    await ctx.add("a.md", "one");
    await ctx.add("img/b.png", Buffer.from([1, 2, 3]));
    expect(diskOf(ctx.session.space).blobs).toHaveLength(2);
    ctx.imports.cancel(ctx.session.space, ctx.session.who, ctx.started.session);
    expect(diskOf(ctx.session.space)).toEqual({ blobs: [], staging: [] });
  });

  it("keeps nothing of a file it turns away", async () => {
    const ctx = setup({ importMaxFiles: 1 });
    await ctx.add("Binary.md", new Uint8Array([0xff, 0xfe, 0xfd]));
    expect(diskOf(ctx.session.space).blobs).toEqual([]);
    await ctx.add("a.md", "kept");
    expect(await codeOf(ctx.add("b.md", "one too many"))).toBe("limit");
    expect(diskOf(ctx.session.space).blobs).toEqual([shaOf("kept")]);
  });

  it("keeps nothing of a file that would take the import past its total size", async () => {
    const ctx = setup({ importMaxBytes: 12 });
    await ctx.add("a.md", "123456");
    expect(await codeOf(ctx.add("b.md", "1234567"))).toBe("too_large");
    expect(diskOf(ctx.session.space).blobs).toEqual([shaOf("123456")]);
  });

  it("drops what the space did not keep once the import is saved", async () => {
    const ctx = setup();
    await ctx.session.drive.save("Wiki/anexos/My Vault", Buffer.from("a file in the way"));
    const picture = Buffer.from([9, 8, 7, 6]);
    await ctx.add("pic.png", picture);
    await ctx.add("Note.md", "text");
    const summary = await ctx.finish();
    expect(summary.attachments).toEqual({ created: 0, updated: 0, unchanged: 0 });
    expect(summary.skipped.map((entry) => entry.reason)).toEqual(["conflict"]);
    const disk = diskOf(ctx.session.space);
    expect(disk.blobs).not.toContain(shaOf(picture));
    expect(disk.blobs).toHaveLength(2);
    expect(disk.staging).toEqual([]);
  });

  it("drops an import that sat idle too long, with what it staged", async () => {
    const ctx = setup();
    await ctx.add("a.md", "one");
    ctx.imports.expire(Date.now() + 31 * 60_000);
    expect(ctx.imports.pinned()).toEqual([]);
    expect(diskOf(ctx.session.space).blobs).toEqual([]);
  });

  it("does not take away content another import or the space still holds", async () => {
    const ctx = setup();
    const second = ctx.imports.start(ctx.session.space, ctx.session.who, "Second");
    await ctx.add("shared.md", "same words");
    await ctx.imports.addFile(ctx.session.space, ctx.session.who, second.session, "shared.md", chunksOf("same words"));
    ctx.imports.cancel(ctx.session.space, ctx.session.who, ctx.started.session);
    expect(diskOf(ctx.session.space).blobs).toEqual([shaOf("same words")]);
    await ctx.imports.finish(ctx.session.space, ctx.session.who, second.session);
    expect(ctx.session.wiki.pageByTitle("shared")).toMatchObject({ content: "same words" });

    const third = ctx.imports.start(ctx.session.space, ctx.session.who, "Third");
    await ctx.imports.addFile(ctx.session.space, ctx.session.who, third.session, "shared.md", chunksOf("same words"));
    ctx.imports.cancel(ctx.session.space, ctx.session.who, third.session);
    expect(diskOf(ctx.session.space).blobs).toEqual([shaOf("same words")]);
    expect(ctx.session.wiki.pageByTitle("shared")).toMatchObject({ content: "same words" });
  });
});
