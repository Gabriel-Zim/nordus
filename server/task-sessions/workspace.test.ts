import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupTaskTmp, taskEnv, taskShortId, taskTmpDir } from "./workspace.ts";

const dirs: string[] = [];
const fresh = () => { const d = mkdtempSync(join(tmpdir(), "nordus-ws-")); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe("task workspace", () => {
  it("taskShortId is stable and 6 chars", () => {
    expect(taskShortId("thread-1")).toBe(taskShortId("thread-1"));
    expect(taskShortId("thread-1")).toMatch(/^[0-9a-z]{6}$/);
    expect(taskShortId("thread-2")).not.toBe(taskShortId("thread-1"));
  });
  it("taskEnv creates the folder and returns TMPDIR and id", () => {
    const dir = fresh();
    const env = taskEnv(dir, "b1", "t1");
    expect(env).toEqual({ TMPDIR: join(dir, "task-tmp", "b1", "t1"), NORDUS_TAREFA_ID: taskShortId("t1") });
    expect(existsSync(taskTmpDir(dir, "b1", "t1"))).toBe(true);
  });
  it("cleanupTaskTmp removes the folder and tolerates a second call", () => {
    const dir = fresh();
    taskEnv(dir, "b1", "t1");
    cleanupTaskTmp(dir, "b1", "t1");
    expect(existsSync(taskTmpDir(dir, "b1", "t1"))).toBe(false);
    expect(() => cleanupTaskTmp(dir, "b1", "t1")).not.toThrow();
  });
  it("keeps the same threadId under two bots separate", () => {
    const dir = fresh();
    taskEnv(dir, "b1", "t1"); taskEnv(dir, "b2", "t1");
    expect(taskTmpDir(dir, "b1", "t1")).not.toBe(taskTmpDir(dir, "b2", "t1"));
    cleanupTaskTmp(dir, "b1", "t1");
    expect(existsSync(taskTmpDir(dir, "b2", "t1"))).toBe(true);
  });
  it("rejects unsafe ids and deletes nothing", () => {
    const dir = fresh();
    taskEnv(dir, "b1", "t1");
    for (const bad of ["", ".", "..", "../x", "a/b"]) {
      expect(() => cleanupTaskTmp(dir, "b1", bad)).toThrow();
      expect(() => cleanupTaskTmp(dir, bad, "t1")).toThrow();
      expect(() => taskEnv(dir, "b1", bad)).toThrow();
      expect(() => taskTmpDir(dir, bad, "t1")).toThrow();
    }
    expect(existsSync(taskTmpDir(dir, "b1", "t1"))).toBe(true);
  });
  it("never throws when the folder cannot be removed, and says so", () => {
    const dir = fresh();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const remove = (() => { throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" }); }) as never;
      expect(() => cleanupTaskTmp(dir, "b1", "t1", remove)).not.toThrow();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("EACCES"));
    } finally { warn.mockRestore(); }
  });
});
