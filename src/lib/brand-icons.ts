/** Real brand marks, served from /brand: LobeHub icons (MIT) and Simple Icons (CC0), in each brand's own color. */
const BRAND_SLUGS = new Set([
  "airtable", "asana", "discord", "dropbox", "facebook", "figma", "github", "gmail", "googlecalendar", "googledocs",
  "googledrive", "googlesheets", "hubspot", "instagram", "jira", "linear", "notion", "posthog", "reddit", "sentry",
  "stripe", "trello", "x", "youtube", "zapier", "zimstudio", "vercel", "cloudflare", "paypal", "webflow", "wix", "intercom",
  "clickup", "supabase", "atlassian", "confluence", "slack", "linkedin", "whatsapp", "hubspot", "metricool", "manychat",
  "heygen", "elevenlabs", "epidemicsound",
]);

/** Brands with no vector mark in either set: the service's own icon, as a PNG. */
const RASTER_SLUGS = new Set(["metricool", "manychat", "heygen", "epidemicsound"]);

const DOMAIN_SLUGS: Array<[RegExp, string]> = [
  [/(^|\.)instagram\.com$/, "instagram"],
  [/(^|\.)(youtube\.com|youtu\.be)$/, "youtube"],
  [/(^|\.)github\.com$/, "github"],
  [/(^|\.)(twitter\.com|x\.com)$/, "x"],
  [/(^|\.)(facebook\.com|fb\.com)$/, "facebook"],
  [/(^|\.)figma\.com$/, "figma"],
  [/(^|\.)notion\.(so|site|com)$/, "notion"],
  [/^drive\.google\.com$/, "googledrive"],
  [/^docs\.google\.com$/, "googledocs"],
  [/^sheets\.google\.com$/, "googlesheets"],
  [/^calendar\.google\.com$/, "googlecalendar"],
  [/^mail\.google\.com$|(^|\.)gmail\.com$/, "gmail"],
  [/(^|\.)dropbox\.com$/, "dropbox"],
  [/(^|\.)discord\.(com|gg)$/, "discord"],
  [/(^|\.)reddit\.com$/, "reddit"],
  [/(^|\.)slack\.com$/, "slack"],
  [/(^|\.)linkedin\.com$/, "linkedin"],
  [/(^|\.)(whatsapp\.com|wa\.me)$/, "whatsapp"],
  [/(^|\.)hubspot\.com$/, "hubspot"],
  [/(^|\.)metricool\.com$/, "metricool"],
  [/(^|\.)manychat\.com$/, "manychat"],
  [/(^|\.)trello\.com$/, "trello"],
  [/(^|\.)heygen\.com$/, "heygen"],
  [/(^|\.)elevenlabs\.io$/, "elevenlabs"],
  [/(^|\.)epidemicsound\.com$/, "epidemicsound"],
  [/(^|\.)zimstudio\.(com|com\.br|app)$|(^|\.)zim\.studio$/, "zimstudio"],
];

export function brandIconSrc(slug: string | undefined | null): string | null {
  if (!slug || !BRAND_SLUGS.has(slug)) return null;
  return `/brand/${slug}.${RASTER_SLUGS.has(slug) ? "png" : "svg"}`;
}

export function brandSlugForHost(host: string): string | null {
  const clean = host.replace(/^www\./, "").toLowerCase();
  for (const [pattern, slug] of DOMAIN_SLUGS) if (pattern.test(clean)) return slug;
  return null;
}
