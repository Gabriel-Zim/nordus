import { createHash } from "node:crypto";
import { constants, createReadStream, lstatSync, mkdirSync, realpathSync, unlinkSync } from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";

import { KnowledgeError } from "./errors.ts";

const BLOCKED = "something in your working folder is in the way of the copy";
const NAME_MAX = 100;
const NAME_KEPT = /[^\p{L}\p{N}._ ()-]/gu;

/** `drive-<8 hex of the Drive path>-<file name>`: the same Drive file always lands on the same name, and two files that share a name do not meet. */
function copyName(drivePath: string): string {
  const base = drivePath.split("/").pop() ?? "";
  const clean = base.replace(NAME_KEPT, "_").replace(/^\.+/, "_");
  const dot = clean.lastIndexOf(".");
  const stem = dot > 0 ? clean.slice(0, dot) : clean;
  const extension = dot > 0 ? clean.slice(dot, dot + 16) : "";
  const kept = `${stem.slice(0, NAME_MAX)}${extension}` || "file";
  return `drive-${createHash("sha256").update(drivePath).digest("hex").slice(0, 8)}-${kept}`;
}

/**
 * The agent owns its working folder and may plant a link in it at any moment, so the copy is one plain file straight in
 * that folder: no folder is walked, so there is none to swap for a link between a check and the write. A link at the
 * file's own name is replaced, and the write refuses to follow one that appears in the meantime.
 */
export async function copyIntoWorkspace(workspace: string, drivePath: string, blobFile: string): Promise<string> {
  mkdirSync(workspace, { recursive: true, mode: 0o700 });
  const target = join(realpathSync(workspace), copyName(drivePath));
  try {
    const existing = lstatSync(target, { throwIfNoEntry: false });
    if (existing) {
      if (!existing.isFile() && !existing.isSymbolicLink()) throw new KnowledgeError("bad_input", BLOCKED);
      unlinkSync(target);
    }
  } catch (error) {
    throw error instanceof KnowledgeError ? error : new KnowledgeError("bad_input", BLOCKED);
  }
  let handle;
  try {
    handle = await open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
  } catch {
    throw new KnowledgeError("bad_input", BLOCKED);
  }
  try {
    await handle.writeFile(createReadStream(blobFile));
  } finally {
    await handle.close();
  }
  return target;
}
