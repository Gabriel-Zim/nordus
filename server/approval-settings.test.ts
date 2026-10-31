import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { APPROVAL_TTL_MAX_MS, APPROVAL_TTL_MIN_MS, APPROVAL_TTL_MS } from "../shared/approvals.ts";
import { clampTtl, createApprovalSettings } from "./approval-settings.ts";

const dirs: string[] = [];
const dataDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "nordus-approval-settings-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("how long a request waits", () => {
  it("is a day until someone says otherwise", () => {
    expect(createApprovalSettings(dataDir()).ttlMs()).toBe(APPROVAL_TTL_MS);
    expect(APPROVAL_TTL_MS).toBe(24 * 3_600_000);
  });

  it("keeps what was set across a restart", () => {
    const dir = dataDir();
    expect(createApprovalSettings(dir).setTtlMs(4 * 3_600_000)).toBe(4 * 3_600_000);
    expect(createApprovalSettings(dir).ttlMs()).toBe(4 * 3_600_000);
  });

  it("stays between a quarter of an hour and a month", () => {
    expect(clampTtl(1)).toBe(APPROVAL_TTL_MIN_MS);
    expect(clampTtl(10 * APPROVAL_TTL_MAX_MS)).toBe(APPROVAL_TTL_MAX_MS);
    const settings = createApprovalSettings(dataDir());
    expect(settings.setTtlMs(0)).toBe(APPROVAL_TTL_MIN_MS);
    expect(settings.ttlMs()).toBe(APPROVAL_TTL_MIN_MS);
  });

  it("starts from the default when the file is not usable", () => {
    for (const text of ["not json", "[]", JSON.stringify({ ttlMs: "soon" }), JSON.stringify({ ttlMs: null })]) {
      const dir = dataDir();
      writeFileSync(join(dir, "approvals.json"), text);
      expect(createApprovalSettings(dir).ttlMs(), text).toBe(APPROVAL_TTL_MS);
    }
  });

  it("keeps the setting in one small file", () => {
    const dir = dataDir();
    createApprovalSettings(dir).setTtlMs(2 * 3_600_000);
    expect(JSON.parse(readFileSync(join(dir, "approvals.json"), "utf8"))).toEqual({ ttlMs: 2 * 3_600_000 });
  });
});
