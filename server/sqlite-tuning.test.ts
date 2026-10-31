import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkpointPeriodically, tuneConnection } from "./sqlite-tuning.ts";

let dir = "";
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "sqlite-tuning-")); });
afterEach(() => { vi.useRealTimers(); rmSync(dir, { recursive: true, force: true }); });

const pragma = (db: DatabaseSync, name: string) => Object.values(db.prepare(`PRAGMA ${name}`).get() as Record<string, number>)[0];

describe("sqlite tuning", () => {
  it("raises the page cache and turns on memory-mapped reads", () => {
    const db = new DatabaseSync(join(dir, "a.db"));
    tuneConnection(db);
    expect(pragma(db, "cache_size")).toBe(-32768);
    expect(pragma(db, "mmap_size")).toBe(256 * 1024 * 1024);
    expect(pragma(db, "temp_store")).toBe(2);
    db.close();
  });

  it("checkpoints on a timer and survives a database that was closed", () => {
    vi.useFakeTimers();
    const db = new DatabaseSync(join(dir, "b.db"));
    db.exec("PRAGMA journal_mode = WAL");
    const spy = vi.spyOn(db, "exec");
    const stop = checkpointPeriodically(db, 1_000);
    vi.advanceTimersByTime(2_000);
    expect(spy).toHaveBeenCalledWith("PRAGMA wal_checkpoint(PASSIVE)");
    db.close();
    expect(() => vi.advanceTimersByTime(2_000)).not.toThrow();
    stop();
  });
});
