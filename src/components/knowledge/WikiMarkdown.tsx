// Security: page text never reaches the DOM as raw HTML (no rehype-raw), and a picture is only loaded when it is a Drive file.
import { memo, useMemo, type ComponentProps, type ReactNode } from "react";
import Markdown, { defaultUrlTransform, type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { t } from "@/lib/i18n";
import { headingKey, parseWikiFileHref, parseWikiHref, wikiUrlTransform, type WikiLinkTarget } from "@/lib/wiki-render";

export interface WikiMarkdownProps {
  /** Markdown with the Obsidian links already turned into `wiki:` addresses (see wikiMarkdown). */
  markdown: string;
  /** Each link written in the page, mapped to the page it leads to or null. */
  links?: Readonly<Record<string, string | null>>;
  /** Each embedded picture or file, mapped to its Drive path. */
  files?: Readonly<Record<string, string>>;
  /** Where a Drive file is shown from. */
  fileUrl?: (drivePath: string) => string;
  onOpenPage?: (target: WikiLinkTarget, pageId: string | null) => void;
}

const LINK = "break-words text-accent-text underline decoration-accent/40 underline-offset-[3px] hover:decoration-accent";
const MISSING = "break-words text-ink-secondary underline decoration-dashed decoration-ink-tertiary underline-offset-[3px] hover:text-ink";

function plainText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(plainText).join("");
  if (node && typeof node === "object" && "props" in node) return plainText((node as { props: { children?: ReactNode } }).props.children);
  return "";
}

function heading(level: 1 | 2 | 3 | 4, className: string) {
  const Tag = `h${level}` as const;
  return function Heading({ children }: ComponentProps<"h1">) {
    return <Tag data-heading={headingKey(plainText(children))} className={className}>{children}</Tag>;
  };
}

const H1 = heading(1, "mt-6 mb-2 text-[22px] font-semibold leading-8");
const H2 = heading(2, "mt-5 mb-2 text-[18px] font-semibold leading-7");
const H3 = heading(3, "mt-4 mb-1.5 text-[15.5px] font-semibold");
const H4 = heading(4, "mt-3 mb-1 text-[14px] font-semibold");

function componentsFor({ links = {}, files = {}, fileUrl, onOpenPage }: Omit<WikiMarkdownProps, "markdown">): Components {
  const driveSource = (src: string | undefined): string | null => {
    if (!src) return null;
    const direct = parseWikiFileHref(src);
    const path = direct ?? files[src] ?? files[decodeSafe(src)];
    return path && fileUrl ? fileUrl(path) : null;
  };
  return {
    h1: H1,
    h2: H2,
    h3: H3,
    h4: H4,
    h5: H4,
    h6: H4,
    p: ({ children }) => <p className="my-2.5">{children}</p>,
    ul: ({ children }) => <ul className="my-2.5 list-disc space-y-1 ps-6">{children}</ul>,
    ol: ({ children }) => <ol className="my-2.5 list-decimal space-y-1 ps-6">{children}</ol>,
    blockquote: ({ children }) => <blockquote className="my-3 border-s-2 border-accent/40 ps-3.5 text-ink-secondary">{children}</blockquote>,
    hr: () => <hr className="my-5 border-hairline/50" />,
    table: ({ children }) => <div className="my-3 overflow-x-auto"><table className="w-full border-collapse text-[13.5px]">{children}</table></div>,
    th: ({ children }) => <th className="border-b border-hairline/50 px-2.5 py-1.5 text-start font-semibold">{children}</th>,
    td: ({ children }) => <td className="border-b border-hairline/25 px-2.5 py-1.5 align-top">{children}</td>,
    pre: ({ children }) => <pre className="my-3 overflow-x-auto rounded-lg bg-inset p-3 text-[12.5px] leading-5">{children}</pre>,
    code: ({ children, className }) => (className ? <code className={className}>{children}</code> : <code className="ui-code-plain break-words">{children}</code>),
    a({ href = "", children }) {
      const page = parseWikiHref(href);
      if (page) {
        const id = links[page.target] ?? null;
        return (
          <button type="button" onClick={() => onOpenPage?.(page, id)} title={id ? undefined : t("wiki.links.missing")} className={id ? LINK : MISSING}>
            {children}
          </button>
        );
      }
      const file = parseWikiFileHref(href);
      if (file && fileUrl) return <a href={fileUrl(file)} target="_blank" rel="noreferrer noopener" className={LINK}>{children}</a>;
      if (/^(https?:|mailto:)/i.test(href)) return <a href={href} target="_blank" rel="noreferrer noopener" className={LINK}>{children}</a>;
      return <span>{children}</span>;
    },
    img({ src, alt }) {
      const source = driveSource(typeof src === "string" ? src : undefined);
      if (!source) return <span className="text-ink-tertiary">{alt || (typeof src === "string" ? src : "")}</span>;
      return <img src={source} alt={alt ?? ""} loading="lazy" decoding="async" className="my-3 max-h-[28rem] max-w-full rounded-lg" />;
    },
  };
}

function decodeSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

const transformUrl = (url: string) => wikiUrlTransform(url, defaultUrlTransform);

export const WikiMarkdown = memo(function WikiMarkdown({ markdown, links, files, fileUrl, onOpenPage }: WikiMarkdownProps) {
  const components = useMemo(() => componentsFor({ links, files, fileUrl, onOpenPage }), [links, files, fileUrl, onOpenPage]);
  return (
    <div className="wiki-markdown min-w-0 break-words text-[14.5px] leading-7 text-ink">
      <Markdown remarkPlugins={[remarkGfm]} urlTransform={transformUrl} components={components}>
        {markdown}
      </Markdown>
    </div>
  );
});
