/**
 * A bot that writes an address without https:// ("averymercer.com.br/artigo/x") still means a link.
 * Only real top-level domains count, so a file name (video.mp4, notas.md) or an e-mail stays text.
 */
const TLDS = [
  "com\\.br", "net\\.br", "org\\.br", "gov\\.br", "edu\\.br", "art\\.br", "blog\\.br", "com\\.pt", "co\\.uk",
  "com", "net", "org", "ai", "io", "app", "dev", "co", "br", "me", "gg", "tv", "xyz", "site", "online",
  "store", "shop", "tech", "info", "blog", "news", "studio", "design", "agency", "digital", "cloud", "so",
  "link", "page", "art", "live", "social", "media", "pro", "biz", "us", "pt", "es", "de", "fr", "it", "ca",
  "global", "world", "life", "club", "academy",
].join("|");

export const BARE_DOMAIN = new RegExp(
  `(?<![\\w@./:\\-])((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+(?:${TLDS}))(?![\\w\\-@]|\\.[a-z0-9])(/[^\\s<>()\\[\\]"'\`]*)?`,
  "gi",
);

const TRAILING = /[.,;:!?]+$/;

interface MdNode {
  type: string;
  value?: string;
  url?: string;
  children?: MdNode[];
}

const SKIP = new Set(["link", "linkReference", "code", "inlineCode", "definition", "html", "math", "inlineMath"]);

/** The address as written and the https:// link it opens, or null when the text has none. */
export function bareDomainLinks(value: string): Array<{ start: number; text: string; url: string }> {
  const found: Array<{ start: number; text: string; url: string }> = [];
  BARE_DOMAIN.lastIndex = 0;
  for (const match of value.matchAll(BARE_DOMAIN)) {
    const text = match[0].replace(TRAILING, "");
    if (!text.includes(".")) continue;
    found.push({ start: match.index ?? 0, text, url: `https://${text}` });
  }
  return found;
}

function splitText(value: string): MdNode[] | null {
  const links = bareDomainLinks(value);
  if (!links.length) return null;
  const out: MdNode[] = [];
  let last = 0;
  for (const link of links) {
    if (link.start > last) out.push({ type: "text", value: value.slice(last, link.start) });
    out.push({ type: "link", url: link.url, children: [{ type: "text", value: link.text }] });
    last = link.start + link.text.length;
  }
  if (last < value.length) out.push({ type: "text", value: value.slice(last) });
  return out;
}

function walk(node: MdNode): void {
  if (!node.children || SKIP.has(node.type)) return;
  const next: MdNode[] = [];
  for (const child of node.children) {
    if (child.type === "text" && child.value) {
      const parts = splitText(child.value);
      if (parts) {
        next.push(...parts);
        continue;
      }
    }
    walk(child);
    next.push(child);
  }
  node.children = next;
}

export function remarkBareDomains() {
  return (tree: MdNode) => walk(tree);
}
