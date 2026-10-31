import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { isKnowledgeError } from "./errors.ts";
import { copyIntoWorkspace } from "./workspace-copy.ts";

const posixOnly = describe.skipIf(process.platform === "win32");

let root: string;
let workspace: string;
let outside: string;
let blob: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "workspace-copy-"));
  workspace = join(root, "bot-workspace");
  outside = join(root, "outside");
  mkdirSync(workspace);
  mkdirSync(outside);
  blob = join(root, "stored.bin");
  writeFileSync(blob, "the file from the Drive");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

posixOnly("copying a Drive file into an agent's working folder", () => {
  it("puts one plain file straight in the folder, with no subfolder to swap for a link", async () => {
    const copy = await copyIntoWorkspace(workspace, "Reports/2026/summary.csv", blob);
    expect(dirname(copy)).toBe(realpathSync(workspace));
    expect(basename(copy)).toMatch(/^drive-[0-9a-f]{8}-summary\.csv$/);
    expect(readdirSync(workspace)).toEqual([basename(copy)]);
    expect(lstatSync(copy).isFile()).toBe(true);
    expect(readFileSync(copy, "utf8")).toBe("the file from the Drive");
  });

  it("keeps files with the same name from different folders apart, and replaces its own earlier copy", async () => {
    const first = await copyIntoWorkspace(workspace, "A/notes.md", blob);
    const second = await copyIntoWorkspace(workspace, "B/notes.md", blob);
    expect(first).not.toBe(second);
    writeFileSync(blob, "a newer version");
    expect(await copyIntoWorkspace(workspace, "A/notes.md", blob)).toBe(first);
    expect(readFileSync(first, "utf8")).toBe("a newer version");
    expect(readdirSync(workspace)).toHaveLength(2);
  });

  it("never writes through a link planted where the copy goes", async () => {
    const victim = join(outside, "MEMORY.md");
    writeFileSync(victim, "another agent's memory");
    const name = basename(await copyIntoWorkspace(workspace, "notes.md", blob));
    rmSync(join(workspace, name));
    symlinkSync(victim, join(workspace, name));
    const copy = await copyIntoWorkspace(workspace, "notes.md", blob);
    expect(readFileSync(victim, "utf8")).toBe("another agent's memory");
    expect(lstatSync(copy).isSymbolicLink()).toBe(false);
    expect(readFileSync(copy, "utf8")).toBe("the file from the Drive");
  });

  it("is not led out of the folder by a link that looks like a folder", async () => {
    symlinkSync(outside, join(workspace, "drive"));
    const copy = await copyIntoWorkspace(workspace, "Reports/summary.csv", blob);
    expect(readdirSync(outside)).toEqual([]);
    expect(dirname(copy)).toBe(realpathSync(workspace));
  });

  it("says so when a folder sits where the copy goes", async () => {
    const name = basename(await copyIntoWorkspace(workspace, "notes.md", blob));
    rmSync(join(workspace, name));
    mkdirSync(join(workspace, name));
    const refused = await copyIntoWorkspace(workspace, "notes.md", blob).catch((error: unknown) => error);
    expect(isKnowledgeError(refused) && refused.code).toBe("bad_input");
  });

  it("keeps a name that tries to climb as a plain name", async () => {
    const copy = await copyIntoWorkspace(workspace, "..\\..\\etc\\passwd\u0000.txt", blob);
    expect(dirname(copy)).toBe(realpathSync(workspace));
    expect(basename(copy)).not.toMatch(/[\\/]/);
    expect(basename(copy).includes("\u0000")).toBe(false);
  });
});
