import { Facebook, Figma, Github, Globe, Instagram, Linkedin, Slack, Twitter, Youtube, type LucideIcon } from "lucide-react";
import { t } from "@/lib/i18n";
import { brandIconSrc, brandSlugForHost } from "@/lib/brand-icons";

const BRANDS: Array<[RegExp, LucideIcon, string]> = [
  [/(^|\.)instagram\.com$/, Instagram, "Instagram"],
  [/(^|\.)(youtube\.com|youtu\.be)$/, Youtube, "YouTube"],
  [/(^|\.)linkedin\.com$/, Linkedin, "LinkedIn"],
  [/(^|\.)github\.com$/, Github, "GitHub"],
  [/(^|\.)(twitter\.com|x\.com)$/, Twitter, "X"],
  [/(^|\.)(facebook\.com|fb\.com)$/, Facebook, "Facebook"],
  [/(^|\.)figma\.com$/, Figma, "Figma"],
  [/(^|\.)slack\.com$/, Slack, "Slack"],
];

/** Where a link goes, as people say it: an icon and "ver no Instagram" instead of the raw address. */
export function linkDestination(href: string): { icon: LucideIcon; label: string; src?: string } {
  let host = "";
  try {
    host = new URL(href).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return { icon: Globe, label: href };
  }
  const src = brandIconSrc(brandSlugForHost(host)) ?? undefined;
  for (const [pattern, icon, name] of BRANDS) {
    if (pattern.test(host)) return { icon, label: t("chat.link.seeOn", { site: name }), ...(src ? { src } : {}) };
  }
  if (src) return { icon: Globe, label: host, src };
  return { icon: Globe, label: host };
}

/** True when the bot pasted the address itself as the link text. */
export function isRawUrlText(text: string, href: string): boolean {
  const clean = (value: string) => value.trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "");
  return /^https?:\/\/|^www\./i.test(text.trim()) || clean(text) === clean(href);
}
