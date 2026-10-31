import { splitFrontmatter, scanWikiLinks } from "../../shared/wiki-markdown";
import { extensionOf } from "../../shared/knowledge-path";
import { previewKindFor } from "../../shared/knowledge";

export const WIKI_LINK_SCHEME = "wiki:";
export const WIKI_FILE_SCHEME = "wiki-file:";

const encodeTarget = (value: string) => encodeURIComponent(value).replace(/\(/g, "%28").replace(/\)/g, "%29");
const escapeLabel = (value: string) => value.replace(/\\/g, "\\\\").replace(/\[/g, "\\[").replace(/\]/g, "\\]");

export interface WikiLinkTarget {
  target: string;
  heading?: string;
}

/** What a `wiki:` address stands for. */
export function parseWikiHref(href: string): WikiLinkTarget | null {
  if (!href.startsWith(WIKI_LINK_SCHEME)) return null;
  const rest = href.slice(WIKI_LINK_SCHEME.length);
  const hash = rest.indexOf("#");
  try {
    const target = decodeURIComponent(hash < 0 ? rest : rest.slice(0, hash));
    const heading = hash < 0 ? undefined : decodeURIComponent(rest.slice(hash + 1));
    return target ? { target, ...(heading ? { heading } : {}) } : null;
  } catch {
    return null;
  }
}

export function parseWikiFileHref(href: string): string | null {
  if (!href.startsWith(WIKI_FILE_SCHEME)) return null;
  try {
    return decodeURIComponent(href.slice(WIKI_FILE_SCHEME.length)) || null;
  } catch {
    return null;
  }
}

/** react-markdown drops addresses it does not know; the two this page writes itself are let through, everything else keeps the default. */
export function wikiUrlTransform(value: string, fallback: (value: string) => string): string {
  return value.startsWith(WIKI_LINK_SCHEME) || value.startsWith(WIKI_FILE_SCHEME) ? value : fallback(value);
}

export interface WikiRenderInput {
  content: string;
  /** Each link written in the page, mapped to the page it leads to or null. */
  links: Readonly<Record<string, string | null>>;
  /** Each image or file the page embeds, mapped to its Drive path. */
  files: Readonly<Record<string, string>>;
}

/**
 * Turns the Obsidian syntax into plain Markdown the renderer already understands: `[[Page|label]]` becomes a link to a
 * `wiki:` address, `![[picture.png]]` an image of the Drive file that holds it. Code is left alone, as it was when the
 * server read the page. The frontmatter is not part of what is read.
 */
export function wikiMarkdown(input: WikiRenderInput): string {
  const body = splitFrontmatter(input.content).body;
  const links = scanWikiLinks(body);
  let out = body;
  for (let at = links.length - 1; at >= 0; at -= 1) {
    const link = links[at]!;
    const drivePath = input.files[link.target];
    let replacement: string;
    if (link.embed && drivePath) {
      const label = escapeLabel(link.alias ?? link.target);
      const address = `${WIKI_FILE_SCHEME}${encodeTarget(drivePath)}`;
      replacement = previewKindFor(drivePath) === "image" ? `![${label}](${address})` : `[${label}](${address})`;
    } else {
      const label = escapeLabel(link.alias ?? (link.heading ? `${link.target} > ${link.heading}` : link.target));
      const address = `${WIKI_LINK_SCHEME}${encodeTarget(link.target)}${link.heading ? `#${encodeTarget(link.heading)}` : ""}`;
      replacement = `[${label}](${address})`;
    }
    out = out.slice(0, link.index) + replacement + out.slice(link.index + link.raw.length);
  }
  return out;
}

/** A line from another page, as people read it: its links show the page names they point to. */
export function plainLine(text: string): string {
  return text
    .replace(/!\[\[[^\]]*\]\]/g, "")
    .replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, "$1")
    .replace(/\[\[([^\]#]*)(?:#([^\]]*))?\]\]/g, (_match, page: string, heading?: string) => (heading ? `${page} > ${heading}` : page))
    .replace(/\s+/g, " ")
    .trim();
}

export function isImagePath(path: string): boolean {
  return previewKindFor(path) === "image" && extensionOf(path) !== "svg";
}

/** A heading's anchor the way people write it in `[[Page#Section]]`: the text, compared without case or marks. */
export function headingKey(text: string): string {
  return text.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}
