import { mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { BlobStore } from "./blob-store.ts";
import { current, DriveStore } from "./drive-store.ts";
import { isKnowledgeError } from "./errors.ts";
import { DEFAULT_KNOWLEDGE_LIMITS, type KnowledgeLimits } from "./limits.ts";
import { ana, beto, chunksOf, gerentedeoperacao } from "./testing.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "drive-store-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const open = (limits: Partial<KnowledgeLimits> = {}) => {
  const blobs = new BlobStore(dir);
  return { blobs, drive: new DriveStore(join(dir, "drive.json"), { ...DEFAULT_KNOWLEDGE_LIMITS, ...limits }) };
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

describe("BlobStore", () => {
  it("stores equal bytes once and reads them back", () => {
    const { blobs } = open();
    const a = blobs.putBuffer(Buffer.from("hello"));
    const b = blobs.putBuffer(Buffer.from("hello"));
    expect(a).toEqual(b);
    expect(a.size).toBe(5);
    expect(blobs.read(a.sha256).toString()).toBe("hello");
    expect(blobs.readHead(a.sha256, 3).toString()).toBe("hel");
    expect(blobs.sizeOf(a.sha256)).toBe(5);
  });

  it("only ever turns a content id into a path, never a typed name", () => {
    const { blobs } = open();
    for (const bad of ["../x", "a".repeat(63), "A".repeat(64), "", "/etc/passwd"]) fails(() => blobs.path(bad), "bad_input");
  });

  it("streams, hashes and refuses what goes over the cap without leaving a partial file", async () => {
    const { blobs } = open();
    const saved = await blobs.putStream(chunksOf("streamed content"), 100);
    expect(blobs.read(saved.sha256).toString()).toBe("streamed content");
    expect(saved.sha256).toBe(blobs.putBuffer(Buffer.from("streamed content")).sha256);
    await expect(blobs.putStream(chunksOf("x".repeat(50)), 10)).rejects.toMatchObject({ code: "too_large" });
    expect(statSync(join(dir, "tmp")).isDirectory()).toBe(true);
    blobs.clearStaging(Date.now() + 3_600_000);
  });

  it("sweeps what nothing points to, but not what is referenced or too young to tell", () => {
    const { blobs } = open();
    const kept = blobs.putBuffer(Buffer.from("kept"));
    const orphan = blobs.putBuffer(Buffer.from("orphan"));
    const young = blobs.putBuffer(Buffer.from("young"));
    const old = new Date(Date.now() - 3_600_000);
    utimesSync(blobs.path(kept.sha256), old, old);
    utimesSync(blobs.path(orphan.sha256), old, old);
    expect(blobs.sweep(new Set([kept.sha256]))).toBe(1);
    expect(blobs.has(orphan.sha256)).toBe(false);
    expect(blobs.has(kept.sha256)).toBe(true);
    expect(blobs.has(young.sha256)).toBe(true);
  });

  it("makes a content that is saved again look young, so a clean-up cannot take it back", () => {
    const { blobs } = open();
    const first = blobs.putBuffer(Buffer.from("again"));
    const old = new Date(Date.now() - 3_600_000);
    utimesSync(blobs.path(first.sha256), old, old);
    blobs.putBuffer(Buffer.from("again"));
    expect(blobs.sweep(new Set())).toBe(0);
  });
});

describe("DriveStore: saving and versions", () => {
  it("creates a file, then keeps the earlier content as a version when the path is saved again", () => {
    const { blobs, drive } = open();
    const first = drive.save({ path: "Reports/q4.md", blob: blobs.putBuffer(Buffer.from("one")), actor: ana });
    expect(first.outcome).toBe("created");
    expect(first.version.n).toBe(1);
    const second = drive.save({ path: "Reports/q4.md", blob: blobs.putBuffer(Buffer.from("two")), actor: gerentedeoperacao, note: "second pass" });
    expect(second.outcome).toBe("updated");
    expect(second.entry.versions.map((version) => [version.n, version.by.kind, version.note])).toEqual([
      [1, "person", undefined],
      [2, "bot", "second pass"],
    ]);
    expect(blobs.read(current(second.entry).sha256).toString()).toBe("two");
    expect(blobs.read(second.entry.versions[0]!.sha256).toString()).toBe("one");
  });

  it("changes nothing when the same bytes are saved again", () => {
    const { blobs, drive } = open();
    const blob = blobs.putBuffer(Buffer.from("same"));
    drive.save({ path: "a.txt", blob, actor: ana });
    const again = drive.save({ path: "a.txt", blob, actor: gerentedeoperacao });
    expect(again.outcome).toBe("unchanged");
    expect(again.entry.versions).toHaveLength(1);
    expect(again.entry.versions[0]!.by.kind).toBe("person");
  });

  it("restores an old version as a new one and leaves the history intact", () => {
    const { blobs, drive } = open();
    for (const text of ["v1", "v2", "v3"]) drive.save({ path: "n.md", blob: blobs.putBuffer(Buffer.from(text)), actor: ana });
    const restored = drive.restoreVersion("n.md", 1, beto);
    expect(restored.outcome).toBe("updated");
    expect(restored.entry.versions.map((version) => version.n)).toEqual([1, 2, 3, 4]);
    expect(blobs.read(current(restored.entry).sha256).toString()).toBe("v1");
    expect(current(restored.entry).by.name).toBe("Beto");
    expect(current(restored.entry).note).toBe("restore:1");
    expect(drive.restoreVersion("n.md", 4, ana).outcome).toBe("unchanged");
    fails(() => drive.restoreVersion("n.md", 99, ana), "not_found");
  });

  it("drops the oldest versions past the cap", () => {
    const { blobs, drive } = open({ maxVersions: 3 });
    let pruned = false;
    for (let i = 1; i <= 5; i += 1) pruned = drive.save({ path: "n.md", blob: blobs.putBuffer(Buffer.from(`v${i}`)), actor: ana }).pruned || pruned;
    expect(pruned).toBe(true);
    expect(drive.find("n.md").versions.map((version) => version.n)).toEqual([3, 4, 5]);
  });

  it("treats names as one regardless of capital letters and keeps the first spelling of a folder", () => {
    const { blobs, drive } = open();
    drive.save({ path: "Docs/Plan.md", blob: blobs.putBuffer(Buffer.from("a")), actor: ana });
    const again = drive.save({ path: "docs/plan.MD", blob: blobs.putBuffer(Buffer.from("b")), actor: ana });
    expect(again.outcome).toBe("updated");
    expect(again.entry.path).toBe("Docs/Plan.md");
    const sibling = drive.save({ path: "DOCS/other.md", blob: blobs.putBuffer(Buffer.from("c")), actor: ana });
    expect(sibling.entry.path).toBe("Docs/other.md");
    expect(drive.listFolder("", () => true).folders.map((folder) => folder.name)).toEqual(["Docs"]);
  });

  it("will not let a file sit where a folder is, or inside a file", () => {
    const { blobs, drive } = open();
    const blob = blobs.putBuffer(Buffer.from("x"));
    drive.save({ path: "a", blob, actor: ana });
    fails(() => drive.save({ path: "a/b.txt", blob, actor: ana }), "path_taken");
    drive.save({ path: "dir/x.txt", blob, actor: ana });
    fails(() => drive.save({ path: "dir", blob, actor: ana }), "path_taken");
    fails(() => drive.createFolder("a", ana), "path_taken");
    fails(() => drive.createFolder("dir/x.txt", ana), "path_taken");
  });

  it("refuses traversal and odd characters before touching anything", () => {
    const { blobs, drive } = open();
    const blob = blobs.putBuffer(Buffer.from("x"));
    for (const path of ["../x", "a/../../x", "a\\b", "a/./b", "..", "", "x\u0000y", "x‮y.txt"]) fails(() => drive.save({ path, blob, actor: ana }), "bad_path");
    expect(drive.count()).toBe(0);
  });

  it("stops at the file count a space may hold", () => {
    const { blobs, drive } = open({ maxFilesPerSpace: 2 });
    const blob = blobs.putBuffer(Buffer.from("x"));
    drive.save({ path: "1", blob, actor: ana });
    drive.save({ path: "2", blob, actor: ana });
    fails(() => drive.save({ path: "3", blob, actor: ana }), "limit");
    expect(drive.save({ path: "1", blob: blobs.putBuffer(Buffer.from("y")), actor: ana }).outcome).toBe("updated");
  });

  it("reports the files of a batch that cannot be saved and saves the rest in one write", () => {
    const { blobs, drive } = open();
    const blob = blobs.putBuffer(Buffer.from("x"));
    drive.save({ path: "taken", blob, actor: ana });
    const results = drive.saveMany(
      [
        { path: "ok/one.txt", blob, actor: ana },
        { path: "taken/inside.txt", blob, actor: ana },
        { path: "../bad", blob, actor: ana },
        { path: "ok/two.txt", blob, actor: ana },
      ],
      () => true,
    );
    expect(results.map((result) => (result.ok ? result.saved.outcome : result.error.code))).toEqual(["created", "path_taken", "bad_path", "created"]);
    expect(new DriveStore(join(dir, "drive.json"), DEFAULT_KNOWLEDGE_LIMITS).count()).toBe(3);
  });
});

describe("DriveStore: folders, moving and the trash", () => {
  it("lists a folder with its sub folders first, counting what is inside them", () => {
    const { blobs, drive } = open();
    const blob = blobs.putBuffer(Buffer.from("x"));
    drive.save({ path: "b.txt", blob, actor: ana });
    drive.save({ path: "a/deep/one.txt", blob, actor: ana });
    drive.save({ path: "a/two.txt", blob, actor: ana });
    drive.createFolder("empty", ana);
    const top = drive.listFolder("", () => true);
    expect(top.folders.map((folder) => [folder.name, folder.items])).toEqual([["a", 2], ["empty", 0]]);
    expect(top.files.map((entry) => entry.path)).toEqual(["b.txt"]);
    const inside = drive.listFolder("A", () => true);
    expect(inside.path).toBe("a");
    expect(inside.folders.map((folder) => folder.path)).toEqual(["a/deep"]);
    fails(() => drive.listFolder("nope", () => true), "not_found");
  });

  it("renames a file, moves a folder with everything in it and refuses what would clash", () => {
    const { blobs, drive } = open();
    const blob = blobs.putBuffer(Buffer.from("x"));
    drive.save({ path: "old/a.txt", blob, actor: ana });
    drive.save({ path: "old/sub/b.txt", blob, actor: ana });
    drive.save({ path: "keep.txt", blob, actor: ana });
    expect(drive.move("keep.txt", "Kept.txt")).toMatchObject({ to: "Kept.txt", moved: 1 });
    fails(() => drive.move("Kept.txt", "old"), "path_taken");
    fails(() => drive.move("old", "old/sub/inside"), "bad_input");
    expect(drive.move("old", "archive/2026")).toMatchObject({ from: "old", to: "archive/2026", moved: 2 });
    expect(drive.find("archive/2026/sub/b.txt").path).toBe("archive/2026/sub/b.txt");
    fails(() => drive.find("old/a.txt"), "not_found");
    expect(drive.move("archive/2026", "archive/2026").moved).toBe(2);
    fails(() => drive.move("missing", "x"), "not_found");
  });

  it("sends a file to the trash with its versions and brings it back", () => {
    const { blobs, drive } = open();
    drive.save({ path: "t.txt", blob: blobs.putBuffer(Buffer.from("1")), actor: ana });
    drive.save({ path: "t.txt", blob: blobs.putBuffer(Buffer.from("2")), actor: ana });
    expect(drive.remove("t.txt", beto, () => true)).toEqual({ trashed: 1 });
    fails(() => drive.find("t.txt"), "not_found");
    const [trashed] = drive.trashed(() => true);
    expect(trashed!.versions).toHaveLength(2);
    expect(trashed!.deleted!.by.name).toBe("Beto");
    drive.save({ path: "t.txt", blob: blobs.putBuffer(Buffer.from("new")), actor: ana });
    fails(() => drive.restoreFromTrash(trashed!.id), "path_taken");
    drive.remove("t.txt", ana, () => true);
    const [latest] = drive.trashed(() => true);
    expect(drive.restoreFromTrash(latest!.id).deleted).toBeUndefined();
  });

  it("deletes only what the caller may delete, a whole folder or nothing", () => {
    const { blobs, drive } = open();
    const blob = blobs.putBuffer(Buffer.from("x"));
    drive.save({ path: "dir/mine.txt", blob, actor: ana });
    drive.save({ path: "dir/bots.txt", blob, actor: gerentedeoperacao });
    const onlyAna = (entry: { createdBy: { kind: string; name: string } }) => entry.createdBy.name === "Ana";
    fails(() => drive.remove("dir/bots.txt", ana, onlyAna), "forbidden");
    fails(() => drive.remove("dir", ana, onlyAna), "forbidden");
    expect(drive.count()).toBe(2);
    expect(drive.remove("dir/mine.txt", ana, onlyAna).trashed).toBe(1);
    expect(drive.remove("dir", ana, () => true).trashed).toBe(1);
    expect(drive.folderExists("dir")).toBe(false);
  });

  it("empties the trash after the time allowed and keeps its contents referenced until then", () => {
    const { blobs, drive } = open({ trashDays: 30 });
    const kept = blobs.putBuffer(Buffer.from("kept"));
    const gone = blobs.putBuffer(Buffer.from("gone"));
    drive.save({ path: "a.txt", blob: kept, actor: ana });
    drive.save({ path: "b.txt", blob: gone, actor: ana });
    drive.remove("b.txt", ana, () => true);
    expect(drive.expiredTrash(Date.now() + 29 * 86_400_000)).toEqual([]);
    expect(drive.referenced().has(gone.sha256)).toBe(true);
    const expired = drive.expiredTrash(Date.now() + 31 * 86_400_000);
    expect(expired).toHaveLength(1);
    expect(drive.purge(expired)).toBe(1);
    expect(drive.referenced().has(gone.sha256)).toBe(false);
    expect(drive.referenced().has(kept.sha256)).toBe(true);
    expect(drive.purge(["not-in-trash"])).toBe(0);
  });
});

describe("DriveStore: who may see what", () => {
  const sees = (hidden: string) => (actor: { kind: string; id?: string }) => actor.kind === "person" || actor.id !== hidden;

  it("lists, finds, searches and opens only files whose authors the asker may see", () => {
    const { blobs, drive } = open();
    const blob = blobs.putBuffer(Buffer.from("x"));
    drive.save({ path: "shared/ana.txt", blob, actor: ana });
    drive.save({ path: "shared/gerentedeoperacao.txt", blob, actor: gerentedeoperacao });
    drive.save({ path: "secret/gerentedeoperacao.txt", blob, actor: gerentedeoperacao });
    const asker = sees("gerentedeoperacao");
    expect(drive.listFolder("shared", asker).files.map((entry) => entry.path)).toEqual(["shared/ana.txt"]);
    expect(drive.listFolder("", asker).folders.map((folder) => folder.name)).toEqual(["shared"]);
    expect(drive.search("gerentedeoperacao", asker)).toEqual([]);
    expect(drive.search("gerentedeoperacao", () => true)).toHaveLength(2);
    fails(() => drive.find("secret/gerentedeoperacao.txt", asker), "not_found");
    expect(drive.lookup("shared/gerentedeoperacao.txt", asker)).toBeNull();
  });

  it("hides a whole file once anyone the asker cannot see has saved a version of it", () => {
    const { blobs, drive } = open();
    drive.save({ path: "f.txt", blob: blobs.putBuffer(Buffer.from("1")), actor: ana });
    drive.save({ path: "f.txt", blob: blobs.putBuffer(Buffer.from("2")), actor: gerentedeoperacao });
    drive.save({ path: "f.txt", blob: blobs.putBuffer(Buffer.from("3")), actor: ana });
    fails(() => drive.find("f.txt", sees("gerentedeoperacao")), "not_found");
  });

  it("refuses the name of a file the asker cannot see like a name that cannot be used, and never reveals it", () => {
    const { blobs, drive } = open();
    drive.save({ path: "hidden.txt", blob: blobs.putBuffer(Buffer.from("secret")), actor: gerentedeoperacao });
    fails(() => drive.save({ path: "hidden.txt", blob: blobs.putBuffer(Buffer.from("mine")), actor: ana }, sees("gerentedeoperacao")), "bad_path");
    fails(() => drive.restoreVersion("hidden.txt", 1, ana, sees("gerentedeoperacao")), "not_found");
    fails(() => drive.move("hidden.txt", "moved.txt", sees("gerentedeoperacao")), "not_found");
    fails(() => drive.remove("hidden.txt", ana, () => true, sees("gerentedeoperacao")), "not_found");
    expect(drive.find("hidden.txt").versions).toHaveLength(1);
  });

  it("finds an embedded picture by name under one folder and skips the ones the asker cannot see", () => {
    const { blobs, drive } = open();
    const blob = blobs.putBuffer(Buffer.from("png"));
    drive.save({ path: "Wiki/anexos/Vault/img/photo.png", blob, actor: ana });
    drive.save({ path: "Wiki/anexos/Other/deeper/dir/photo.png", blob, actor: ana });
    drive.save({ path: "Elsewhere/photo.png", blob, actor: ana });
    drive.save({ path: "Wiki/anexos/Vault/by-bot.png", blob, actor: gerentedeoperacao });
    expect(drive.findAsset("photo.png", "Wiki/anexos", () => true)).toBe("Wiki/anexos/Vault/img/photo.png");
    expect(drive.findAsset("img/photo.png", "Wiki/anexos", () => true)).toBe("Wiki/anexos/Vault/img/photo.png");
    expect(drive.findAsset("by-bot.png", "Wiki/anexos", sees("gerentedeoperacao"))).toBeNull();
    expect(drive.findAsset("nope.png", "Wiki/anexos", () => true)).toBeNull();
  });
});

describe("DriveStore: the index on disk", () => {
  it("comes back the same after a restart", () => {
    const first = open();
    first.drive.save({ path: "a/b.txt", blob: first.blobs.putBuffer(Buffer.from("x")), actor: ana });
    first.drive.createFolder("empty", ana);
    const again = new DriveStore(join(dir, "drive.json"), DEFAULT_KNOWLEDGE_LIMITS);
    expect(again.find("a/b.txt").versions).toHaveLength(1);
    expect(again.folderExists("empty")).toBe(true);
  });

  it("refuses to start over a damaged index instead of replacing it with an empty one", () => {
    const file = join(dir, "drive.json");
    writeFileSync(file, "{ not json");
    expect(() => new DriveStore(file, DEFAULT_KNOWLEDGE_LIMITS)).toThrow(/could not be read/);
    expect(readFileSync(file, "utf8")).toBe("{ not json");
    writeFileSync(file, JSON.stringify({ version: 1 }));
    expect(() => new DriveStore(file, DEFAULT_KNOWLEDGE_LIMITS)).toThrow(/unexpected shape/);
  });
});
