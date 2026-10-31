import { createHash } from "node:crypto";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { isKnowledgeError } from "./errors.ts";
import { admin, diskOf, isolated, tempService } from "./testing.ts";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

const fresh = (limits: Parameters<typeof tempService>[0]) => {
  const made = tempService(limits);
  cleanups.push(made.cleanup);
  return made.service.use(admin(isolated), "internal");
};

const shaOf = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

const codeOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return isKnowledgeError(error) ? error.code : "other";
  }
  return undefined;
};

const largestPart = (space: { blobs: { root: string } }): number => {
  const staging = join(space.blobs.root, "tmp");
  return Math.max(0, ...readdirSync(staging).map((name) => statSync(join(staging, name)).size));
};

describe("a Drive save never writes past the room the space has left", () => {
  it("stops writing a stream at the room that is left, and keeps nothing of it when it is refused", async () => {
    const mine = fresh({ spaceMaxBytes: 100, driveFileMaxBytes: 1000 });
    const first = Buffer.alloc(90, 1);
    await mine.drive.save("first.bin", first);
    const written: number[] = [];
    async function* arriving() {
      for (let index = 0; index < 12; index += 1) {
        yield Buffer.alloc(10, 2 + index);
        written.push(largestPart(mine.space));
      }
    }
    expect(await codeOf(mine.drive.save("second.bin", arriving()))).toBe("full");
    expect(written).toHaveLength(12);
    expect(Math.max(...written)).toBeLessThanOrEqual(10);
    expect(diskOf(mine.space)).toEqual({ blobs: [shaOf(first)], staging: [] });
    expect(mine.drive.list("").items.map((item) => item.name)).toEqual(["first.bin"]);
  });

  it("takes a stream that goes past the room when the space already holds those very bytes, and writes nothing more", async () => {
    const mine = fresh({ spaceMaxBytes: 100, driveFileMaxBytes: 1000 });
    const bytes = Buffer.alloc(80, 7);
    await mine.drive.save("original.bin", bytes);
    async function* again() {
      yield bytes.subarray(0, 40);
      yield bytes.subarray(40);
    }
    const copy = await mine.drive.save("copy.bin", again());
    expect(copy.outcome).toBe("created");
    expect(diskOf(mine.space)).toEqual({ blobs: [shaOf(bytes)], staging: [] });
    expect(mine.space.usedBytes()).toBe(80);
  });

  it("cuts off an upload with no declared size at the size a file may have, and leaves no trace", async () => {
    const mine = fresh({ driveFileMaxBytes: 50 });
    async function* endless() {
      for (let index = 0; index < 20; index += 1) yield Buffer.alloc(10, index);
    }
    expect(await codeOf(mine.drive.save("big.bin", endless()))).toBe("too_large");
    expect(diskOf(mine.space)).toEqual({ blobs: [], staging: [] });
  });

  it("refuses a buffer the space has no room for before it is written", async () => {
    const mine = fresh({ spaceMaxBytes: 50 });
    expect(await codeOf(mine.drive.save("big.bin", Buffer.alloc(60, 3)))).toBe("full");
    expect(diskOf(mine.space)).toEqual({ blobs: [], staging: [] });
    const fits = Buffer.alloc(40, 4);
    await mine.drive.save("fits.bin", fits);
    expect(diskOf(mine.space).blobs).toEqual([shaOf(fits)]);
  });

  it("keeps none of the content when the path it was meant for turns out to be refused", async () => {
    const mine = fresh({});
    await mine.drive.save("docs", Buffer.from("a file where a folder would go"));
    const kept = diskOf(mine.space).blobs;
    expect(kept).toHaveLength(1);
    async function* arriving() {
      yield Buffer.from("content for a path that cannot be used");
    }
    expect(await codeOf(mine.drive.save("docs/x.txt", arriving()))).toBe("path_taken");
    expect(await codeOf(mine.drive.save("docs/y.txt", Buffer.from("another one")))).toBe("path_taken");
    expect(diskOf(mine.space)).toEqual({ blobs: kept, staging: [] });
  });

  it("keeps content that another file already uses when a refused save carried the same bytes", async () => {
    const mine = fresh({});
    const shared = Buffer.from("same bytes in two places");
    await mine.drive.save("one.txt", shared);
    await mine.drive.save("docs", Buffer.from("blocks the folder"));
    expect(await codeOf(mine.drive.save("docs/two.txt", shared))).toBe("path_taken");
    expect(mine.drive.readBytes("one.txt", undefined, 1000).data.equals(shared)).toBe(true);
  });
});
