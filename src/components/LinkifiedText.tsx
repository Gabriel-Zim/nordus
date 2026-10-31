import { Fragment, type ReactNode } from "react";
import { linkDestination } from "@/lib/link-destination";

const URL_PATTERN = /https?:\/\/[^\s<>"')\]]*[^\s<>"')\].,;:!?]/g;
const IMAGE_URL = /\.(png|jpe?g|gif|webp)$/i;
const VIDEO_URL = /\.(mp4|mov|webm|m4v)$/i;

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

/** A pasted address never shows raw: an image or video becomes a preview, anything else a phrase with its site's icon. */
function PastedLink({ url }: { url: string }) {
  const path = pathOf(url);
  if (VIDEO_URL.test(path)) {
    return (
      <span data-pasted-video="" className="my-1.5 block overflow-hidden rounded-[14px] border border-white/10 bg-black">
        <video src={url} controls playsInline preload="metadata" className="block max-h-[60vh] w-full object-contain" />
      </span>
    );
  }
  if (IMAGE_URL.test(path)) {
    return (
      <a href={url} target="_blank" rel="noreferrer" data-pasted-image="" className="my-1.5 block overflow-hidden rounded-[14px] border border-white/10">
        <img src={url} alt="" loading="lazy" className="block max-h-[50vh] w-full object-contain" />
      </a>
    );
  }
  return <SiteLink url={url} />;
}

function SiteLink({ url }: { url: string }) {
  const destination = linkDestination(url);
  const Icon = destination.icon;
  return (
    <a href={url} target="_blank" rel="noreferrer" title={url} data-web-link="" className="break-words underline decoration-current/30 decoration-1 underline-offset-[3px] hover:decoration-current">
      {destination.src ? <img loading="lazy" decoding="async" src={destination.src} alt="" aria-hidden="true" className="me-1 inline-block size-[13px] -translate-y-px rounded-[3px] bg-white p-[1px] align-middle" /> : <Icon size={13} aria-hidden="true" className="me-1 inline-block -translate-y-px align-middle opacity-80" />}
      {destination.label}
    </a>
  );
}

export function hasWebAddress(text: string): boolean {
  return text.search(URL_PATTERN) >= 0;
}

export function LinkifiedText({ text, render, previews = true }: { text: string; render: (run: string, key: number) => ReactNode; previews?: boolean }) {
  const Link = previews ? PastedLink : SiteLink;
  const parts: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0;
    if (start > last) parts.push(render(text.slice(last, start), key++));
    parts.push(<Link key={`u${key++}`} url={match[0]} />);
    last = start + match[0].length;
  }
  if (!parts.length) return <>{render(text, 0)}</>;
  if (last < text.length) parts.push(render(text.slice(last), key++));
  return <>{parts.map((part, index) => <Fragment key={index}>{part}</Fragment>)}</>;
}
