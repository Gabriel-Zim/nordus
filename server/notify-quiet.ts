import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { DEFAULT_QUIET_HOURS, parseQuietHours, type QuietHours } from "../shared/notification-quiet.ts";

const FILE = "notify-quiet.json";

export interface QuietHoursStore {
  current(): QuietHours;
  save(next: QuietHours): void;
}

export function createQuietHoursStore(dataDir: string): QuietHoursStore {
  const path = join(dataDir, FILE);
  let current = DEFAULT_QUIET_HOURS;
  try {
    current = parseQuietHours(JSON.parse(readFileSync(path, "utf8"))) ?? DEFAULT_QUIET_HOURS;
  } catch {}
  return {
    current: () => current,
    save(next) {
      const tmp = `${path}.tmp`;
      writeFileSync(tmp, JSON.stringify(next) + "\n", { mode: 0o600 });
      renameSync(tmp, path);
      current = next;
    },
  };
}
