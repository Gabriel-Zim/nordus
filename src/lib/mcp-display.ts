// How a connection reads to a person: the service's own name and mark, never its server id, address or command.
import { APP_PLUGINS, samePluginUrl } from "./app-plugins";
import { brandIconSrc, brandSlugForHost } from "./brand-icons";

const KNOWN: Record<string, { label: string; slug?: string }> = {
  "zim-studio": { label: "Zim Studio", slug: "zimstudio" },
  zim: { label: "Zim Studio", slug: "zimstudio" },
  "epidemic-sound": { label: "Epidemic Sound", slug: "epidemicsound" },
  heygen: { label: "HeyGen", slug: "heygen" },
  elevenlabs: { label: "ElevenLabs", slug: "elevenlabs" },
  metricool: { label: "Metricool", slug: "metricool" },
  trello: { label: "Trello", slug: "trello" },
  manychat: { label: "ManyChat", slug: "manychat" },
  figma: { label: "Figma", slug: "figma" },
  github: { label: "GitHub", slug: "github" },
  "second-brain": { label: "Second Brain" },
  whop: { label: "Whop" },
  highlevel: { label: "HighLevel" },
  composio: { label: "Composio" },
};

export interface McpLike { name: string; url?: string; command?: string; args?: readonly string[] }

/** The service's name and brand slug; the slug is null when no mark is known. */
export function mcpDisplay(server: McpLike): { label: string; slug: string | null } {
  const base = server.name.toLowerCase().replace(/-\d+$/, "");
  const known = KNOWN[server.name.toLowerCase()] ?? KNOWN[base];
  const plugin = server.url ? APP_PLUGINS.find((entry) => samePluginUrl(entry.url, server.url!)) : undefined;
  let hostSlug: string | null = null;
  if (server.url) { try { hostSlug = brandSlugForHost(new URL(server.url).hostname); } catch { hostSlug = null; } }
  const slug = known?.slug ?? plugin?.slug ?? hostSlug ?? (brandIconSrc(base) ? base : null);
  const label = known?.label ?? plugin?.label ?? humanize(server.name);
  return { label, slug: slug && brandIconSrc(slug) ? slug : null };
}

function humanize(name: string): string {
  const words = name.replace(/[-_]+/g, " ").trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : name;
}
