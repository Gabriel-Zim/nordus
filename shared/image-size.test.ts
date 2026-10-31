import { describe, expect, it } from "vitest";

import { imageSizeFromName, imageSizeSuffix, readImageSize } from "./image-size";

function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return bytes;
}

function gif(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(13);
  bytes.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
  new DataView(bytes.buffer).setUint16(6, width, true);
  new DataView(bytes.buffer).setUint16(8, height, true);
  return bytes;
}

function webpVp8x(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(30);
  bytes.set([...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WEBPVP8X")]);
  const w = width - 1;
  const h = height - 1;
  bytes.set([w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff, h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff], 24);
  return bytes;
}

function jpeg(width: number, height: number, orientation?: number): Uint8Array {
  const parts: number[] = [0xff, 0xd8];
  if (orientation) {
    const exif = [
      ...Buffer.from("Exif"), 0, 0,
      0x4d, 0x4d, 0, 42, 0, 0, 0, 8,
      0, 1,
      0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientation, 0, 0,
    ];
    parts.push(0xff, 0xe1, ((exif.length + 2) >> 8) & 0xff, (exif.length + 2) & 0xff, ...exif);
  }
  parts.push(0xff, 0xdb, 0, 4, 0, 0);
  parts.push(0xff, 0xc0, 0, 11, 8, (height >> 8) & 0xff, height & 0xff, (width >> 8) & 0xff, width & 0xff, 3, 0, 0);
  return Uint8Array.from(parts);
}

describe("readImageSize", () => {
  it("reads PNG, GIF, WebP and JPEG headers", () => {
    expect(readImageSize(png(1200, 800))).toEqual({ width: 1200, height: 800 });
    expect(readImageSize(gif(64, 48))).toEqual({ width: 64, height: 48 });
    expect(readImageSize(webpVp8x(4032, 3024))).toEqual({ width: 4032, height: 3024 });
    expect(readImageSize(jpeg(3024, 4032))).toEqual({ width: 3024, height: 4032 });
  });

  it("swaps the sides of a JPEG whose camera tag turns it a quarter", () => {
    expect(readImageSize(jpeg(4032, 3024, 6))).toEqual({ width: 3024, height: 4032 });
    expect(readImageSize(jpeg(4032, 3024, 3))).toEqual({ width: 4032, height: 3024 });
  });

  it("gives up on truncated or unknown bytes instead of guessing", () => {
    expect(readImageSize(png(10, 10).subarray(0, 20))).toBeNull();
    expect(readImageSize(Uint8Array.from([0xff, 0xd8, 0xff]))).toBeNull();
    expect(readImageSize(new TextEncoder().encode("not an image at all"))).toBeNull();
    expect(readImageSize(png(0, 10))).toBeNull();
  });
});

describe("size in the file name", () => {
  it("round-trips through the saved name", () => {
    const name = `9b2f5c4e-1d2a-4c3b-8e7f-0a1b2c3d4e5f${imageSizeSuffix({ width: 1200, height: 800 })}.png`;
    expect(imageSizeFromName(name)).toEqual({ width: 1200, height: 800 });
  });

  it("finds nothing in names saved before the size was recorded", () => {
    expect(imageSizeSuffix(null)).toBe("");
    expect(imageSizeFromName("9b2f5c4e-1d2a-4c3b-8e7f-0a1b2c3d4e5f.png")).toBeNull();
    expect(imageSizeFromName("x-w0h5.png")).toBeNull();
  });
});
