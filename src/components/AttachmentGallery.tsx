// Security: local files load only after an explicit action, through the server's exact-message file authorization.
import { useEffect, useMemo, useRef, useState } from "react";
import { fileVersionKey } from "@/lib/file-versions";
import { fromMarkdown } from "mdast-util-from-markdown";
import { ChevronDown, ChevronUp, Download, Music } from "lucide-react";
import { WavePlayer } from "./VoiceNoteBubble";
import { attachmentBasename, FILE_MAX_BYTES, type TranscriptFileAttachment, type TranscriptImageAttachment } from "@/lib/composer-attachments";
import { sharingMessage } from "@/lib/turn-attachments";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { windowsPathDestinations } from "../../shared/markdown-windows-paths";
import { localFilePath, type DeliveredFiles } from "./ChatMarkdown";
import {
  AttachedFileChip,
  AttachmentPreviewDialog,
  AttachmentThumbnail,
  previewImage,
  requestMessageFile,
  safeDownloadFilename,
  type MessageAttachmentContext,
  type PreviewImage,
} from "./AttachmentPreview";
import { HtmlAttachment, isHtmlAttachmentName } from "./HtmlAttachment";
import { VideoAttachment } from "./VideoAttachment";

export interface GalleryFile extends TranscriptFileAttachment {
  linked?: boolean;
  sharedBy?: string;
}

type MarkdownNode = {
  type: string;
  url?: string;
  identifier?: string;
  children?: MarkdownNode[];
};

