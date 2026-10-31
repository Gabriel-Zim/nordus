import { describe, expect, it } from "vitest";

import type { WikiImportSummary } from "../../shared/knowledge";
import { ApiError } from "@/state/api";
import type { VaultFile } from "./knowledge-ui";
import { runVaultImport, type ImportApi, type ImportProgress } from "./wiki-import";

const summary = (): WikiImportSummary => ({
  root: "Vault", pages: { created: 1, updated: 0, unchanged: 0 }, attachments: { created: 0, updated: 0, unchanged: 0 }, links: { resolved: 0, missing: 0 }, skipped: [], skippedCount: 0,
});
const vault = (...entries: Array<[string, number]>): VaultFile[] => entries.map(([path, size]) => ({ path, file: new File(["x".repeat(size)], path.split("/").pop()!) }));

function fake(limits = { maxFiles: 10, maxBytes: 1000, maxFileBytes: 100 }, onFile?: (path: string) => void | Promise<void>) {
  const calls: string[] = [];
  const api: ImportApi = {
    async start() { calls.push("start"); return { session: "s1", root: "Vault", limits }; },
    async file(_space, _session, path) { calls.push(`file ${path}`); await onFile?.(path); return { accepted: true }; },
    async finish() { calls.push("finish"); return summary(); },
    async cancel() { calls.push("cancel"); },
  };
  return { api, calls };
}

describe("importing a vault from the browser", () => {
  it("sends every note and picture, then finishes, and reports progress", async () => {
    const { api, calls } = fake();
    const progress: ImportProgress[] = [];
    const outcome = await runVaultImport({ api, space: "internal", root: "Vault", files: vault(["Home.md", 5], ["img/a.png", 5]), onProgress: (p) => progress.push(p), concurrency: 1 });
    expect(calls).toEqual(["start", "file Home.md", "file img/a.png", "finish"]);
    expect(outcome).toMatchObject({ leftOut: 0, hitLimit: false });
    expect(progress.at(0)).toEqual({ phase: "sending", sent: 0, total: 2 });
    expect(progress.at(-1)).toEqual({ phase: "finishing", sent: 2, total: 2 });
  });

  it("does not send hidden folders or files over the size cap", async () => {
    const { api, calls } = fake({ maxFiles: 10, maxBytes: 1000, maxFileBytes: 10 });
    const outcome = await runVaultImport({ api, space: "internal", root: "Vault", files: vault(["Home.md", 5], [".obsidian/app.json", 5], ["big.pdf", 50], [".git/x", 1]), concurrency: 1 });
    expect(calls).toEqual(["start", "file Home.md", "finish"]);
    expect(outcome.leftOut).toBe(3);
  });

  it("stops queueing at the cap on files and on total size, and says the cap was reached", async () => {
    const files = fake({ maxFiles: 2, maxBytes: 1000, maxFileBytes: 100 });
    const byCount = await runVaultImport({ api: files.api, space: "internal", root: "V", files: vault(["a.md", 1], ["b.md", 1], ["c.md", 1]), concurrency: 1 });
    expect(files.calls.filter((call) => call.startsWith("file"))).toHaveLength(2);
    expect(byCount).toMatchObject({ leftOut: 1, hitLimit: true });

    const bytes = fake({ maxFiles: 10, maxBytes: 8, maxFileBytes: 100 });
    const bySize = await runVaultImport({ api: bytes.api, space: "internal", root: "V", files: vault(["a.md", 5], ["b.md", 5]), concurrency: 1 });
    expect(bytes.calls.filter((call) => call.startsWith("file"))).toEqual(["file a.md"]);
    expect(bySize.hitLimit).toBe(true);
  });

  it("stops when the server says it has no room, keeps what was accepted, and still finishes", async () => {
    const { api, calls } = fake(undefined, (path) => {
      if (path === "b.md") throw new ApiError("limit", 413, { code: "limit" });
    });
    const outcome = await runVaultImport({ api, space: "internal", root: "V", files: vault(["a.md", 1], ["b.md", 1], ["c.md", 1]), concurrency: 1 });
    expect(calls).toEqual(["start", "file a.md", "file b.md", "finish"]);
    expect(outcome).toMatchObject({ hitLimit: true, leftOut: 2 });
  });

  it("cancels the session when the person stops, and when too many files fail", async () => {
    const controller = new AbortController();
    const slow = fake(undefined, (path) => { if (path === "a.md") controller.abort(); });
    await expect(runVaultImport({ api: slow.api, space: "internal", root: "V", files: vault(["a.md", 1], ["b.md", 1]), signal: controller.signal, concurrency: 1 })).rejects.toBeDefined();
    expect(slow.calls.at(-1)).toBe("cancel");
    expect(slow.calls).not.toContain("finish");

    const broken = fake({ maxFiles: 100, maxBytes: 1000, maxFileBytes: 100 }, () => { throw new ApiError("boom", 500, {}); });
    const many = Array.from({ length: 30 }, (_, index): [string, number] => [`n${index}.md`, 1]);
    await expect(runVaultImport({ api: broken.api, space: "internal", root: "V", files: vault(...many), concurrency: 1 })).rejects.toBeInstanceOf(ApiError);
    expect(broken.calls.at(-1)).toBe("cancel");
  });
});
