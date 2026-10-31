import fs from "node:fs";
import path from "node:path";
import { jsonFile } from "./desktop-prefs.mjs";

/** `enabled` is null until the person chooses: the notch is then on exactly when a notched display is attached. */
export function createNotchPrefs(userData, files = fs) {
  const file = jsonFile(path.join(userData, "notch.json"), files);
  let enabled = null;
  try {
    const saved = file.read();
    if (typeof saved?.enabled === "boolean") enabled = saved.enabled;
  } catch {}
  return {
    enabled: () => enabled,
    setEnabled(value) {
      enabled = value === true;
      try {
        files.mkdirSync(userData, { recursive: true });
        file.write({ enabled });
      } catch {}
    },
  };
}
