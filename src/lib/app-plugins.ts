/** Apps that connect in one click: each runs an official remote MCP server with OAuth and dynamic client registration,
 *  so the person signs in on the app itself and nothing needs a third-party key. Each reached its sign-in page from the
 *  lab on 16/10/2026. Trello is its official server (Atlassian sign-in), the one Avery already used before Nordus. */
export interface AppPlugin {
  slug: string;
  label: string;
  url: string;
  type: "http" | "sse";
  category: "work" | "design" | "dev" | "sales" | "automation";
}

export const APP_PLUGINS: readonly AppPlugin[] = [
  { slug: "notion", label: "Notion", url: "https://mcp.notion.com/mcp", type: "http", category: "work" },
  { slug: "linear", label: "Linear", url: "https://mcp.linear.app/mcp", type: "http", category: "work" },
  { slug: "trello", label: "Trello", url: "https://mcp.trello.com/v1", type: "http", category: "work" },
  { slug: "atlassian", label: "Jira e Confluence", url: "https://mcp.atlassian.com/v1/mcp", type: "http", category: "work" },
  { slug: "clickup", label: "ClickUp", url: "https://mcp.clickup.com/mcp", type: "http", category: "work" },
  { slug: "monday", label: "monday.com", url: "https://mcp.monday.com/mcp", type: "http", category: "work" },
  { slug: "airtable", label: "Airtable", url: "https://mcp.airtable.com/mcp", type: "http", category: "work" },
  { slug: "webflow", label: "Webflow", url: "https://mcp.webflow.com/mcp", type: "http", category: "design" },
  { slug: "wix", label: "Wix", url: "https://mcp.wix.com/mcp", type: "http", category: "design" },
  { slug: "metricool", label: "Metricool", url: "https://ai.metricool.com/mcp", type: "http", category: "sales" },
  { slug: "stripe", label: "Stripe", url: "https://mcp.stripe.com", type: "http", category: "sales" },
  { slug: "paypal", label: "PayPal", url: "https://mcp.paypal.com/mcp", type: "http", category: "sales" },
  { slug: "zapier", label: "Zapier", url: "https://mcp.zapier.com/api/mcp/mcp", type: "http", category: "automation" },
  { slug: "sentry", label: "Sentry", url: "https://mcp.sentry.dev/mcp", type: "http", category: "dev" },
  { slug: "cloudflare", label: "Cloudflare", url: "https://bindings.mcp.cloudflare.com/mcp", type: "http", category: "dev" },
  { slug: "supabase", label: "Supabase", url: "https://mcp.supabase.com/mcp", type: "http", category: "dev" },
];

/** Not one click yet: Google and these need an app of Nordus's own on the platform, or have no official connector. */
export const APPS_COMING: ReadonlyArray<{ slug: string; label: string; reason: "google" | "own-app" | "building" | "refused" }> = [
  { slug: "googledrive", label: "Google Drive", reason: "google" },
  { slug: "gmail", label: "Gmail", reason: "google" },
  { slug: "googlecalendar", label: "Google Agenda", reason: "google" },
  { slug: "googledocs", label: "Google Docs", reason: "google" },
  { slug: "googlesheets", label: "Google Sheets", reason: "google" },
  { slug: "github", label: "GitHub", reason: "own-app" },
  { slug: "slack", label: "Slack", reason: "own-app" },
  { slug: "hubspot", label: "HubSpot", reason: "own-app" },
  // Their sign-in servers turn away apps they have not approved (Asana, Canva, Intercom and Vercel: return address).
  { slug: "asana", label: "Asana", reason: "refused" },
  { slug: "canva", label: "Canva", reason: "refused" },
  { slug: "intercom", label: "Intercom", reason: "refused" },
  { slug: "vercel", label: "Vercel", reason: "refused" },
  { slug: "instagram", label: "Instagram", reason: "building" },
  { slug: "facebook", label: "Facebook e Meta Ads", reason: "building" },
  { slug: "whatsapp", label: "WhatsApp", reason: "building" },
  { slug: "x", label: "X", reason: "building" },
  { slug: "linkedin", label: "LinkedIn", reason: "building" },
];

export function samePluginUrl(a: string, b: string): boolean {
  const clean = (value: string) => value.trim().replace(/\/+$/, "").toLowerCase();
  return clean(a) === clean(b);
}

/** Apps that connect with a key or token the person pastes, or Trello's own authorize page; Nordus runs their connector
 *  itself, one per account. */
export interface KeyPlugin { slug: "manychat" | "figma" | "trello"; label: string; fields: Array<{ key: string; secret: boolean }> }
export const KEY_PLUGINS: readonly KeyPlugin[] = [
  { slug: "figma", label: "Figma", fields: [{ key: "token", secret: true }] },
  { slug: "trello", label: "Trello com chave da API", fields: [] },
  { slug: "manychat", label: "ManyChat", fields: [{ key: "apiKey", secret: true }] },
];

/** How the Apps list is grouped, in this order; each app (one-click, key, Google, GitHub or coming) sits in one. */
export const APP_GROUPS = ["tasks", "docs", "sites", "marketing", "talk", "sales", "dev", "automation"] as const;
export type AppGroup = typeof APP_GROUPS[number];
const GROUP_OF: Record<string, AppGroup> = {
  linear: "tasks", trello: "tasks", "trello-key": "tasks", atlassian: "tasks", clickup: "tasks", monday: "tasks", asana: "tasks",
  notion: "docs", airtable: "docs", google: "docs", googledrive: "docs", gmail: "docs", googlecalendar: "docs", googledocs: "docs", googlesheets: "docs",
  webflow: "sites", wix: "sites", figma: "sites", canva: "sites",
  metricool: "marketing", manychat: "marketing", instagram: "marketing", facebook: "marketing", whatsapp: "marketing", x: "marketing", linkedin: "marketing", hubspot: "marketing",
  slack: "talk", intercom: "talk",
  stripe: "sales", paypal: "sales",
  github: "dev", sentry: "dev", cloudflare: "dev", supabase: "dev", vercel: "dev",
  zapier: "automation",
};
export function appGroupOf(slug: string): AppGroup {
  return GROUP_OF[slug] ?? "automation";
}
