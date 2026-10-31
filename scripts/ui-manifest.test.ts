import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildUiManifest } from "./ui-manifest.ts";

const directories: string[] = [];

function dist(files: Record<string, string>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nordus-ui-manifest-"));
  directories.push(dir);
  for (const [relative, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, relative)), { recursive: true });
    fs.writeFileSync(path.join(dir, relative), content);
  }
  return dir;
}

const sha256 = (content: string) => createHash("sha256").update(content).digest("hex");

afterEach(() => {
  for (const dir of directories.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("buildUiManifest", () => {
  it("lists every file under the build the page announces, sorted, with size and hash", () => {
    const html = '<html><head>\n  <meta name="nordus-build" content="0123abcd4567ef89" />\n  </head></html>';
    const dir = dist({
      "index.html": html,
      "sw.js": "self.skipWaiting();",
      "assets/index-b.js": "console.log('b');",
      "assets/index-a.css": "body{}",
      "brand/logo.svg": "<svg/>",
      "ui-manifest.json": "{\"stale\":true}",
    });

    const manifest = buildUiManifest(dir);

    expect(manifest.format).toBe(1);
    expect(manifest.build).toBe("0123abcd4567ef89");
    expect(manifest.files.map((file) => file.path)).toEqual([
      "assets/index-a.css",
      "assets/index-b.js",
      "brand/logo.svg",
      "index.html",
      "sw.js",
    ]);
    expect(manifest.files.find((file) => file.path === "index.html")).toEqual({
      path: "index.html",
      size: Buffer.byteLength(html),
      sha256: sha256(html),
    });
    expect(manifest.files.find((file) => file.path === "assets/index-b.js")?.sha256).toBe(sha256("console.log('b');"));
  });

  it("refuses a page without the build stamp", () => {
    const dir = dist({ "index.html": "<html><head></head></html>", "sw.js": "" });

    expect(() => buildUiManifest(dir)).toThrow(/nordus-build/);
  });
});
