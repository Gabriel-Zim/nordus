import { chmodSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ROOT = mkdtempSync(join(tmpdir(), "nordus-html-transcribe-"));
process.env.NORDUS_DATA_DIR = join(ROOT, "data");
const { transcribeLocally, readLimitedBody, transcribableAudioExtension } = await import("./html-transcribe.ts");
const { ATTACHMENTS_DIR } = await import("./attachments.ts");

let service: Server;
let seen: string[] = [];
let reply: { status: number; body: unknown } = { status: 200, body: { text: "  ola mundo  " } };

beforeAll(async () => {
  // A fake ffmpeg: copies the -i input to the last argument.
  const fake = join(ROOT, "ffmpeg");
  writeFileSync(fake, '#!/bin/sh\nwhile [ "$1" != "-i" ]; do shift; done\nin="$2"\nfor a; do out="$a"; done\ncp "$in" "$out"\n');
  chmodSync(fake, 0o755);
  process.env.NORDUS_FFMPEG_PATH = fake;
  service = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      seen.push((JSON.parse(raw) as { path: string }).path);
      res.writeHead(reply.status, { "content-type": "application/json" });
      res.end(JSON.stringify(reply.body));
    });
  });
  await new Promise<void>((resolve) => service.listen(0, "127.0.0.1", resolve));
  const address = service.address();
  process.env.NORDUS_TRANSCRIBE_URL = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/transcribe`;
});
afterAll(() => { service.close(); rmSync(ROOT, { recursive: true, force: true }); });

const leftovers = () => {
  const dir = join(ATTACHMENTS_DIR, "transcrever");
  return existsSync(dir) ? readdirSync(dir) : [];
};

describe("transcribeLocally", () => {
  it("decodes to a wav inside the attachments folder, asks the local service and removes every temporary file", async () => {
    seen = [];
    reply = { status: 200, body: { text: "  ola mundo  " } };
    expect(await transcribeLocally(Buffer.from("fake-webm"), "audio/webm;codecs=opus")).toBe("ola mundo");
    expect(seen).toHaveLength(1);
    expect(seen[0]!.startsWith(join(ATTACHMENTS_DIR, "transcrever"))).toBe(true);
    expect(seen[0]!.endsWith(".wav")).toBe(true);
    expect(leftovers()).toEqual([]);
  });

  it("cleans up and reports a service failure", async () => {
    reply = { status: 500, body: { error: "boom" } };
    await expect(transcribeLocally(Buffer.from("x"), "audio/ogg")).rejects.toMatchObject({ status: 502 });
    reply = { status: 422, body: { error: "cannot decode" } };
    await expect(transcribeLocally(Buffer.from("x"), "audio/wav")).rejects.toMatchObject({ status: 422, message: "cannot decode" });
    expect(leftovers()).toEqual([]);
  });

  it("refuses an unsupported type, an empty clip and an oversized one", async () => {
    await expect(transcribeLocally(Buffer.from("x"), "audio/flac")).rejects.toMatchObject({ status: 415 });
    await expect(transcribeLocally(Buffer.alloc(0), "audio/webm")).rejects.toMatchObject({ status: 400 });
    await expect(transcribeLocally(Buffer.alloc(10 * 1024 * 1024 + 1), "audio/webm")).rejects.toMatchObject({ status: 413 });
  });

  it("reports a missing ffmpeg", async () => {
    const keep = process.env.NORDUS_FFMPEG_PATH;
    process.env.NORDUS_FFMPEG_PATH = join(ROOT, "no-such-ffmpeg");
    await expect(transcribeLocally(Buffer.from("x"), "audio/webm")).rejects.toMatchObject({ status: 503 });
    process.env.NORDUS_FFMPEG_PATH = keep;
    expect(leftovers()).toEqual([]);
  });

  it("knows the five accepted types", () => {
    for (const mime of ["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav"]) expect(transcribableAudioExtension(mime)).not.toBeNull();
    expect(transcribableAudioExtension("video/mp4")).toBeNull();
  });
});

describe("readLimitedBody", () => {
  it("stops at the cap and at the time limit", async () => {
    const big = new PassThrough();
    const over = readLimitedBody(big, 4, 1000);
    big.write(Buffer.from("12345"));
    await expect(over).rejects.toMatchObject({ status: 413 });
    const slow = new PassThrough();
    await expect(readLimitedBody(slow, 100, 20)).rejects.toMatchObject({ status: 408 });
    const ok = new PassThrough();
    const read = readLimitedBody(ok, 100, 1000);
    ok.end("abc");
    expect((await read).toString()).toBe("abc");
  });
});
