import { joinPath } from "../../shared/knowledge-path";
import type { KnowledgeSpaceId, WireKnowledgeActor, WireKnowledgeSpace } from "../../shared/knowledge";
import { activeLocale, t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { ApiError } from "@/state/api";

const UNITS = ["B", "KB", "MB", "GB"] as const;

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1;
  return `${new Intl.NumberFormat(activeLocale(), { maximumFractionDigits: digits }).format(value)} ${UNITS[unit]}`;
}

const STEPS: ReadonlyArray<readonly [Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 31_536_000],
  ["month", 2_592_000],
  ["week", 604_800],
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
];

export function relativeTime(at: number, now = Date.now()): string {
  const seconds = Math.round((at - now) / 1000);
  const format = new Intl.RelativeTimeFormat(activeLocale(), { numeric: "auto" });
  for (const [unit, size] of STEPS) {
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  }
  return format.format(0, "second");
}

export function fullDate(at: number): string {
  return new Intl.DateTimeFormat(activeLocale(), { dateStyle: "medium", timeStyle: "short" }).format(new Date(at));
}

export function spaceLabel(space: WireKnowledgeSpace): string {
  return space.kind === "internal" ? t("drive.space.internal") : (space.client ?? space.id.slice("client:".length));
}

/** The wanted space when the asker has it, else the first one they have. */
export function chooseSpace(spaces: readonly WireKnowledgeSpace[], wanted?: string | null): KnowledgeSpaceId | null {
  return spaces.find((space) => space.id === wanted)?.id ?? spaces[0]?.id ?? null;
}

const SPACE_KEY = "nordus.knowledge.space";

/** The space the person last looked at or saved to, so the Drive and the Wiki open on it. */
export function rememberedSpace(): string | null {
  try {
    return globalThis.localStorage?.getItem(SPACE_KEY) ?? null;
  } catch {
    return null;
  }
}

export function rememberSpace(id: KnowledgeSpaceId): void {
  try {
    globalThis.localStorage?.setItem(SPACE_KEY, id);
  } catch {
    // The choice is only a convenience.
  }
}

/** The addresses typed in the box: one per line, though a comma, a semicolon or a space also parts two. */
export function addressesIn(text: string): string[] {
  return text.split(/[\s,;]+/).filter(Boolean);
}

export function actorInitials(actor: WireKnowledgeActor): string {
  const words = actor.name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? [words[0]![0], words[words.length - 1]![0]] : [words[0]?.[0] ?? "?"];
  return letters.join("").toUpperCase();
}

/** The server records why a version exists with a short token; people read a sentence. */
export function versionNote(note: string | undefined): string | undefined {
  if (!note) return undefined;
  const restored = /^restore:(\d+)$/.exec(note);
  if (restored) return t("drive.version.restoredFrom", { n: restored[1]! });
  if (note === "import:obsidian") return t("wiki.version.imported");
  return note;
}

const ERROR_KEYS: Readonly<Record<string, LocaleKey>> = {
  bad_path: "drive.error.badPath",
  bad_title: "wiki.error.badTitle",
  not_found: "drive.error.notFound",
  forbidden: "drive.error.forbidden",
  exists: "drive.error.exists",
  path_taken: "drive.error.exists",
  title_taken: "wiki.error.titleTaken",
  conflict: "wiki.error.conflict",
  full: "drive.error.full",
  limit: "wiki.error.limit",
  no_space: "drive.error.noSpace",
};

/** What went wrong, in words for the person, from the server's code. */
export function knowledgeErrorText(error: unknown): string {
  if (error instanceof ApiError) {
    const code = error.body?.code;
    if (code === "too_large") {
      const max = error.body?.maxBytes;
      return typeof max === "number" ? t("drive.error.tooLargeMax", { max: formatBytes(max) }) : t("drive.error.tooLarge");
    }
    if (typeof code === "string" && ERROR_KEYS[code]) return t(ERROR_KEYS[code]!);
  }
  return t("drive.error.generic");
}

export function isKnowledgeCode(error: unknown, code: string): boolean {
  return error instanceof ApiError && error.body?.code === code;
}

export function uploadPathFor(folder: string, name: string): string {
  return joinPath(folder, name);
}

export interface VaultFile {
  file: File;
  /** The path inside the vault, without the vault's own folder name. */
  path: string;
}

/** A folder chosen in the browser: every file carries `Vault/Sub/Note.md`; the vault's name is the first part. */
export function vaultFilesOf(files: ArrayLike<File>): { root: string; files: VaultFile[] } {
  const list = Array.from(files);
  const first = list.find((file) => file.webkitRelativePath)?.webkitRelativePath ?? "";
  const root = first.split("/")[0] ?? "";
  const entries: VaultFile[] = [];
  for (const file of list) {
    const relative = file.webkitRelativePath || file.name;
    const parts = relative.split("/");
    entries.push({ file, path: parts.length > 1 ? parts.slice(1).join("/") : relative });
  }
  return { root, files: entries };
}

export function isHiddenPath(path: string): boolean {
  return path.split("/").some((segment) => segment.startsWith("."));
}
