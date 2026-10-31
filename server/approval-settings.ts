// Nordus: the one workspace setting of the approvals inbox, how long a tool permission waits before it is declined.
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { APPROVAL_TTL_MAX_MS, APPROVAL_TTL_MIN_MS, APPROVAL_TTL_MS } from "../shared/approvals.ts";

const FILE = "approvals.json";

export interface ApprovalSettings {
  ttlMs(): number;
  setTtlMs(value: number): number;
}

export function clampTtl(value: number): number {
  return Math.min(APPROVAL_TTL_MAX_MS, Math.max(APPROVAL_TTL_MIN_MS, Math.round(value)));
}

export function createApprovalSettings(dataDir: string): ApprovalSettings {
  const path = join(dataDir, FILE);
  let ttl = APPROVAL_TTL_MS;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    const stored = parsed && typeof parsed === "object" ? (parsed as { ttlMs?: unknown }).ttlMs : undefined;
    if (typeof stored === "number" && Number.isFinite(stored)) ttl = clampTtl(stored);
  } catch {}
  return {
    ttlMs: () => ttl,
    setTtlMs(value) {
      const next = clampTtl(value);
      const tmp = `${path}.tmp`;
      writeFileSync(tmp, JSON.stringify({ ttlMs: next }) + "\n", { mode: 0o600 });
      renameSync(tmp, path);
      ttl = next;
      return next;
    },
  };
}
