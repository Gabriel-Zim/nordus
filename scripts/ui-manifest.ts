import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

export const UI_MANIFEST_FILE = "ui-manifest.json";

export type UiManifestFile = { path: string; size: number; sha256: string };
export type UiManifest = { format: 1; build: string; files: UiManifestFile[] };

/** What the Mac shell downloads and verifies: every built file, keyed to the build the page itself announces. */
export function buildUiManifest(dir: string): UiManifest {
  const build = /<meta name="nordus-build" content="([\w-]+)"/.exec(readFileSync(path.join(dir, "index.html"), "utf8"))?.[1];
  if (!build) throw new Error(`${path.join(dir, "index.html")} has no <meta name="nordus-build">`);
  const files = readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"))
    .filter((relative) => relative !== UI_MANIFEST_FILE)
    // Code-unit order, so any reader can reproduce it without locale rules.
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((relative) => {
      const data = readFileSync(path.join(dir, relative));
      return { path: relative, size: data.length, sha256: createHash("sha256").update(data).digest("hex") };
    });
  return { format: 1, build, files };
}
