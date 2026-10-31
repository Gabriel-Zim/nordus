import { execFile } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { ATTACHMENTS_DIR, saveImage } from "./attachments.ts";

/** The shorter side of a converted avatar. Bigger pictures shrink to it; smaller ones are never enlarged. */
export const AVATAR_SHORT_SIDE = 256;
export const AVATAR_WEBP_QUALITY = 80;
export const AVATAR_CONVERT_TIMEOUT_MS = 30_000;

const ATTACHMENT_URL_PREFIX = "/api/attachments/";
/** `<original stem>-av-w<W>h<H>.webp`: the tag marks a converted avatar, the size suffix is the one shared/image-size.ts reads. */
const CONVERTED_NAME = /^[A-Za-z0-9-]+-av-w[1-9]\d{0,4}h[1-9]\d{0,4}\.webp$/;
const STORED_IMAGE_NAME = /^([A-Za-z0-9-]+)\.(?:png|jpg|gif|webp)$/;

/** A converted avatar never changes under its name, so it is the only attachment a browser may keep forever. */
export function isConvertedAvatarName(name: string): boolean {
  return CONVERTED_NAME.test(name);
}

export function isConvertedAvatarUrl(url: string): boolean {
  return url.startsWith(ATTACHMENT_URL_PREFIX) && isConvertedAvatarName(url.slice(ATTACHMENT_URL_PREFIX.length));
}

let cachedFfmpeg: string | null | undefined;

/** NORDUS_FFMPEG first, then PATH, then the usual install places. Null when there is no ffmpeg (the Mac app may not ship one). */
export function findFfmpeg(env: NodeJS.ProcessEnv = process.env): string | null {
  const configured = env.NORDUS_FFMPEG?.trim();
  if (configured) return existsSync(configured) ? configured : null;
  for (const dir of (env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, "ffmpeg");
    if (existsSync(candidate)) return candidate;
  }
  return ["/usr/bin/ffmpeg", "/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg"].find((path) => existsSync(path)) ?? null;
}

function ffmpegPath(): string | null {
  if (cachedFfmpeg === undefined) cachedFfmpeg = findFfmpeg();
  return cachedFfmpeg;
}

export function __resetFfmpegLookupForTests(): void {
  cachedFfmpeg = undefined;
}

// Shrink only when the short side is above the target: the `-1` side keeps the proportion, nothing is cropped.
const SCALE_FILTER =
  `scale='if(lte(min(iw,ih),${AVATAR_SHORT_SIDE}),iw,if(lt(iw,ih),${AVATAR_SHORT_SIDE},-1))'` +
  `:'if(lte(min(iw,ih),${AVATAR_SHORT_SIDE}),ih,if(lt(iw,ih),-1,${AVATAR_SHORT_SIDE}))':flags=lanczos`;

function runFfmpeg(binary: string, input: string, output: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(
      binary,
      ["-v", "error", "-nostdin", "-y", "-i", input, "-frames:v", "1", "-an", "-vf", SCALE_FILTER,
        "-c:v", "libwebp", "-quality", String(AVATAR_WEBP_QUALITY), "-f", "webp", output],
      { timeout: AVATAR_CONVERT_TIMEOUT_MS, windowsHide: true, maxBuffer: 1024 * 1024 },
      (error) => resolve(!error),
    );
  });
}

/**
 * Turns a stored picture into a small WebP attachment and returns its name. Whatever goes wrong (no ffmpeg, a file it
 * cannot read) returns the name it was given, so the avatar keeps working. The original stays on disk.
 */
export async function convertAvatarAttachment(name: string, options: { ffmpeg?: string | null } = {}): Promise<string> {
  const stem = STORED_IMAGE_NAME.exec(name)?.[1];
  if (isConvertedAvatarName(name) || !stem) return name;
  const binary = options.ffmpeg === undefined ? ffmpegPath() : options.ffmpeg;
  if (!binary) return name;
  const source = join(ATTACHMENTS_DIR, name);
  let scratch: string | undefined;
  try {
    if (!statSync(source).isFile()) return name;
    scratch = await mkdtemp(join(tmpdir(), "nordus-avatar-"));
    const output = join(scratch, "avatar.webp");
    if (!(await runFfmpeg(binary, source, output))) return name;
    const bytes = await readFile(output);
    if (bytes.byteLength === 0) return name;
    const saved = saveImage(bytes, "image/webp", undefined, stem);
    const converted = saved.path.replaceAll("\\", "/").split("/").pop();
    return converted && isConvertedAvatarName(converted) ? converted : name;
  } catch {
    return name;
  } finally {
    if (scratch) await rm(scratch, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Same as convertAvatarAttachment for a `/api/attachments/<name>` URL; any other value passes through. */
export async function convertAvatarUrl(url: string, options: { ffmpeg?: string | null } = {}): Promise<string> {
  if (!url.startsWith(ATTACHMENT_URL_PREFIX)) return url;
  const name = url.slice(ATTACHMENT_URL_PREFIX.length);
  const converted = await convertAvatarAttachment(name, options);
  return converted === name ? url : `${ATTACHMENT_URL_PREFIX}${converted}`;
}

export function attachmentFileBytes(name: string): number {
  try {
    return statSync(join(ATTACHMENTS_DIR, name)).size;
  } catch {
    return 0;
  }
}

export interface AvatarOwners {
  /** Every record that carries a custom avatar, with the way to rewrite it through the store's own patch. */
  owners(): Array<{ id: string; avatarUrl: string | undefined }>;
  update(id: string, avatarUrl: string): void;
}

export interface AvatarMigrationResult {
  converted: number;
  savedBytes: number;
}

/**
 * Re-encodes every avatar not yet converted and points its owner at the new file through `update`, which patches the
 * store so the event goes out and clients refresh. Originals are kept. Safe to run on every start: converted avatars
 * are skipped, and a failed conversion leaves the owner alone.
 */
export async function migrateAvatars(
  sources: AvatarOwners[],
  options: { ffmpeg?: string | null; log?: (line: string) => void } = {},
): Promise<AvatarMigrationResult> {
  const result: AvatarMigrationResult = { converted: 0, savedBytes: 0 };
  const done = new Map<string, string>();
  for (const source of sources) {
    for (const owner of source.owners()) {
      const url = owner.avatarUrl;
      if (!url || !url.startsWith(ATTACHMENT_URL_PREFIX) || isConvertedAvatarUrl(url)) continue;
      let next = done.get(url);
      if (next === undefined) {
        next = await convertAvatarUrl(url, options);
        done.set(url, next);
        if (next !== url) {
          result.converted += 1;
          result.savedBytes += Math.max(
            0,
            attachmentFileBytes(url.slice(ATTACHMENT_URL_PREFIX.length)) - attachmentFileBytes(next.slice(ATTACHMENT_URL_PREFIX.length)),
          );
        }
      }
      if (next !== url) source.update(owner.id, next);
    }
  }
  if (result.converted > 0) {
    options.log?.(`${result.converted} converted to WebP, ${Math.round(result.savedBytes / 1024)} KB smaller`);
  }
  return result;
}
