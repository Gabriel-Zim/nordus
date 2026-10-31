import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe("who asks the server for the session", () => {
  it("is src/lib/session.ts alone; everyone else goes through sessionOnce", () => {
    const root = join(process.cwd(), "src");
    const offenders = sources(root)
      .map((path) => relative(root, path))
      .filter((path) => path !== join("lib", "session.ts") && !/\.test\.tsx?$/.test(path))
      .filter((path) => readFileSync(join(root, path), "utf8").includes("/api/auth/session\""));
    expect(offenders).toEqual([]);
  });
});
