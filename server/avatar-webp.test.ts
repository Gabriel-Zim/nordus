import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { afterAll, describe, expect, it } from "vitest";

// The attachments module reads the data dir at import time.
const DATA_ROOT = mkdtempSync(join(tmpdir(), "nordus-avatar-webp-"));
process.env.NORDUS_DATA_DIR = DATA_ROOT;
const { ATTACHMENTS_DIR, ensureAttachmentsDir, saveImage } = await import("./attachments.ts");
const avatar = await import("./avatar-webp.ts");
const { attachmentCacheHeaders, ifNoneMatchHits } = await import("./routes/threads.ts");
const { imageSizeFromName, readImageSize } = await import("../shared/image-size.ts");
const { botAvatarUrlSchema } = await import("../shared/bot-avatar.ts");

afterAll(() => rmSync(DATA_ROOT, { recursive: true, force: true }));

const ffmpeg = avatar.findFfmpeg({
  ...process.env,
  NORDUS_FFMPEG: process.env.NORDUS_FFMPEG ?? "",
  PATH: `${process.env.PATH ?? ""}:${process.env.HOME}/.local/bin:/opt/homebrew/bin:/usr/local/bin`,
});

/** A big smooth picture with a little noise, as a PNG, with no image library. */
function bigPng(width: number, height: number): Buffer {
  const row = width * 3 + 1;
  const raw = Buffer.alloc(row * height);
  let seed = 7;
  for (let y = 0; y < height; y += 1) {
    raw[y * row] = 0;
    for (let x = 0; x < width; x += 1) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const noise = (seed >> 16) % 12;
      const at = y * row + 1 + x * 3;
      raw[at] = Math.min(255, Math.floor((x / width) * 220) + noise);
      raw[at + 1] = Math.min(255, Math.floor((y / height) * 220) + noise);
      raw[at + 2] = Math.min(255, 90 + noise);
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buffer: Buffer) => {
    let c = 0xffffffff;
    for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const nameOf = (path: string) => path.split("/").pop()!;

describe("converted avatar names", () => {
  it("recognizes only the avatar tag followed by the size suffix", () => {
    expect(avatar.isConvertedAvatarName("3f2b0c5e-aaaa-4bbb-8ccc-1234567890ab-av-w256h341.webp")).toBe(true);
    expect(avatar.isConvertedAvatarName("3f2b0c5e-aaaa-4bbb-8ccc-1234567890ab-w256h341.webp")).toBe(false);
    expect(avatar.isConvertedAvatarName("3f2b0c5e-aaaa-4bbb-8ccc-1234567890ab-av-w256h341.png")).toBe(false);
    expect(avatar.isConvertedAvatarUrl("/api/attachments/x-av-w10h10.webp")).toBe(true);
    expect(avatar.isConvertedAvatarUrl("/api/attachments/x.webp")).toBe(false);
  });
});

describe("without ffmpeg", () => {
  it("returns the original name and leaves the files alone", async () => {
    ensureAttachmentsDir();
    const saved = saveImage(bigPng(64, 64), "image/png");
    const name = nameOf(saved.path);
    expect(await avatar.convertAvatarAttachment(name, { ffmpeg: null })).toBe(name);
    expect(await avatar.convertAvatarUrl(`/api/attachments/${name}`, { ffmpeg: null })).toBe(`/api/attachments/${name}`);
    expect(existsSync(saved.path)).toBe(true);
  });

  it("falls back to the original when ffmpeg fails", async () => {
    ensureAttachmentsDir();
    const saved = saveImage(bigPng(64, 64), "image/png");
    const name = nameOf(saved.path);
    const broken = join(DATA_ROOT, "not-ffmpeg.sh");
    writeFileSync(broken, "#!/bin/sh\nexit 3\n", { mode: 0o755 });
    expect(await avatar.convertAvatarAttachment(name, { ffmpeg: broken })).toBe(name);
  });

  it("passes through anything that is not a stored image", async () => {
    expect(await avatar.convertAvatarUrl("https://example.com/a.png", { ffmpeg: null })).toBe("https://example.com/a.png");
    expect(await avatar.convertAvatarAttachment("../etc/passwd", { ffmpeg: "/bin/echo" })).toBe("../etc/passwd");
  });

  it("migrates nothing and keeps every owner as it was", async () => {
    ensureAttachmentsDir();
    const name = nameOf(saveImage(bigPng(64, 64), "image/png").path);
    const updates: string[] = [];
    const result = await avatar.migrateAvatars(
      [{ owners: () => [{ id: "bot-1", avatarUrl: `/api/attachments/${name}` }], update: (id) => void updates.push(id) }],
      { ffmpeg: null },
    );
    expect(result).toEqual({ converted: 0, savedBytes: 0 });
    expect(updates).toEqual([]);
  });

  it("skips owners that already carry a converted avatar or none at all", async () => {
    const updates: string[] = [];
    const result = await avatar.migrateAvatars(
      [{
        owners: () => [
          { id: "a", avatarUrl: "/api/attachments/x-av-w256h256.webp" },
          { id: "b", avatarUrl: undefined },
        ],
        update: (id) => void updates.push(id),
      }],
      { ffmpeg: "/bin/echo" },
    );
    expect(result.converted).toBe(0);
    expect(updates).toEqual([]);
  });
});

describe.skipIf(!ffmpeg)("with ffmpeg", () => {
  it("shrinks a big picture to a small WebP with the short side at 256 and keeps the original", async () => {
    ensureAttachmentsDir();
    const original = bigPng(1200, 900);
    const saved = saveImage(original, "image/png");
    const name = nameOf(saved.path);
    const converted = await avatar.convertAvatarAttachment(name, { ffmpeg });
    expect(converted).not.toBe(name);
    expect(avatar.isConvertedAvatarName(converted)).toBe(true);
    expect(converted.startsWith(`${name.replace(/\.png$/, "")}-av-`), "named after the original").toBe(true);
    expect(botAvatarUrlSchema.safeParse(`/api/attachments/${converted}`).success).toBe(true);
    const out = join(ATTACHMENTS_DIR, converted);
    const bytes = readFileSync(out);
    expect(bytes.subarray(0, 4).toString()).toBe("RIFF");
    expect(bytes.subarray(8, 12).toString()).toBe("WEBP");
    expect(statSync(out).size).toBeLessThan(64 * 1024);
    expect(statSync(out).size).toBeLessThan(original.byteLength / 5);
    const size = readImageSize(bytes)!;
    expect(Math.min(size.width, size.height)).toBe(256);
    expect(size.width / size.height).toBeCloseTo(1200 / 900, 1);
    expect(imageSizeFromName(converted)).toEqual(size);
    expect(existsSync(saved.path)).toBe(true);
  });

  it("never enlarges a small picture", async () => {
    ensureAttachmentsDir();
    const name = nameOf(saveImage(bigPng(100, 60), "image/png").path);
    const converted = await avatar.convertAvatarAttachment(name, { ffmpeg });
    expect(avatar.isConvertedAvatarName(converted)).toBe(true);
    expect(imageSizeFromName(converted)).toEqual({ width: 100, height: 60 });
  });

  it("does not convert a converted avatar again", async () => {
    ensureAttachmentsDir();
    const name = nameOf(saveImage(bigPng(600, 600), "image/png").path);
    const converted = await avatar.convertAvatarAttachment(name, { ffmpeg });
    expect(await avatar.convertAvatarAttachment(converted, { ffmpeg })).toBe(converted);
    expect(await avatar.convertAvatarUrl(`/api/attachments/${converted}`, { ffmpeg })).toBe(`/api/attachments/${converted}`);
  });

  it("migrates bots and rooms once, counts the savings, and a second run changes nothing", async () => {
    ensureAttachmentsDir();
    const big = nameOf(saveImage(bigPng(1000, 1000), "image/png").path);
    const other = nameOf(saveImage(bigPng(800, 800), "image/png").path);
    const bots = [
      { id: "bot-1", avatarUrl: `/api/attachments/${big}` as string | undefined },
      { id: "bot-2", avatarUrl: `/api/attachments/${big}` as string | undefined },
      { id: "bot-3", avatarUrl: undefined as string | undefined },
    ];
    const rooms = [{ id: "room-1", avatarUrl: `/api/attachments/${other}` as string | undefined }];
    const patchOf = (list: Array<{ id: string; avatarUrl: string | undefined }>) => ({
      owners: () => list.map((entry) => ({ ...entry })),
      update: (id: string, avatarUrl: string) => void (list.find((entry) => entry.id === id)!.avatarUrl = avatarUrl),
    });
    const lines: string[] = [];
    const first = await avatar.migrateAvatars([patchOf(bots), patchOf(rooms)], { ffmpeg, log: (line) => lines.push(line) });
    expect(first.converted).toBe(2);
    expect(first.savedBytes).toBeGreaterThan(0);
    expect(bots[0]!.avatarUrl).toBe(bots[1]!.avatarUrl);
    expect(avatar.isConvertedAvatarUrl(bots[0]!.avatarUrl!)).toBe(true);
    expect(avatar.isConvertedAvatarUrl(rooms[0]!.avatarUrl!)).toBe(true);
    expect(bots[2]!.avatarUrl).toBeUndefined();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/2 converted to WebP, \d+ KB smaller/);
    const second = await avatar.migrateAvatars([patchOf(bots), patchOf(rooms)], { ffmpeg });
    expect(second).toEqual({ converted: 0, savedBytes: 0 });
  });
});

describe("attachment cache headers", () => {
  it("lets a converted avatar be kept forever, with an etag", () => {
    const headers = attachmentCacheHeaders("abc-av-w256h256.webp", "image/webp");
    expect(headers["cache-control"]).toBe("private, max-age=31536000, immutable");
    expect(headers.etag).toBe('"abc-av-w256h256.webp"');
  });

  it("keeps every other attachment uncached", () => {
    for (const name of ["abc-w256h256.webp", "abc.png", "abc.mp3", "abc-av.webp"]) {
      const headers = attachmentCacheHeaders(name, "image/png");
      expect(headers["cache-control"]).toBe("private, no-store");
      expect(headers.etag).toBeUndefined();
    }
  });

  it("matches If-None-Match against the etag", () => {
    expect(ifNoneMatchHits('"a"', '"a"')).toBe(true);
    expect(ifNoneMatchHits('"b", W/"a"', '"a"')).toBe(true);
    expect(ifNoneMatchHits("*", '"a"')).toBe(true);
    expect(ifNoneMatchHits('"b"', '"a"')).toBe(false);
    expect(ifNoneMatchHits(undefined, '"a"')).toBe(false);
  });
});
