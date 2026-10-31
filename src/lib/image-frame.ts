import { imageSizeFromName } from "../../shared/image-size";

export function clampRatio(ratio: number): number {
  return Math.min(Math.max(ratio, 0.6), 2.4);
}

/** Saved images name their size, so the frame takes its final shape before a single byte of the picture arrives. */
export function ratioFromSource(src: string): number | null {
  let name = src.split(/[?#]/)[0]!.split("/").pop() ?? "";
  try {
    name = decodeURIComponent(name);
  } catch {
    return null;
  }
  const size = imageSizeFromName(name);
  return size ? clampRatio(size.width / size.height) : null;
}
