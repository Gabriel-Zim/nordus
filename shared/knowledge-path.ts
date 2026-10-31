export const SEGMENT_MAX = 200;
export const PATH_MAX = 1000;
export const DEPTH_MAX = 12;

const ONLY_DOTS = /^\.+$/u;

/** Characters that cannot be seen or that change how text reads: controls, line and paragraph breaks, zero-width and direction marks, lone surrogates. */
export function isUnsafeCodePoint(code: number): boolean {
  return (
    code <= 0x1f ||
    (code >= 0x7f && code <= 0x9f) ||
    code === 0xad ||
    code === 0x61c ||
    code === 0x180e ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x2028 && code <= 0x202e) ||
    (code >= 0x2060 && code <= 0x206f) ||
    code === 0xfeff ||
    (code >= 0xfff9 && code <= 0xfffb) ||
    (code >= 0xd800 && code <= 0xdfff)
  );
}

export function hasUnsafeCharacter(value: string): boolean {
  for (const char of value) if (isUnsafeCodePoint(char.codePointAt(0)!)) return true;
  return false;
}

export function replaceUnsafe(value: string, replacement: string): string {
  let out = "";
  for (const char of value) out += isUnsafeCodePoint(char.codePointAt(0)!) ? replacement : char;
  return out;
}

export type PathProblem = "type" | "empty" | "dot" | "character" | "segment-length" | "length" | "depth";

export type ParsedPath = { ok: true; path: string; segments: string[] } | { ok: false; problem: PathProblem };

/** Separators and traversal are refused, not repaired: a path in the Drive is only ever a name, never a place on disk. */
export function parsePath(input: unknown, options: { allowRoot?: boolean } = {}): ParsedPath {
  if (typeof input !== "string") return { ok: false, problem: "type" };
  const segments: string[] = [];
  for (const raw of input.normalize("NFC").split("/")) {
    const part = raw.trim();
    if (part === "") continue;
    if (ONLY_DOTS.test(part)) return { ok: false, problem: "dot" };
    if (part.includes("\\") || hasUnsafeCharacter(part)) return { ok: false, problem: "character" };
    if ([...part].length > SEGMENT_MAX) return { ok: false, problem: "segment-length" };
    segments.push(part);
  }
  if (segments.length === 0) return options.allowRoot ? { ok: true, path: "", segments } : { ok: false, problem: "empty" };
  if (segments.length > DEPTH_MAX) return { ok: false, problem: "depth" };
  const path = segments.join("/");
  if (path.length > PATH_MAX) return { ok: false, problem: "length" };
  return { ok: true, path, segments };
}

export function foldKey(value: string): string {
  return value.normalize("NFC").toLowerCase();
}

export function stripMarks(value: string): string {
  return value.normalize("NFD").replace(/\p{M}+/gu, "");
}

/** Case- and accent-insensitive "contains", the way people type a search. */
export function matchesFolded(text: string, query: string): boolean {
  return stripMarks(foldKey(text)).includes(stripMarks(foldKey(query)));
}

export function nameOf(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut < 0 ? path : path.slice(cut + 1);
}

export function parentOf(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut < 0 ? "" : path.slice(0, cut);
}

export function joinPath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name;
}

export function extensionOf(name: string): string {
  const cut = name.lastIndexOf(".");
  return cut <= 0 ? "" : name.slice(cut + 1).toLowerCase();
}

export function stemOf(name: string): string {
  const cut = name.lastIndexOf(".");
  return cut <= 0 ? name : name.slice(0, cut);
}

export function isInside(folder: string, path: string): boolean {
  if (folder === "") return true;
  const base = foldKey(folder);
  const key = foldKey(path);
  return key === base || key.startsWith(`${base}/`);
}

export function breadcrumbOf(path: string): Array<{ name: string; path: string }> {
  const parts = path ? path.split("/") : [];
  return parts.map((name, index) => ({ name, path: parts.slice(0, index + 1).join("/") }));
}