export function fileIdentity(path: string): string {
  // Presentation deduplication only, never an authorization check.
  if (/^file:\/\//i.test(path)) return localFilePath(path) ?? path;
  try { return decodeURIComponent(path.split(/[?#]/, 1)[0]!); }
  catch { return path; }
}

export function collectMessageFiles(text: string, existingPaths: readonly string[] = []): GalleryFile[] {
  const tree: MarkdownNode = fromMarkdown(text, { mdastExtensions: [windowsPathDestinations] });
  const definitions = new Map<string, string>();
  const links: MarkdownNode[] = [];
  const pending = [tree];
  while (pending.length) {
    const node = pending.pop()!;
    if (node.type === "definition" && node.identifier && node.url && !definitions.has(node.identifier)) {
      definitions.set(node.identifier, node.url);
    } else if (node.type === "link" || node.type === "linkReference") {
      if (!node.children?.some((child) => child.type === "image" || child.type === "imageReference")) links.push(node);
    }
    if (node.children) pending.push(...[...node.children].reverse());
  }
  const seen = new Set(existingPaths.map(fileIdentity));
  return links.flatMap((node) => {
    const href = node.url ?? (node.identifier ? definitions.get(node.identifier) : undefined);
    const path = localFilePath(href);
    if (!path || !href) return [];
    const identity = fileIdentity(href);
    if (seen.has(identity)) return [];
    seen.add(identity);
    // Security: send the authored spelling; the server owns the one decode at its authorization boundary.
    return [{ path: href, name: safeDownloadFilename(attachmentBasename(identity)), linked: true }];
  });
}

export function isVideoAttachment(path: string): boolean {
  return /\.(?:mp4|m4v|webm|mov)$/i.test(fileIdentity(path));
}

export function isAudioAttachment(path: string): boolean {
  return /\.(?:mp3|m4a|aac|wav|ogg|oga|opus|flac)$/i.test(fileIdentity(path));
}

type MessageAttachmentEntry = { path: string; kind?: string; name?: string; sharedBy?: string };
const NO_GENERATED_ATTACHMENTS: readonly MessageAttachmentEntry[] = [];

export function splitMessageAttachments(attachments: readonly MessageAttachmentEntry[] = NO_GENERATED_ATTACHMENTS): { images: string[]; files: GalleryFile[] } {
  const images: string[] = [];
  const files: GalleryFile[] = [];
  for (const attachment of attachments) {
    if (attachment.kind === "file") files.push({ path: attachment.path, name: attachment.name || attachmentBasename(attachment.path), private: true, sharedBy: attachment.sharedBy });
    else if (attachment.kind === "image" || attachment.kind === undefined) images.push(attachment.path);
  }
  return { images, files };
}

export function replyAttachmentGroup(text: string, attachments: readonly MessageAttachmentEntry[] = NO_GENERATED_ATTACHMENTS): {
  images: string[];
  files: GalleryFile[];
  delivered: DeliveredFiles;
} {
  const attached = splitMessageAttachments(attachments);
  const links = collectMessageFiles(text);
  const linkedNames = new Set(links.map((link) => link.name));
  const delivered: Record<string, DeliveredFiles[string]> = {};
  const files: GalleryFile[] = [];
  const deliveredNames = new Map<string, number>();
  for (const file of attached.files) deliveredNames.set(file.name, (deliveredNames.get(file.name) ?? 0) + 1);
  for (const file of attached.files) {
    if (linkedNames.has(file.name) && deliveredNames.get(file.name) === 1) delivered[file.name] = { path: file.path, sharedBy: file.sharedBy };
    else files.push(file);
  }
  const taken = new Set([...attached.images, ...attached.files.map((file) => file.path)].map(fileIdentity));
  for (const link of links) {
    if (Object.hasOwn(delivered, link.name) || taken.has(fileIdentity(link.path))) continue;
    if (isVideoAttachment(link.path) || isAudioAttachment(link.path)) files.push(link);
  }
  return { images: attached.images, files, delivered };
}

export function MessageAttachmentGallery({ text, attachments = NO_GENERATED_ATTACHMENTS, message, eager, className }: {
  text: string;
  attachments?: readonly MessageAttachmentEntry[];
  message: MessageAttachmentContext;
  eager?: boolean;
  className?: string;
}) {
  const attached = useMemo(() => splitMessageAttachments(attachments), [attachments]);
  const files = useMemo(
    () => [...attached.files, ...collectMessageFiles(text, [...attached.images, ...attached.files.map((file) => file.path)])],
    [text, attached],
  );
  return <AttachmentGallery images={attached.images} files={files} message={message} eager={eager} className={className} />;
}

const AUDIO_MIMES = ["audio/mpeg", "audio/mp4", "audio/x-m4a", "audio/aac", "audio/wav", "audio/x-wav", "audio/wave", "audio/ogg", "audio/opus", "audio/flac", "audio/x-flac"];

export async function loadMessageAudio(
  file: GalleryFile,
  message: MessageAttachmentContext,
  signal: AbortSignal,
): Promise<Blob> {
  const response = await requestMessageFile(file.path, message, signal);
  const mime = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (!mime || !AUDIO_MIMES.includes(mime)) {
    await response.body?.cancel();
    throw new Error(t("attach.audioUnavailable"));
  }
  const declared = Number(response.headers.get("content-length"));
  if (declared > FILE_MAX_BYTES) {
    await response.body?.cancel();
    throw new Error(t("attach.fileTooLarge"));
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error(t("attach.audioUnavailable"));
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    for (;;) {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > FILE_MAX_BYTES) throw new Error(t("attach.fileTooLarge"));
      chunks.push(new Uint8Array(value));
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  return new Blob(chunks, { type: mime });
}

function AudioAttachment({ file, message }: { file: GalleryFile; message: MessageAttachmentContext }) {
  const [src, setSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  const saveAfterLoad = useRef(false);
  const saveLink = useRef<HTMLAnchorElement | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => () => { if (src) URL.revokeObjectURL(src); }, [src]);
  useEffect(() => {
    if (!src || !saveAfterLoad.current) return;
    saveAfterLoad.current = false;
    saveLink.current?.click();
  }, [src]);

  const load = async () => {
    if (request.current || src) return;
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError("");
    try {
      const blob = await loadMessageAudio(file, message, controller.signal);
      if (!controller.signal.aborted) setSrc(URL.createObjectURL(blob));
    } catch (reason) {
      saveAfterLoad.current = false;
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("attach.audioUnavailable"));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
      if (request.current === controller) request.current = null;
    }
  };

  const saveLabel = t("attach.saveAria", { name: file.name });
  return (
    <div data-audio-attachment="" className="inline-flex w-[290px] max-w-full flex-col gap-0.5 rounded-2xl bg-card px-1 pb-0.5 pt-2 text-left">
      <div className="flex items-center gap-2 px-2">
        <Music size={14} className="shrink-0 text-accent" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-ink" title={file.name}>{file.name}</span>
        <button type="button" disabled={loading} onClick={() => { if (src) saveLink.current?.click(); else { saveAfterLoad.current = true; void load(); } }}
          aria-label={saveLabel} title={saveLabel}
          className="shrink-0 rounded-lg p-1 text-ink-secondary hover:bg-raised hover:text-ink disabled:cursor-wait"><Download size={14} /></button>
        {src && <a ref={saveLink} href={src} download={file.name} hidden tabIndex={-1} aria-hidden="true" />}
      </div>
      {!error && (
        <WavePlayer
          src={src}
          cacheKey={`${message.threadId}:${message.messageId}:${file.path}`}
          tone="plain"
          showTotal
          showSpeed={false}
          loading={loading}
          onNeedSource={() => void load()}
          onError={() => { setSrc(null); setError(t("attach.audioUnavailable")); }}
          labels={{
            play: t("attach.previewAudio", { name: file.name }),
            pause: t("attach.pauseAudio", { name: file.name }),
            seek: t("attach.seekAudio", { name: file.name }),
            onLiveCall: t("attach.audioOnLiveCall"),
          }}
        />
      )}
      {error && <p role="alert" className="px-2 pb-1.5 text-[11px] text-danger">{error}</p>}
    </div>
  );
}

type GalleryItem = { key: string } & (
  | { kind: "image"; image: PreviewImage }
  | { kind: "video" | "audio" | "html" | "file"; file: GalleryFile }
);

const BENEATH_LIMIT = 6;

function ProducedLine({ file, produced }: { file: { path: string; name?: string }; produced?: { by: string; versions?: ReadonlyMap<string, number> } }) {
  if (!produced) return null;
  const version = produced.versions?.get(fileVersionKey(file)) ?? 1;
  return (
    <span data-produced-file="" className="px-2 pt-0.5 text-[11px] text-ink-tertiary">
      {t("attach.producedBy", { version, name: produced.by })}
    </span>
  );
}

export function AttachmentGallery({ images = [], files = [], message, eager = false, beneath = false, className, produced }: {
  produced?: { by: string; versions?: ReadonlyMap<string, number> };
  images?: Array<string | TranscriptImageAttachment>;
  files?: GalleryFile[];
  message?: MessageAttachmentContext;
  eager?: boolean;
  beneath?: boolean;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState<PreviewImage | null>(null);
  const items = useMemo(() => {
    const seen = new Set<string>();
    const result: GalleryItem[] = [];
    for (const reference of images) {
      const path = typeof reference === "string" ? reference : reference.path;
      const key = fileIdentity(path);
      if (seen.has(key)) continue;
      seen.add(key);
      const image = typeof reference === "string" || reference.private
        ? previewImage(path, typeof reference === "string" ? undefined : reference.name)
        : null;
      if (image) result.push({ key, kind: "image", image });
      else result.push({ key, kind: "file", file: typeof reference === "string" ? { path, name: attachmentBasename(path) } : reference });
    }
    for (const file of files) {
      const key = fileIdentity(file.path);
      if (seen.has(key)) continue;
      seen.add(key);
      const trusted = Boolean(message && (file.private || file.linked));
      // Only a stored (private) attachment of a bot message is framed; the server re-proves the grant per request.
      const html = Boolean(message && file.private && isHtmlAttachmentName(file.path));
      result.push({ key, kind: html ? "html" : trusted && isVideoAttachment(file.path) ? "video" : trusted && isAudioAttachment(file.path) ? "audio" : "file", file });
    }
    return result;
  }, [images, files, message]);
  if (!items.length) return null;
  const limit = beneath ? BENEATH_LIMIT : 4;
  const shown = expanded ? items : items.slice(0, limit);
  const media = shown.filter((item) => item.kind === "image");
  const videos = message ? shown.filter((item) => item.kind === "video") : [];
  const pages = message ? shown.filter((item) => item.kind === "html") : [];
  const documents = shown.filter((item) => item.kind === "file" || item.kind === "audio" || (item.kind === "html" && !message));
  const pageRow = pages.length > 0 && message && (
    <div className="flex w-full max-w-full flex-col gap-2">
      {pages.map((item) => item.kind === "html" && (
        <HtmlAttachment key={`${message.threadId}:${message.messageId}:${item.key}`} file={item.file} message={sharingMessage(message, item.file)} />
      ))}
    </div>
  );
  const previews = items.flatMap((item) => item.kind === "image" ? [item.image] : []);
  const label = items.length === 1 ? t("attach.gallerySingle") : t("attach.galleryCount", { count: items.length });
  const videoRow = videos.length > 0 && message && (
    <div className="flex max-w-full flex-wrap items-start gap-2">
      {videos.map((item) => item.kind === "video" && (
        <VideoAttachment key={`${message.threadId}:${message.messageId}:${item.key}`} file={item.file} message={sharingMessage(message, item.file)} />
      ))}
    </div>
  );
  const dialog = selected && previews.some((image) => image.src === selected.src) && (
    <AttachmentPreviewDialog image={selected} images={previews} initialIndex={previews.findIndex((image) => image.src === selected.src)} onClose={() => setSelected(null)} />
  );

  if (beneath) {
    return (
      <section aria-label={label} className={cn("mt-2.5 flex max-w-full flex-col items-start gap-2 text-start whitespace-normal", pages.length > 0 && "w-full", className)}>
        {media.length > 0 && (
          <div className="flex max-w-full flex-wrap gap-2">
            {media.map((item) => item.kind === "image" && (
              <div key={item.key} className="min-w-0" title={item.image.name}>
                <AttachmentThumbnail key={item.image.src} image={item.image} eager={eager} onPreview={() => setSelected(item.image)} className="h-24 w-auto max-w-48 rounded-2xl border-0" />
              </div>
            ))}
          </div>
        )}
        {videoRow}
        {pageRow}
        {(documents.length > 0 || items.length > limit) && (
          <div className="flex max-w-full flex-wrap items-start gap-1.5">
            {documents.map((item) => item.kind === "audio" && message
              ? <AudioAttachment key={`${message.threadId}:${message.messageId}:${item.key}`} file={item.file} message={sharingMessage(message, item.file)} />
              : (item.kind === "file" || item.kind === "html") && (
                <span key={item.key} className="inline-flex flex-col">
                  <AttachedFileChip file={item.file} linked={item.file.linked} message={sharingMessage(message, item.file)} compact />
                  <ProducedLine file={item.file} produced={produced} />
                </span>
              ))}
            {items.length > limit && (
              <button type="button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded} className="inline-flex h-7 items-center rounded-full px-2.5 text-[13px] leading-none text-ink-secondary transition-colors hover:bg-ink/[0.06] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
                {expanded ? t("attach.showLess") : t("attach.moreCount", { count: items.length - limit })}
              </button>
            )}
          </div>
        )}
        {dialog}
      </section>
    );
  }

  return (
    <section aria-label={label} className={cn("mb-1.5 max-w-full space-y-1.5 text-left whitespace-normal", pages.length > 0 ? "w-full" : media.length > 0 ? "w-[min(34rem,70vw)]" : "w-fit max-w-[min(34rem,70vw)]", className)}>
      {media.length > 0 && (
        <div className={cn("grid gap-2", media.length === 1 ? "grid-cols-1" : "grid-cols-2")}>
          {media.map((item) => item.kind === "image" && (
            <div key={item.key} className="min-w-0" title={item.image.name}>
              <AttachmentThumbnail key={item.image.src} image={item.image} eager={eager} onPreview={() => setSelected(item.image)} className="max-h-72 rounded-2xl border-0 bg-transparent" />
            </div>
          ))}
        </div>
      )}
      {videoRow}
      {pageRow}
      {documents.length > 0 && (
        <div className="flex flex-col items-start gap-1.5">
          {documents.map((item) => item.kind === "audio" && message
            ? <AudioAttachment key={`${message.threadId}:${message.messageId}:${item.key}`} file={item.file} message={sharingMessage(message, item.file)} />
            : (item.kind === "file" || item.kind === "html") && (
              <span key={item.key} className="flex flex-col">
                <AttachedFileChip file={item.file} linked={item.file.linked} message={sharingMessage(message, item.file)} className="max-w-none rounded-xl border-white/10 bg-white/[0.03]" />
                <ProducedLine file={item.file} produced={produced} />
              </span>
            ))}
        </div>
      )}
      {items.length > limit && (
        <button type="button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded} className="flex min-h-8 items-center gap-1 rounded-lg px-1 py-1 text-[11px] text-ink-secondary transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
          {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          {expanded ? t("attach.showLess") : t("attach.showMore", { count: items.length - limit })}
        </button>
      )}
      {dialog}
    </section>
  );
}
