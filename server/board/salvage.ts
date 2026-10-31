import type { z } from "zod";

type Path = ReadonlyArray<PropertyKey>;
type Step = string | number;

interface Issue {
  code: string;
  path: PropertyKey[];
  maximum?: unknown;
  origin?: unknown;
}

const read = (root: unknown, path: Path): unknown => path.reduce<unknown>((at, key) => (at as Record<Step, unknown> | undefined)?.[key as Step], root);

function clip(value: unknown, maximum: number): unknown {
  if (typeof value === "string" || Array.isArray(value)) return value.slice(0, maximum);
  return value;
}

function write(root: unknown, path: Path, value: unknown): void {
  const parent = read(root, path.slice(0, -1)) as Record<Step, unknown> | undefined;
  if (parent) parent[path[path.length - 1] as Step] = value;
}

function remove(root: unknown, path: Path): boolean {
  const parent = read(root, path.slice(0, -1));
  const key = path[path.length - 1] as Step;
  if (Array.isArray(parent)) return typeof key === "number" && parent.splice(key, 1).length > 0;
  if (parent && typeof parent === "object") return delete (parent as Record<Step, unknown>)[key];
  return false;
}

/** Repairs one problem: cuts what is too long, otherwise drops the smallest part that can go without the row losing something it needs. */
function repair<T>(schema: z.ZodType<T>, root: unknown, issue: Issue): boolean {
  const path = issue.path as Path;
  if (!path.length) return false;
  if (issue.code === "too_big" && typeof issue.maximum === "number" && (issue.origin === "string" || issue.origin === "array")) {
    write(root, path, clip(read(root, path), issue.maximum));
    return true;
  }
  for (let depth = path.length; depth >= 1; depth -= 1) {
    const target = path.slice(0, depth);
    const held = read(root, target);
    if (!remove(root, target)) continue;
    const needed = Array.isArray(read(root, target.slice(0, -1))) ? false : schema.safeParse(root).error?.issues.some((other) => other.path.join(".") === target.join("."));
    if (!needed) return true;
    const parent = read(root, target.slice(0, -1)) as Record<Step, unknown>;
    parent[target[target.length - 1] as Step] = held;
  }
  return false;
}

/** The row as the loader will read it back: too-long parts cut, parts that cannot be read dropped. Undefined when it cannot be saved without losing what it is. */
export function fit<T>(schema: z.ZodType<T>, row: unknown): T | undefined {
  if (!row || typeof row !== "object") return undefined;
  const value = structuredClone(row);
  for (let round = 0; round < 24; round += 1) {
    const parsed = schema.safeParse(value);
    if (parsed.success) return parsed.data;
    if (!repair(schema, value, parsed.error.issues[0] as unknown as Issue)) return undefined;
  }
  return undefined;
}
