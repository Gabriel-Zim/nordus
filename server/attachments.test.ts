import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  truncateSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { link, unlink } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  return { ...fs, link: vi.fn(fs.link), unlink: vi.fn(fs.unlink) };
});
vi.mock("node:fs", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs")>();
  return { ...fs, unlinkSync: vi.fn(fs.unlinkSync), writeFileSync: vi.fn(fs.writeFileSync) };
});
const realUnlink = (await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises")).unlink;
const realLink = (await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises")).link;
const realUnlinkSync = (await vi.importActual<typeof import("node:fs")>("node:fs")).unlinkSync;
const realWriteFileSync = (await vi.importActual<typeof import("node:fs")>("node:fs")).writeFileSync;
afterEach(() => {
  vi.mocked(unlink).mockReset().mockImplementation(realUnlink);
  vi.mocked(link).mockReset().mockImplementation(realLink);
  vi.mocked(unlinkSync).mockReset().mockImplementation(realUnlinkSync);
  vi.mocked(writeFileSync).mockReset().mockImplementation(realWriteFileSync);
});

// The module reads DATA_DIR at import time, so the env var must be set
// before the import is evaluated.
const DATA_ROOT = mkdtempSync(join(tmpdir(), "nordus-attachments-"));
process.env.NORDUS_DATA_DIR = join(DATA_ROOT, "data");
// Nordus defaults to 100 GiB; the quota tests below fill the inbox, so they run with a small ceiling.
process.env.NORDUS_ATTACHMENTS_MAX_BYTES = String(512 * 1024 * 1024);

const {
  ATTACHMENTS_DIR,
  ATTACHMENTS_MAX_BYTES,
  attachmentsMaxBytes,
  ATTACHMENT_PARTIAL_MAX_AGE_MS,
  DEFAULT_ATTACHMENTS_MAX_BYTES,
  FILE_MAX_BYTES,
  FILE_PART_MAX_BYTES,
  HTML_MAX_BYTES,
  VIDEO_MAX_BYTES,
  IMAGE_MAX_BYTES,
  __resetAttachmentAccountingForTests,
  cleanupStaleAttachmentPartials,
  completeFileParts,
  genericExtensionForName,
  saveFilePart,
  deleteAttachment,
  extensionForFileMime,
  extensionForMime,
  parseByteRange,
  readAttachment,
  sanitizeSharedFileName,
  saveAudio,
  saveFile,
  saveImage,
  saveImageUpload,
  validateAttachmentUploadId,
} = await import("./attachments.ts");

// Anything that mutates ATTACHMENTS_DIR on disk must reset the in-memory quota cache, or the next check trusts stale counts.
function resetDir() {
  rmSync(ATTACHMENTS_DIR, { recursive: true, force: true });
  __resetAttachmentAccountingForTests();
}

const UPLOAD_A = "11111111-1111-4111-8111-111111111111";
const UPLOAD_B = "22222222-2222-4222-8222-222222222222";

describe("extensionForMime", () => {
  it("maps the accepted image mimes to extensions", () => {
    expect(extensionForMime("image/png")).toBe(".png");
    expect(extensionForMime("image/jpeg")).toBe(".jpg");
    expect(extensionForMime("image/gif")).toBe(".gif");
    expect(extensionForMime("image/webp")).toBe(".webp");
  });

  it("tolerates parameters and casing", () => {
    expect(extensionForMime("Image/PNG; charset=binary")).toBe(".png");
    expect(extensionForMime("  image/webp  ")).toBe(".webp");
  });

  it("refuses everything else — including svg, which executes script", () => {
    expect(extensionForMime("image/svg+xml")).toBeNull();
    expect(extensionForMime("text/plain")).toBeNull();
    expect(extensionForMime(undefined)).toBeNull();
  });
});

describe("saveImage", () => {
  beforeEach(() => {
    resetDir();
  });
  afterEach(() => {
    resetDir();
  });

  it("persists bytes under the attachments dir with a generated name", () => {
    const saved = saveImage(Buffer.from("png-bytes"), "image/png");
    expect(saved.path.startsWith(ATTACHMENTS_DIR)).toBe(true);
    expect(saved.path.endsWith(".png")).toBe(true);
    expect(saved.bytes).toBe(9);
    expect(saved.mime).toBe("image/png");
    if (process.platform !== "win32") {
      expect(statSync(ATTACHMENTS_DIR).mode & 0o777).toBe(0o700);
      expect(statSync(saved.path).mode & 0o777).toBe(0o600);
    }
  });

  it("round-trips through readAttachment with the right mime", () => {
    const saved = saveImage(Buffer.from("gif!"), "image/gif");
    const name = saved.path.split(/[\\/]/).pop()!;
    const back = readAttachment(name);
    expect(back?.bytes.toString()).toBe("gif!");
    expect(back?.mime).toBe("image/gif");
  });

  it("records the picture's width and height in the saved name, and a retry finds that name", () => {
    const header = Buffer.alloc(33);
    header.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
    header.writeUInt32BE(1200, 16);
    header.writeUInt32BE(800, 20);
    const saved = saveImage(header, "image/png", UPLOAD_A);
    expect(saved.path.split(/[\\/]/).pop()).toBe(`${UPLOAD_A}-w1200h800.png`);
    expect(saveImage(header, "image/png", UPLOAD_A)).toEqual(saved);
    expect(() => saveImage(header, "image/jpeg", UPLOAD_A)).toThrow(/another content type/);
    expect(() => saveImage(Buffer.from("other bytes"), "image/png", UPLOAD_A)).toThrow(/different image bytes/);
    const taller = Buffer.from(header);
    taller.writeUInt32BE(900, 20);
    expect(() => saveImage(taller, "image/png", UPLOAD_A)).toThrow(/different image bytes/);
    expect(() => saveImage(Buffer.from("gif!"), "image/gif", UPLOAD_A)).toThrow(/another content type/);
    expect(readAttachment(`${UPLOAD_A}-w1200h800.png`)?.mime).toBe("image/png");
  });

  it("rejects unsupported mimes, empty bodies, and oversize bodies", () => {
    expect(() => saveImage(Buffer.from("x"), "image/svg+xml")).toThrow(/unsupported image type/);
    expect(() => saveImage(Buffer.alloc(0), "image/png")).toThrow(/empty/);
    expect(() => saveImage(Buffer.alloc(IMAGE_MAX_BYTES + 1), "image/png")).toThrow(/exceeds/);
  });

  it("makes UUID-keyed image retries idempotent without changing legacy callers", () => {
    const first = saveImage(Buffer.from("same"), "image/png", UPLOAD_A);
    const retry = saveImage(Buffer.from("same"), "image/png", UPLOAD_A.toUpperCase());
    expect(retry).toEqual(first);
    expect(readdirSync(ATTACHMENTS_DIR).filter((name) => !name.startsWith("."))).toEqual([`${UPLOAD_A}.png`]);

    expect(() => saveImage(Buffer.from("different"), "image/png", UPLOAD_A)).toThrow(/different image bytes/);
    expect(() => saveImage(Buffer.from("same"), "image/jpeg", UPLOAD_A)).toThrow(/another content type/);

    const legacyOne = saveImage(Buffer.from("same"), "image/png");
    const legacyTwo = saveImage(Buffer.from("same"), "image/png");
    expect(legacyOne.path).not.toBe(legacyTwo.path);
  });

  it("validates upload IDs before they can become filenames", () => {
    expect(validateAttachmentUploadId(UPLOAD_A.toUpperCase())).toBe(UPLOAD_A);
    for (const value of ["", "short", "../../escape", `${UPLOAD_A}.png`, "00000000-0000-0000-0000-000000000000"]) {
      expect(() => validateAttachmentUploadId(value)).toThrow(/UUID/);
    }
  });
});

describe("saveAudio", () => {
  beforeEach(() => {
    resetDir();
  });
  afterEach(() => {
    resetDir();
  });

  it("persists an mp3 under the attachments dir with a generated name", () => {
    const saved = saveAudio(Buffer.from("mp3-bytes"), "audio/mpeg");
    expect(saved.path.startsWith(ATTACHMENTS_DIR)).toBe(true);
    expect(saved.path.endsWith(".mp3")).toBe(true);
    expect(saved.bytes).toBe(9);
    expect(saved.mime).toBe("audio/mpeg");
    if (process.platform !== "win32") expect(statSync(saved.path).mode & 0o777).toBe(0o600);
    expect(readFileSync(saved.path).toString()).toBe("mp3-bytes");
    expect(readdirSync(ATTACHMENTS_DIR)).toEqual([saved.path.split(/[\\/]/).pop()!]);
  });

  it("serves a saved note back through readAttachment as audio/mpeg", () => {
    const saved = saveAudio(Buffer.from("mp3-note!"), "audio/mpeg");
    const name = saved.path.split(/[\\/]/).pop()!;
    const back = readAttachment(name);
    expect(back?.bytes.toString()).toBe("mp3-note!");
    expect(back?.mime).toBe("audio/mpeg");
  });

  it("normalizes mime parameters and casing", () => {
    const saved = saveAudio(Buffer.from("x"), "Audio/MPEG; charset=binary");
    expect(saved.mime).toBe("audio/mpeg");
    expect(saved.path.endsWith(".mp3")).toBe(true);
  });

  it("keeps a WAV note as .wav and serves it back as audio/wav", () => {
    for (const mime of ["audio/wav", "audio/x-wav", "Audio/Wave"]) {
      const saved = saveAudio(Buffer.from(`RIFF-${mime}`), mime);
      expect(saved.mime).toBe("audio/wav");
      expect(saved.path.endsWith(".wav")).toBe(true);
      const back = readAttachment(saved.path.split(/[\\/]/).pop()!);
      expect(back?.bytes.toString()).toBe(`RIFF-${mime}`);
      expect(back?.mime).toBe("audio/wav");
    }
  });

  it("rejects other audio mimes, empty bodies, and oversize bodies", () => {
    expect(() => saveAudio(Buffer.from("x"), "audio/flac")).toThrow(/unsupported audio type/);
    expect(() => saveAudio(Buffer.alloc(0), "audio/mpeg")).toThrow(/empty/);
    expect(() => saveAudio(Buffer.alloc(FILE_MAX_BYTES + 1), "audio/mpeg")).toThrow(/exceeds/);
  });

  it("rejects at the aggregate ceiling without leaving partials and releases its reservation", () => {
    const referenced = saveImage(Buffer.from("x"), "image/png");
    truncateSync(referenced.path, ATTACHMENTS_MAX_BYTES);
    __resetAttachmentAccountingForTests();

    try {
      saveAudio(Buffer.from("y"), "audio/mpeg");
      throw new Error("expected quota rejection");
    } catch (error) {
      expect(error).toMatchObject({ status: 507 });
      expect(error).toHaveProperty("message", expect.stringMatching(/storage is full/));
    }
    expect(readdirSync(ATTACHMENTS_DIR).every((name) => !name.endsWith(".partial"))).toBe(true);

    truncateSync(referenced.path, 4);
    __resetAttachmentAccountingForTests();
    const note = saveAudio(Buffer.from("note"), "audio/mpeg");
    expect(statSync(note.path).size).toBe(4);
  });

  it("cleans up its partial and reservation when the write fails", () => {
    vi.mocked(writeFileSync).mockImplementationOnce(() => {
      throw new Error("disk full");
    });
    expect(() => saveAudio(Buffer.from("note"), "audio/mpeg")).toThrow(/disk full/);
    expect(readdirSync(ATTACHMENTS_DIR).every((name) => !name.endsWith(".partial"))).toBe(true);
    expect(() => saveAudio(Buffer.from("note"), "audio/mpeg")).not.toThrow();
  });
});

describe("attachmentsMaxBytes (environment form)", () => {
  it("keeps the 100 GiB default unless NORDUS_ATTACHMENTS_MAX_BYTES is a positive whole number of bytes", () => {
    expect(DEFAULT_ATTACHMENTS_MAX_BYTES).toBe(100 * 1024 * 1024 * 1024);
    expect(ATTACHMENTS_MAX_BYTES).toBe(512 * 1024 * 1024);
    expect(attachmentsMaxBytes({})).toBe(DEFAULT_ATTACHMENTS_MAX_BYTES);
    expect(attachmentsMaxBytes({ NORDUS_ATTACHMENTS_MAX_BYTES: " 4294967296 " })).toBe(4 * 1024 * 1024 * 1024);
    for (const bad of ["", "0", "-1", "2GB", "1.5", "NaN"]) {
      expect(attachmentsMaxBytes({ NORDUS_ATTACHMENTS_MAX_BYTES: bad })).toBe(DEFAULT_ATTACHMENTS_MAX_BYTES);
    }
  });
});

describe("aggregate attachment storage", () => {
  beforeEach(() => {
    resetDir();
  });
  afterEach(() => {
    resetDir();
  });

  it("rejects new data at the aggregate ceiling without pruning committed attachments", () => {
    const referenced = saveImage(Buffer.from("x"), "image/png");
    truncateSync(referenced.path, ATTACHMENTS_MAX_BYTES);
    __resetAttachmentAccountingForTests();

    try {
      saveImage(Buffer.from("y"), "image/png");
      throw new Error("expected quota rejection");
    } catch (error) {
      expect(error).toMatchObject({ status: 507 });
      expect(error).toHaveProperty("message", "attachments storage is full (512 MB limit)");
    }
    expect(existsSync(referenced.path)).toBe(true);
    expect(statSync(referenced.path).size).toBe(ATTACHMENTS_MAX_BYTES);
    expect(readdirSync(ATTACHMENTS_DIR)).toEqual([referenced.path.split(/[\\/]/).pop()!]);
  });

  it("counts concurrent reservations so uploads cannot race past the ceiling", async () => {
    const existing = saveImage(Buffer.from("x"), "image/png");
    truncateSync(existing.path, ATTACHMENTS_MAX_BYTES - 5);
    __resetAttachmentAccountingForTests();

    const first = saveFile((async function* () {
      yield Buffer.from("four");
    })(), "first.txt", "text/plain", { expectedBytes: 4 });

    expect(() => saveImage(Buffer.from("xx"), "image/png")).toThrow(/storage is full/);
    await expect(first).resolves.toMatchObject({ bytes: 4 });
  });

  it("lets an unknown-length stream use the exact space left below a reservation increment", async () => {
    const existing = saveImage(Buffer.from("x"), "image/png");
    truncateSync(existing.path, ATTACHMENTS_MAX_BYTES - 2);
    __resetAttachmentAccountingForTests();

    const saved = await saveFile((async function* () {
      yield Buffer.from("a");
    })(), "last-byte.txt", "text/plain");
    expect(saved.bytes).toBe(1);
    expect(() => saveImage(Buffer.from("b"), "image/png")).not.toThrow();
  });

  it("releases reservations and removes partials after failed uploads", async () => {
    const existing = saveImage(Buffer.from("x"), "image/png");
    truncateSync(existing.path, ATTACHMENTS_MAX_BYTES - 3);
    __resetAttachmentAccountingForTests();

    await expect(saveFile((async function* () {})(), "empty.txt", "text/plain", { expectedBytes: 3 }))
      .rejects.toThrow(/empty file/);
    expect(() => saveImage(Buffer.from("123"), "image/png")).not.toThrow();
    expect(readdirSync(ATTACHMENTS_DIR).every((name) => !name.endsWith(".partial"))).toBe(true);
  });

  it("cleans only stale upload partials, never committed or active-looking files", () => {
    saveImage(Buffer.from("kept"), "image/png", UPLOAD_A);
    const stale = `${ATTACHMENTS_DIR}/.nordus-upload-${UPLOAD_A}-${UPLOAD_B}.partial`;
    const fresh = `${ATTACHMENTS_DIR}/.nordus-upload-${UPLOAD_B}-${UPLOAD_A}.partial`;
    const unrelated = `${ATTACHMENTS_DIR}/notes.partial`;
    writeFileSync(stale, "stale");
    writeFileSync(fresh, "fresh");
    writeFileSync(unrelated, "not ours");
    const now = Date.now();
    const old = new Date(now - ATTACHMENT_PARTIAL_MAX_AGE_MS - 1_000);
    utimesSync(stale, old, old);

    expect(cleanupStaleAttachmentPartials(now)).toBe(1);
    expect(existsSync(stale)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
    expect(existsSync(unrelated)).toBe(true);
    expect(existsSync(`${ATTACHMENTS_DIR}/${UPLOAD_A}.png`)).toBe(true);
  });

  it("counts fresh crash leftovers against quota, then reclaims them once a cleanup sweep runs", () => {
    const existing = saveImage(Buffer.from("x"), "image/png");
    truncateSync(existing.path, ATTACHMENTS_MAX_BYTES - 2);
    __resetAttachmentAccountingForTests();
    const orphan = `${ATTACHMENTS_DIR}/.nordus-upload-${UPLOAD_A}-${UPLOAD_B}.partial`;
    writeFileSync(orphan, "xx");

    expect(() => saveImage(Buffer.from("y"), "image/png")).toThrow(/storage is full/);
    const old = new Date(Date.now() - ATTACHMENT_PARTIAL_MAX_AGE_MS - 1_000);
    utimesSync(orphan, old, old);
    expect(cleanupStaleAttachmentPartials()).toBe(1);
    expect(() => saveImage(Buffer.from("y"), "image/png")).not.toThrow();
    expect(existsSync(orphan)).toBe(false);
  });

  it("reclaims an inactive partial immediately when its upload ID retries", async () => {
    const existing = saveImage(Buffer.from("x"), "image/png");
    truncateSync(existing.path, ATTACHMENTS_MAX_BYTES - 3);
    __resetAttachmentAccountingForTests();
    const orphan = `${ATTACHMENTS_DIR}/.nordus-upload-${UPLOAD_A}-${UPLOAD_B}.partial`;
    writeFileSync(orphan, "old");

    const saved = await saveFile((async function* () {
      yield Buffer.from("new");
    })(), "retry.txt", "text/plain", { uploadId: UPLOAD_A, expectedBytes: 3 });
    expect(saved.path.endsWith(`${UPLOAD_A}.txt`)).toBe(true);
    expect(existsSync(orphan)).toBe(false);
  });

  it("frees quota after deleteAttachment, without a rescan, for a file the cache already knows about", () => {
    const first = saveImage(Buffer.from("x"), "image/png");
    truncateSync(first.path, ATTACHMENTS_MAX_BYTES - 2);
    __resetAttachmentAccountingForTests();
    expect(() => saveImage(Buffer.from("yyy"), "image/png")).toThrow(/storage is full/);

    deleteAttachment(first.path);
    expect(existsSync(first.path)).toBe(false);
    const second = saveImage(Buffer.from("yyy"), "image/png");
    expect(second.bytes).toBe(3);
    expect(readdirSync(ATTACHMENTS_DIR)).toEqual([second.path.split(/[\\/]/).pop()!]);
  });

  it.each([1, 2])("counts a committed upload after %i partial-cleanup failures and an idempotent retry", async (failures) => {
    const existing = saveImage(Buffer.from("x"), "image/png");
    truncateSync(existing.path, ATTACHMENTS_MAX_BYTES - 3);
    __resetAttachmentAccountingForTests();
    const cleanupError = Object.assign(new Error("partial file is locked"), { code: "EPERM" });
    for (let attempt = 0; attempt < failures; attempt++) {
      vi.mocked(unlink).mockRejectedValueOnce(cleanupError);
    }
    const chunks = async function* () { yield Buffer.from("xx"); };

    await expect(saveFile(chunks(), "retry.txt", "text/plain", { uploadId: UPLOAD_A }))
      .rejects.toThrow("partial file is locked");
    expect(readFileSync(join(ATTACHMENTS_DIR, `${UPLOAD_A}.txt`), "utf8")).toBe("xx");
    expect(readdirSync(ATTACHMENTS_DIR).filter((name) => name.endsWith(".partial"))).toHaveLength(failures - 1);

    await expect(saveFile(chunks(), "retry.txt", "text/plain", { uploadId: UPLOAD_A }))
      .resolves.toMatchObject({ bytes: 2 });
    expect(readdirSync(ATTACHMENTS_DIR).some((name) => name.endsWith(".partial"))).toBe(false);
    expect(() => saveImage(Buffer.from("y"), "image/png")).not.toThrow();
    expect(() => saveImage(Buffer.from("z"), "image/png")).toThrow(/storage is full/);
  });

  it.each([1, 2])("counts an image after %i partial-cleanup failures and an idempotent retry", async (failures) => {
    const existing = saveImage(Buffer.from("x"), "image/png");
    truncateSync(existing.path, ATTACHMENTS_MAX_BYTES - 3);
    __resetAttachmentAccountingForTests();
    for (let attempt = 0; attempt < failures; attempt++) {
      vi.mocked(unlinkSync).mockImplementationOnce(() => {
        throw Object.assign(new Error("partial file is locked"), { code: "EPERM" });
      });
    }

    expect(() => saveImage(Buffer.from("xx"), "image/png", UPLOAD_A)).toThrow("partial file is locked");
    expect(readFileSync(join(ATTACHMENTS_DIR, `${UPLOAD_A}.png`), "utf8")).toBe("xx");
    expect(readdirSync(ATTACHMENTS_DIR).filter((name) => name.endsWith(".partial"))).toHaveLength(failures - 1);
    await expect(saveImageUpload(Buffer.from("xx"), "image/png", UPLOAD_A)).resolves.toMatchObject({ bytes: 2 });
    expect(readdirSync(ATTACHMENTS_DIR).some((name) => name.endsWith(".partial"))).toBe(false);
    expect(() => saveImage(Buffer.from("y"), "image/png")).not.toThrow();
    expect(() => saveImage(Buffer.from("z"), "image/png")).toThrow(/storage is full/);
  });

  it("does not count an in-flight commit twice when cleanup failure causes a rescan", async () => {
    const existing = saveImage(Buffer.from("x"), "image/png");
    truncateSync(existing.path, ATTACHMENTS_MAX_BYTES - 5);
    __resetAttachmentAccountingForTests();
    let markLinked!: () => void;
    let finishCommit!: () => void;
    const linked = new Promise<void>((resolve) => { markLinked = resolve; });
    const finishing = new Promise<void>((resolve) => { finishCommit = resolve; });
    vi.mocked(link).mockImplementationOnce(async (...args) => {
      await realLink(...args);
      markLinked();
      await finishing;
    });
    const pending = saveFile((async function* () { yield Buffer.from("xx"); })(), "pending.txt", "text/plain", {
      uploadId: UPLOAD_A, expectedBytes: 2,
    });
    try {
      await linked;
      for (let attempt = 0; attempt < 2; attempt++) {
        vi.mocked(unlinkSync).mockImplementationOnce(() => {
          throw Object.assign(new Error("partial file is locked"), { code: "EPERM" });
        });
      }
      expect(() => saveImage(Buffer.from("x"), "image/png", UPLOAD_B)).toThrow("partial file is locked");
      // This scan sees the linked file while its commit callback is pending.
      expect(() => saveImage(Buffer.from("y"), "image/png")).toThrow(/storage is full/);
    } finally {
      finishCommit();
      await pending;
    }
    await saveImageUpload(Buffer.from("x"), "image/png", UPLOAD_B);
    expect(() => saveImage(Buffer.from("yy"), "image/png")).not.toThrow();
    expect(() => saveImage(Buffer.from("z"), "image/png")).toThrow(/storage is full/);
  });

  it("initializes correctly on a fresh process against a directory that already has files", () => {
    // No save has happened yet in this test, so the cache is cold, as after a restart that finds attachments on disk.
    mkdirSync(ATTACHMENTS_DIR, { recursive: true });
    const preexisting = join(ATTACHMENTS_DIR, "11111111-1111-4111-8111-111111111111.png");
    writeFileSync(preexisting, "x");
    truncateSync(preexisting, ATTACHMENTS_MAX_BYTES - 2);

    expect(() => saveImage(Buffer.from("yyy"), "image/png")).toThrow(/storage is full/);
    expect(() => saveImage(Buffer.from("y"), "image/png")).not.toThrow();
  });
});

describe("readAttachment name lock", () => {
  beforeEach(() => {
    resetDir();
  });
  afterEach(() => {
    resetDir();
  });

  it("refuses traversal, dotfiles, and names the saver never writes", () => {
    expect(readAttachment("..%2F..%2Fconfig.json")).toBeNull();
    expect(readAttachment(".env")).toBeNull();
    expect(readAttachment("a/b.png")).toBeNull();
    expect(readAttachment("no-extension")).toBeNull();
    expect(readAttachment("uuid.jpeg")).toBeNull(); // saved as .jpg
    expect(readAttachment("note.wav")).toBeNull(); // only .mp3 audio is written
  });
});

describe("parseByteRange", () => {
  const SIZE = 1000;

  it("parses bounded, open-ended, and suffix ranges", () => {
    expect(parseByteRange("bytes=0-499", SIZE)).toEqual({ kind: "range", start: 0, end: 499 });
    expect(parseByteRange("bytes=500-999", SIZE)).toEqual({ kind: "range", start: 500, end: 999 });
    expect(parseByteRange("bytes=400-", SIZE)).toEqual({ kind: "range", start: 400, end: 999 });
    expect(parseByteRange("bytes=-100", SIZE)).toEqual({ kind: "range", start: 900, end: 999 });
    // a suffix longer than the file is the whole file
    expect(parseByteRange("bytes=-9999", SIZE)).toEqual({ kind: "range", start: 0, end: 999 });
  });

  it("clamps an end past EOF to the last byte", () => {
    expect(parseByteRange("bytes=990-5000", SIZE)).toEqual({ kind: "range", start: 990, end: 999 });
  });

  it("answers unsatisfiable for a start at or past EOF and a zero suffix", () => {
    expect(parseByteRange("bytes=1000-", SIZE)).toEqual({ kind: "unsatisfiable" });
    expect(parseByteRange("bytes=1000-1200", SIZE)).toEqual({ kind: "unsatisfiable" });
    expect(parseByteRange("bytes=-0", SIZE)).toEqual({ kind: "unsatisfiable" });
    expect(parseByteRange("bytes=0-", 0)).toEqual({ kind: "unsatisfiable" });
  });

  it("ignores absent, malformed, multi-range, and non-bytes headers", () => {
    expect(parseByteRange(undefined, SIZE)).toEqual({ kind: "none" });
    expect(parseByteRange("", SIZE)).toEqual({ kind: "none" });
    expect(parseByteRange("bytes=-", SIZE)).toEqual({ kind: "none" });
    expect(parseByteRange("bytes=0-99,200-299", SIZE)).toEqual({ kind: "none" });
    expect(parseByteRange("bytes=a-b", SIZE)).toEqual({ kind: "none" });
    expect(parseByteRange("bytes=99-0", SIZE)).toEqual({ kind: "none" });
    expect(parseByteRange("bytes=0 - 99", SIZE)).toEqual({ kind: "none" });
    expect(parseByteRange("chunks=0-99", SIZE)).toEqual({ kind: "none" });
    // surrounding OWS is legal per RFC 9110 and common from proxies
    expect(parseByteRange("  bytes=0-99  ", SIZE)).toEqual({ kind: "range", start: 0, end: 99 });
  });

  it("distinguishes an empty suffix from a zero suffix", () => {
    // no bounds at all is malformed input: answer with the full 200 body
    expect(parseByteRange("bytes=-", SIZE)).toEqual({ kind: "none" });
    // a real zero-length suffix is valid but unsatisfiable, per RFC 9110
    expect(parseByteRange("bytes=-0", SIZE)).toEqual({ kind: "unsatisfiable" });
  });
});

describe("shared files", () => {
  beforeEach(() => {
    resetDir();
  });
  afterEach(() => {
    resetDir();
  });

  it("allows useful document mimes but not executables, archives, or active markup", () => {
    expect(extensionForFileMime("text/plain; charset=utf-8")).toBe(".txt");
    expect(extensionForFileMime("application/pdf")).toBe(".pdf");
    expect(extensionForFileMime("application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe(".docx");
    expect(extensionForFileMime("application/zip")).toBeNull();
    expect(extensionForFileMime("application/x-msdownload")).toBeNull();
    expect(extensionForFileMime("application/octet-stream")).toBeNull();
    expect(extensionForFileMime("text/html")).toBeNull();
    expect(extensionForFileMime("text/html; charset=utf-8")).toBeNull();
    // Only a bot's attach_file opts in; a person's upload never does.
    expect(extensionForFileMime("text/html", { allowHtml: true })).toBe(".html");
    expect(extensionForFileMime("image/svg+xml")).toBeNull();
  });

  it("sanitizes the display name and derives its extension from the mime", () => {
    expect(sanitizeSharedFileName("  Quarterly: report.exe  ", "application/pdf")).toBe("Quarterly_ report.pdf");
    expect(sanitizeSharedFileName("notes", "text/markdown")).toBe("notes.md");
    expect(() => sanitizeSharedFileName("../../secret.txt", "text/plain")).toThrow(/filename, not a path/);
    expect(() => sanitizeSharedFileName("..\\..\\secret.txt", "text/plain")).toThrow(/filename, not a path/);
    expect(() => sanitizeSharedFileName("..%2F..%2Fsecret.txt", "text/plain")).toThrow(/filename, not a path/);
    expect(() => sanitizeSharedFileName("notes.txt", "application/zip")).toThrow(/supported document/);
  });

  it("streams a file under a generated name with private permissions", async () => {
    async function* chunks() {
      yield Buffer.from("first ");
      yield Buffer.from("second");
    }
    const saved = await saveFile(chunks(), "Meeting notes.md", "Text/Markdown; charset=utf-8");
    expect(saved.name).toBe("Meeting notes.md");
    expect(saved.mime).toBe("text/markdown");
    expect(saved.bytes).toBe(12);
    expect(saved.path.startsWith(ATTACHMENTS_DIR)).toBe(true);
    expect(saved.path).toMatch(/[0-9a-f-]+\.md$/);
    expect(readFileSync(saved.path, "utf8")).toBe("first second");
    if (process.platform !== "win32") {
      expect(statSync(ATTACHMENTS_DIR).mode & 0o777).toBe(0o700);
      expect(statSync(saved.path).mode & 0o777).toBe(0o600);
    }
  });

  it.each([
    ["audio/opus", ".opus"], ["audio/ogg; codecs=opus", ".ogg"],
    ["audio/mpeg", ".mp3"], ["audio/mp4", ".m4a"],
    ["audio/x-wav", ".wav"], ["audio/aac", ".aac"],
    ["audio/flac", ".flac"], ["audio/webm", ".webm"],
  ])("stores %s audio privately and retries without duplicating it", async (mime, extension) => {
    const bytes = Buffer.from([0, 255, 1, 128, 79, 103, 103, 83]);
    const chunks = async function* () { yield bytes.subarray(0, 3); yield bytes.subarray(3); };
    const first = await saveFile(chunks(), "Voice note.opus", mime, { uploadId: UPLOAD_A });
    const again = await saveFile(chunks(), "Voice note.opus", mime, { uploadId: UPLOAD_A });
    expect(again.path).toBe(first.path);
    expect(first.path).toBe(join(ATTACHMENTS_DIR, `${UPLOAD_A}${extension}`));
    expect(first.name).toBe(`Voice note${extension}`);
    expect(readFileSync(first.path)).toEqual(bytes);
    if (process.platform !== "win32") expect(statSync(first.path).mode & 0o777).toBe(0o600);
    expect(readdirSync(ATTACHMENTS_DIR)).toEqual([`${UPLOAD_A}${extension}`]);
  });

  it("rejects empty and oversized streams without leaving partial files", async () => {
    await expect(saveFile((async function* () {})(), "empty.txt", "text/plain")).rejects.toThrow(/empty file/);
    expect(readdirSync(ATTACHMENTS_DIR)).toEqual([]);

    async function* tooLarge() {
      yield Buffer.from("partial");
      yield Buffer.alloc(HTML_MAX_BYTES);
    }
    await expect(saveFile(tooLarge(), "large.html", "text/html", { allowHtml: true })).rejects.toMatchObject({ status: 413 });
    expect(readdirSync(ATTACHMENTS_DIR)).toEqual([]);
  });

  it("deduplicates concurrent and later file retries by upload ID", async () => {
    const makeChunks = async function* () {
      yield Buffer.from("same ");
      await Promise.resolve();
      yield Buffer.from("document");
    };
    const [first, concurrentRetry] = await Promise.all([
      saveFile(makeChunks(), "Report.pdf", "application/pdf", { uploadId: UPLOAD_A, expectedBytes: 13 }),
      saveFile(makeChunks(), "Report.pdf", "application/pdf", { uploadId: UPLOAD_A, expectedBytes: 13 }),
    ]);
    expect(concurrentRetry.path).toBe(first.path);
    expect(readFileSync(first.path, "utf8")).toBe("same document");
    expect(readdirSync(ATTACHMENTS_DIR)).toEqual([`${UPLOAD_A}.pdf`]);

    await expect(saveFile((async function* () {
      yield Buffer.from("other bytes");
    })(), "Report.pdf", "application/pdf", { uploadId: UPLOAD_A }))
      .rejects.toMatchObject({ status: 409 });
    expect(readFileSync(first.path, "utf8")).toBe("same document");
  });

  it("serializes the upload ID namespace across image and document routes", async () => {
    let started!: () => void;
    let finish!: () => void;
    const didStart = new Promise<void>((resolve) => { started = resolve; });
    const mayFinish = new Promise<void>((resolve) => { finish = resolve; });
    const document = saveFile((async function* () {
      yield Buffer.from("first");
      started();
      await mayFinish;
      yield Buffer.from("second");
    })(), "race.pdf", "application/pdf", { uploadId: UPLOAD_A, expectedBytes: 11 });

    await didStart;
    const image = saveImageUpload(Buffer.from("image"), "image/png", UPLOAD_A);
    finish();
    await expect(document).resolves.toMatchObject({ bytes: 11 });
    await expect(image).rejects.toMatchObject({ status: 409 });
    expect(readdirSync(ATTACHMENTS_DIR)).toEqual([`${UPLOAD_A}.pdf`]);
  });
});

describe("attachmentsMaxBytes", () => {
  it("reads a positive whole number of bytes from the environment", () => {
    expect(attachmentsMaxBytes("107374182400")).toBe(107374182400);
    expect(attachmentsMaxBytes(" 1048576 ")).toBe(1048576);
  });

  it("keeps the 100 GiB default for anything else", () => {
    const fallback = 100 * 1024 * 1024 * 1024;
    for (const raw of [undefined, "", "0", "-5", "1.5", "100GB", "1e12", "99999999999999999999"]) {
      expect(attachmentsMaxBytes(raw)).toBe(fallback);
    }
  });
});


describe("chunked file upload", () => {
  const bytes = Buffer.from("0123456789abcdefghijklmnopqrstuvwxyz");
  const stream = (b: Buffer) => (async function* () { yield b; })();
  const part = (offset: number, end: number, id = UPLOAD_A, total = bytes.byteLength) =>
    saveFilePart(stream(bytes.subarray(offset, end)), "clip.mp4", "video/mp4", { uploadId: id, offset, total });
  const complete = (id = UPLOAD_A, total = bytes.byteLength) =>
    completeFileParts("clip.mp4", "video/mp4", { uploadId: id, total });

  beforeEach(() => resetDir());
  afterEach(() => resetDir());

  it("raises the limits to 50 GB for video and 2 GB for other files", () => {
    expect(VIDEO_MAX_BYTES).toBe(50 * 1024 ** 3);
    expect(FILE_MAX_BYTES).toBe(2 * 1024 ** 3);
    expect(IMAGE_MAX_BYTES).toBe(10 * 1024 * 1024);
    expect(HTML_MAX_BYTES).toBe(10 * 1024 * 1024);
  });

  it("assembles ordered parts into the same result saveFile gives", async () => {
    expect(await part(0, 10)).toEqual({ received: 10, total: 36 });
    expect(await part(10, 25)).toEqual({ received: 25, total: 36 });
    expect(await part(25, 36)).toEqual({ received: 36, total: 36 });
    const saved = await complete();
    expect(saved).toMatchObject({ name: "clip.mp4", mime: "video/mp4", bytes: 36 });
    expect(saved.path).toBe(join(ATTACHMENTS_DIR, `${UPLOAD_A}.mp4`));
    expect(readFileSync(saved.path).equals(bytes)).toBe(true);
    expect(readdirSync(ATTACHMENTS_DIR)).toEqual([`${UPLOAD_A}.mp4`]);
    // closing twice, or repeating a part after the end, changes nothing
    expect((await complete()).path).toBe(saved.path);
    expect(await part(0, 10)).toEqual({ received: 36, total: 36 });
    expect(readFileSync(saved.path).equals(bytes)).toBe(true);
  });

  it("accepts a repeated part when the bytes match and refuses it when they differ", async () => {
    await part(0, 10);
    expect(await part(0, 10)).toEqual({ received: 10, total: 36 });
    // a retry that overlaps what is held and goes past it appends only the new tail
    expect(await part(5, 20)).toEqual({ received: 20, total: 36 });
    await expect(saveFilePart(stream(Buffer.from("XXXXXXXXXX")), "clip.mp4", "video/mp4", { uploadId: UPLOAD_A, offset: 0, total: 36 }))
      .rejects.toMatchObject({ status: 409, received: 20 });
    await part(20, 36);
    expect(readFileSync((await complete()).path).equals(bytes)).toBe(true);
  });

  it("refuses a part that skips ahead and says how much it holds", async () => {
    await expect(part(10, 20)).rejects.toMatchObject({ status: 409, received: 0 });
    await part(0, 10);
    await expect(part(15, 25)).rejects.toMatchObject({ status: 409, received: 10 });
  });

  it("refuses to complete a short upload and an unknown one", async () => {
    await part(0, 10);
    await expect(complete()).rejects.toMatchObject({ status: 409, received: 10 });
    await expect(complete(UPLOAD_B)).rejects.toMatchObject({ status: 404 });
  });

  it("checks total, offset, part size, mime and upload id", async () => {
    const send = (offset: number, total: number, id: string | null = UPLOAD_A, mime = "video/mp4") =>
      saveFilePart(stream(Buffer.from("abc")), "clip.mp4", mime, { uploadId: id ?? undefined, offset, total });
    await expect(send(0, 0)).rejects.toMatchObject({ status: 400 });
    await expect(send(5, 5)).rejects.toMatchObject({ status: 400 });
    await expect(send(0, VIDEO_MAX_BYTES + 1)).rejects.toMatchObject({ status: 413 });
    await expect(send(0, FILE_MAX_BYTES + 1, UPLOAD_A, "application/pdf")).rejects.toMatchObject({ status: 413 });
    await expect(send(0, 10, null)).rejects.toMatchObject({ status: 400 });
    await expect(send(0, 10, "nope")).rejects.toMatchObject({ status: 400 });
    await expect(send(0, 2)).rejects.toMatchObject({ status: 400 }); // part runs past total
    await expect(saveFilePart(stream(Buffer.alloc(0)), "clip.mp4", "video/mp4", { uploadId: UPLOAD_A, offset: 0, total: 10 }))
      .rejects.toMatchObject({ status: 400 });
    expect(FILE_PART_MAX_BYTES).toBe(64 * 1024 * 1024);
    await expect(saveFilePart((async function* () { yield Buffer.alloc(FILE_PART_MAX_BYTES + 1); })(), "clip.mp4", "video/mp4", { uploadId: UPLOAD_A, offset: 0, total: FILE_PART_MAX_BYTES + 2 }))
      .rejects.toMatchObject({ status: 413 });
    expect(readdirSync(ATTACHMENTS_DIR).filter((n) => n.endsWith(".mp4"))).toEqual([]);
  });

  it("keeps the part held when a later part fails midway", async () => {
    await part(0, 10);
    async function* broken() {
      yield bytes.subarray(10, 15);
      throw new Error("connection dropped");
    }
    await expect(saveFilePart(broken(), "clip.mp4", "video/mp4", { uploadId: UPLOAD_A, offset: 10, total: 36 })).rejects.toThrow(/dropped/);
    expect(await part(10, 36)).toEqual({ received: 36, total: 36 });
    expect(readFileSync((await complete()).path).equals(bytes)).toBe(true);
  });

  it("counts held parts against the total storage ceiling", async () => {
    const small = Buffer.alloc(8 * 1024 * 1024, 1);
    const total = 600 * 1024 * 1024; // above the 512 MB ceiling this suite runs with
    let received = 0;
    let refused: unknown;
    try {
      for (; received < total; received += small.byteLength) {
        await saveFilePart(stream(small), "clip.mp4", "video/mp4", { uploadId: UPLOAD_A, offset: received, total });
      }
    } catch (error) {
      refused = error;
    }
    expect(refused).toMatchObject({ status: 507 });
    expect(received).toBeLessThanOrEqual(ATTACHMENTS_MAX_BYTES);
    expect(received).toBeGreaterThan(0);
  }, 120_000);

  it("lets the age sweep remove an abandoned chunked partial", async () => {
    await part(0, 10);
    const partial = readdirSync(ATTACHMENTS_DIR).find((n) => n.endsWith(".partial"))!;
    expect(partial).toBeDefined();
    const old = new Date(Date.now() - ATTACHMENT_PARTIAL_MAX_AGE_MS - 1000);
    utimesSync(join(ATTACHMENTS_DIR, partial), old, old);
    expect(cleanupStaleAttachmentPartials()).toBe(1);
    expect(readdirSync(ATTACHMENTS_DIR)).toEqual([]);
  });
});

describe("generic files (any type)", () => {
  const stream = (b: Buffer) => (async function* () { yield b; })();
  beforeEach(() => resetDir());
  afterEach(() => resetDir());

  const bytes = Buffer.from("PK\u0003\u0004 not really a zip");

  it("derives the stored extension from the name, only [a-z0-9], else .bin", () => {
    expect(genericExtensionForName("Gotham-Font.zip")).toBe(".zip");
    expect(genericExtensionForName("Gotham.OTF")).toBe(".otf");
    expect(genericExtensionForName("README")).toBe(".bin");
    expect(genericExtensionForName(".bashrc")).toBe(".bin");
    expect(genericExtensionForName("weird.ex e")).toBe(".bin");
    expect(genericExtensionForName("weird.waytoolongextension")).toBe(".bin");
    expect(genericExtensionForName("a.tar.gz")).toBe(".gz");
  });

  it("stores a zip under <uuid>.zip and keeps the original name", async () => {
    const saved = await saveFile(stream(bytes), "Gotham-Font.zip", "application/zip", { uploadId: UPLOAD_A });
    expect(saved).toMatchObject({ name: "Gotham-Font.zip", mime: "application/octet-stream", bytes: bytes.byteLength });
    expect(saved.path).toBe(join(ATTACHMENTS_DIR, `${UPLOAD_A}.zip`));
    expect(readFileSync(saved.path).equals(bytes)).toBe(true);
  });

  it("accepts a font with the browser's own font mime, with an empty mime and with octet-stream", async () => {
    expect((await saveFile(stream(bytes), "a.otf", "font/otf")).path).toMatch(/\.otf$/);
    expect((await saveFile(stream(bytes), "b.woff2", "")).path).toMatch(/\.woff2$/);
    const none = await saveFile(stream(bytes), "Makefile", "application/octet-stream");
    expect(none.path).toMatch(/\.bin$/);
    expect(none.name).toBe("Makefile");
  });

  it("never stores something a browser would run or render under its own extension", async () => {
    for (const name of ["a.html", "x.svg", "p.xhtml", "s.js", "d.xml", "i.png"]) {
      const saved = await saveFile(stream(bytes), name, "text/html");
      expect(saved.path).toMatch(/\.bin$/);
      expect(saved.mime).toBe("application/octet-stream");
      expect(saved.name).toBe(name);
    }
  });

  it("keeps known types exactly as before (a pdf is still a pdf; html is still refused as html for people)", async () => {
    const pdf = await saveFile(stream(bytes), "doc.pdf", "application/pdf");
    expect(pdf).toMatchObject({ mime: "application/pdf", name: "doc.pdf" });
    expect(pdf.path).toMatch(/\.pdf$/);
    const html = await saveFile(stream(bytes), "page.html", "text/html", { allowHtml: true });
    expect(html.path).toMatch(/\.html$/);
  });

  it("refuses an empty generic file and one above the file limit", async () => {
    await expect(saveFile(stream(Buffer.alloc(0)), "empty.zip", "application/zip")).rejects.toMatchObject({ status: 400 });
    await expect(saveFile(stream(bytes), "big.zip", "application/zip", { expectedBytes: FILE_MAX_BYTES + 1 })).rejects.toMatchObject({ status: 413 });
    // an unknown video type is a generic file, so it gets the file limit, not the video one
    await expect(saveFile(stream(bytes), "big.mkv", "video/x-matroska", { expectedBytes: FILE_MAX_BYTES + 1 })).rejects.toMatchObject({ status: 413 });
  });

  it("sends a generic file in parts and completes it", async () => {
    const whole = Buffer.from("0123456789abcdefghij");
    const first = await saveFilePart(stream(whole.subarray(0, 8)), "Pack.rar", "application/octet-stream", { uploadId: UPLOAD_B, offset: 0, total: 20 });
    expect(first).toEqual({ received: 8, total: 20 });
    await saveFilePart(stream(whole.subarray(8)), "Pack.rar", "application/octet-stream", { uploadId: UPLOAD_B, offset: 8, total: 20 });
    const saved = await completeFileParts("Pack.rar", "application/octet-stream", { uploadId: UPLOAD_B, total: 20 });
    expect(saved).toMatchObject({ name: "Pack.rar", mime: "application/octet-stream", bytes: 20 });
    expect(saved.path).toBe(join(ATTACHMENTS_DIR, `${UPLOAD_B}.rar`));
    expect(readFileSync(saved.path).equals(whole)).toBe(true);
    // repeating the completing call returns the same file
    expect((await completeFileParts("Pack.rar", "application/octet-stream", { uploadId: UPLOAD_B, total: 20 })).path).toBe(saved.path);
  });
});
