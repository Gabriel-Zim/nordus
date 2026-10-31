// Small JSON state files under the data dir: a missing file is an empty state, an unreadable one is reported, never
// silently read as empty.
import { constants, copyFileSync, readFileSync } from "node:fs";

export type JsonState<T> = { status: "ok"; value: T } | { status: "missing" } | { status: "unreadable" };

export const isJsonObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const reported = new Set<string>();

export function readJsonState<T>(path: string, accept: (value: unknown) => value is T): JsonState<T> {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (code !== "ENOENT") return unreadable(path, typeof code === "string" ? code : "read error", false);
    reported.delete(path);
    return { status: "missing" };
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return unreadable(path, "invalid JSON", true);
  }
  if (!accept(value)) return unreadable(path, "unexpected shape", true);
  reported.delete(path);
  return { status: "ok", value };
}

function unreadable(path: string, kind: string, keepCopy: boolean): { status: "unreadable" } {
  // Some callers read on every turn: one line per bad spell, not per read.
  if (reported.has(path)) return { status: "unreadable" };
  reported.add(path);
  let kept = "";
  if (keepCopy) {
    const copy = `${path}.corrompido-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    try {
      copyFileSync(path, copy, constants.COPYFILE_EXCL);
      kept = `, copy kept at ${copy}`;
    } catch {}
  }
  // The kind only: a JSON.parse message quotes the file, which can hold conversation text.
  console.warn(`[state] ${path} is unreadable (${kind})${kept}`);
  return { status: "unreadable" };
}
