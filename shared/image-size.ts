export type ImageSize = { width: number; height: number };

const MAX_SIDE = 99_999;

function plausible(width: number, height: number): ImageSize | null {
  return width > 0 && height > 0 && width <= MAX_SIDE && height <= MAX_SIDE ? { width, height } : null;
}

/** Width and height from the file header alone, for PNG, GIF, WebP and JPEG; null for anything it cannot read. */
export function readImageSize(bytes: Uint8Array): ImageSize | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (offset: number, length: number) =>
    offset + length <= bytes.length ? String.fromCharCode(...bytes.subarray(offset, offset + length)) : "";
  if (bytes.length >= 24 && ascii(1, 3) === "PNG" && ascii(12, 4) === "IHDR") {
    return plausible(view.getUint32(16), view.getUint32(20));
  }
  if (bytes.length >= 10 && ascii(0, 3) === "GIF") {
    return plausible(view.getUint16(6, true), view.getUint16(8, true));
  }
  if (bytes.length >= 30 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") {
    const chunk = ascii(12, 4);
    if (chunk === "VP8X") {
      const width = 1 + (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16));
      const height = 1 + (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16));
      return plausible(width, height);
    }
    if (chunk === "VP8 ") return plausible(view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff);
    if (chunk === "VP8L") {
      const bits = view.getUint32(21, true);
      return plausible((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1);
    }
    return null;
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) return jpegSize(bytes, view);
  return null;
}

function jpegSize(bytes: Uint8Array, view: DataView): ImageSize | null {
  let offset = 2;
  let orientation = 1;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1]!;
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    const length = view.getUint16(offset + 2);
    if (marker === 0xe1) orientation = exifOrientation(bytes, view, offset + 4, length - 2) ?? orientation;
    // Start-of-frame markers, excluding DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (offset + 9 > bytes.length) return null;
      const height = view.getUint16(offset + 5);
      const width = view.getUint16(offset + 7);
      // Orientations 5 to 8 turn the picture a quarter, so the browser shows it with the sides swapped.
      return orientation >= 5 ? plausible(height, width) : plausible(width, height);
    }
    offset += 2 + length;
  }
  return null;
}

function exifOrientation(bytes: Uint8Array, view: DataView, start: number, length: number): number | null {
  const end = Math.min(bytes.length, start + length);
  if (start + 14 > end || String.fromCharCode(...bytes.subarray(start, start + 4)) !== "Exif") return null;
  const tiff = start + 6;
  const little = bytes[tiff] === 0x49;
  const entries = tiff + view.getUint32(tiff + 4, little);
  if (entries + 2 > end) return null;
  const count = view.getUint16(entries, little);
  for (let index = 0; index < count; index += 1) {
    const entry = entries + 2 + index * 12;
    if (entry + 12 > end) return null;
    if (view.getUint16(entry, little) === 0x0112) return view.getUint16(entry + 8, little);
  }
  return null;
}

/** Saved images carry their size in the file name, so every message that cites the path already knows it. */
export function imageSizeSuffix(size: ImageSize | null): string {
  return size ? `-w${size.width}h${size.height}` : "";
}

const SIZE_IN_NAME = /-w([1-9]\d{0,4})h([1-9]\d{0,4})\.[a-z0-9]+$/i;

export function imageSizeFromName(name: string): ImageSize | null {
  const match = SIZE_IN_NAME.exec(name);
  return match ? plausible(Number(match[1]), Number(match[2])) : null;
}
