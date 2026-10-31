import type { RoboSvg } from "@/components/RoboAvatar";

/** A robot avatar waves once when its conversation opens. A photo has no robot to wave; reduced motion skips it.
 *  The engine attaches its API a moment after mount, so a just-opened header avatar is retried briefly. */
export function waveRobot(svg: RoboSvg | null | undefined, attempt = 0): void {
  if (!svg || typeof window === "undefined") return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const api = svg.nbAvatar;
  if (api) {
    api.acenar("direita");
    return;
  }
  if (attempt < 12) window.setTimeout(() => waveRobot(svg, attempt + 1), 150);
}
