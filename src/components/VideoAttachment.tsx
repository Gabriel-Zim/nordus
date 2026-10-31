// Security: a stored video attachment loads its cover on sight, as a stored image does; a video a bot only linked loads
// after an explicit click. Both come through the server's exact-message file authorization.
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Download, LoaderCircle, Play, RotateCcw, X } from "lucide-react";
import { attachmentBasename, VIDEO_MAX_BYTES } from "@/lib/composer-attachments";
import { t } from "@/lib/i18n";
import { AttachedFileChip, requestMessageFile, type MessageAttachmentContext } from "./AttachmentPreview";
import type { GalleryFile } from "./AttachmentGallery";
import { clock } from "./VoiceNoteBubble";

const VIDEO_MIMES = ["video/mp4", "video/webm", "video/quicktime", "video/x-m4v"];
const COVER_MAX_BYTES = 10 * 1024 * 1024;
const COVER_MAX_WIDTH = 240;
const COVER_MAX_HEIGHT = 320;
const PORTRAIT = 9 / 16;

/** The bare generated name of a stored audio or video file, the only file reference a stream URL carries. */
const STREAM_MEDIA_NAME = /^[A-Za-z0-9-]+\.(?:mp4|m4v|webm|mov|mp3|m4a|aac|wav|ogg|oga|opus|flac)$/i;

/**
 * Security: a stored (private) media file streams over GET with Range; only its bare generated name is in the URL and
 * the server re-proves that this exact message attached it. Files a bot merely linked return null (Blob flow).
 */
export function messageMediaStreamUrl(
  message: MessageAttachmentContext,
  file: { path: string; private?: boolean },
): string | null {
  if (!file.private) return null;
  const name = attachmentBasename(file.path);
  if (!STREAM_MEDIA_NAME.test(name)) return null;
  return `/api/threads/${encodeURIComponent(message.threadId)}/messages/${encodeURIComponent(message.messageId)}/file?stream=1&name=${encodeURIComponent(name)}`;
}

/** Security: the server's MIME is required as well as the filename, so arbitrary bytes never become UI. */
export async function loadMessageVideo(
  file: GalleryFile,
  message: MessageAttachmentContext,
  signal: AbortSignal,
  maxBytes = VIDEO_MAX_BYTES,
): Promise<Blob> {
  const response = await requestMessageFile(file.path, message, signal);
  const mime = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (!mime || !VIDEO_MIMES.includes(mime)) {
    await response.body?.cancel();
    throw new Error(t("attach.videoUnavailable"));
  }
  const declared = Number(response.headers.get("content-length"));
  if (declared > maxBytes) {
    await response.body?.cancel();
    throw new Error(t("attach.videoTooLarge"));
  }
  // Keep this bounded even if a reverse proxy omits Content-Length.
  const reader = response.body?.getReader();
  if (!reader) throw new Error(t("attach.videoUnavailable"));
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    for (;;) {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error(t("attach.videoTooLarge"));
      chunks.push(new Uint8Array(value));
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  return new Blob(chunks, { type: mime });
}

type Clip =
  | { phase: "idle" }
  | { phase: "loading"; full: boolean }
  | { phase: "ready"; url: string }
  | { phase: "failed"; full: boolean; reason: string };

function useMessageVideo(file: GalleryFile, message: MessageAttachmentContext) {
  const [clip, setClip] = useState<Clip>({ phase: "idle" });
  const request = useRef<AbortController | null>(null);
  const { threadId, messageId } = message;
  useEffect(() => () => {
    request.current?.abort();
    request.current = null;
  }, []);
  useEffect(() => () => { if (clip.phase === "ready") URL.revokeObjectURL(clip.url); }, [clip]);
  const load = useCallback(async (full: boolean) => {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setClip({ phase: "loading", full });
    try {
      const blob = await loadMessageVideo(file, { threadId, messageId }, controller.signal, full ? VIDEO_MAX_BYTES : COVER_MAX_BYTES);
      if (request.current === controller) setClip({ phase: "ready", url: URL.createObjectURL(blob) });
    } catch (reason) {
      if (request.current === controller) setClip({ phase: "failed", full, reason: reason instanceof Error ? reason.message : t("attach.videoUnavailable") });
    } finally {
      if (request.current === controller) request.current = null;
    }
  }, [file, threadId, messageId]);
  const unplayable = useCallback(() => setClip({ phase: "failed", full: true, reason: t("attach.videoUnavailable") }), []);
  return { clip, load, unplayable };
}

function useOnSight(target: RefObject<HTMLElement | null>, enabled: boolean, onSight: () => void) {
  const fire = useRef(onSight);
  fire.current = onSight;
  useEffect(() => {
    const element = target.current;
    if (!enabled || !element) return;
    if (typeof IntersectionObserver === "undefined") return void fire.current();
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      fire.current();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [target, enabled]);
}

function coverSize(ratio: number): { width: number; height: number } {
  const width = Math.round(Math.min(COVER_MAX_WIDTH, COVER_MAX_HEIGHT * ratio));
  return { width, height: Math.round(width / ratio) };
}

export function VideoAttachment({ file, message }: { file: GalleryFile; message: MessageAttachmentContext }) {
  // A stored video streams straight from a GET URL (Range), so neither the cover nor the player waits for a Blob.
  const streamUrl = messageMediaStreamUrl(message, file);
  const { clip, load, unplayable } = useMessageVideo(file, message);
  const [coverBroken, setCoverBroken] = useState(false);
  const [ratio, setRatio] = useState(PORTRAIT);
  const [duration, setDuration] = useState<number | null>(null);
  const [watching, setWatching] = useState(false);
  const card = useRef<HTMLButtonElement>(null);
  useOnSight(card, Boolean(file.private) && !streamUrl && clip.phase === "idle", () => void load(false));
  const size = coverSize(ratio);
  const url = streamUrl ?? (clip.phase === "ready" ? clip.url : null);

  useEffect(() => {
    if (!streamUrl && watching && (clip.phase === "idle" || clip.phase === "failed" && !clip.full)) void load(true);
  }, [streamUrl, watching, clip, load]);

  return (
    <div data-video-card="" className="flex min-w-0 max-w-full flex-col gap-1" style={{ width: size.width }}>
      <button
        ref={card}
        type="button"
        onClick={() => setWatching(true)}
        aria-label={t("attach.previewVideo", { name: file.name })}
        title={file.name}
        style={{ aspectRatio: `${size.width} / ${size.height}` }}
        className="group/video relative block w-full overflow-hidden rounded-2xl border border-white/10 bg-[radial-gradient(120%_90%_at_30%_20%,rgb(255_255_255/0.10),rgb(255_255_255/0.02)_60%)] bg-raised shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      >
        {url && !coverBroken && (
          <video
            src={`${url}#t=0.1`}
            muted
            playsInline
            preload="metadata"
            disablePictureInPicture
            tabIndex={-1}
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 size-full object-cover transition-transform duration-200 group-hover/video:scale-[1.02]"
            onLoadedMetadata={(event) => {
              const video = event.currentTarget;
              if (video.videoWidth && video.videoHeight) setRatio(Math.min(Math.max(video.videoWidth / video.videoHeight, 0.5), 2.4));
              if (Number.isFinite(video.duration)) setDuration(video.duration);
              if (video.currentTime < 0.05) video.currentTime = Math.min(0.1, video.duration / 2 || 0);
            }}
            onError={() => setCoverBroken(true)}
          />
        )}
        <span className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover/video:bg-black/15">
          <span className="flex size-11 items-center justify-center rounded-full border border-white/25 bg-black/35 text-white shadow-lg">
            {!streamUrl && clip.phase === "loading" && !clip.full ? <LoaderCircle size={20} className="animate-spin" /> : <Play size={19} className="translate-x-px fill-current" />}
          </span>
        </span>
        {duration !== null && (
          <span className="absolute bottom-1.5 right-1.5 rounded-md bg-black/55 px-1.5 py-0.5 text-[11px] font-medium tabular-nums leading-none text-white">
            {clock(duration)}
          </span>
        )}
      </button>
      <AttachedFileChip file={file} linked={file.linked} message={message} compact className="max-w-full" />
      {watching && (
        <VideoPreviewDialog
          name={file.name}
          clip={clip}
          streamUrl={streamUrl}
          onRetry={() => void load(true)}
          onUnplayable={unplayable}
          onClose={() => {
            setWatching(false);
            requestAnimationFrame(() => card.current?.focus());
          }}
        />
      )}
    </div>
  );
}

function VideoPreviewDialog({ name, clip, streamUrl, onRetry, onUnplayable, onClose }: {
  name: string;
  clip: Clip;
  streamUrl: string | null;
  onRetry: () => void;
  onUnplayable: () => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const [duration, setDuration] = useState<number | null>(null);
  // A streamed video fails inside the element; retrying re-mounts it to request the bytes again.
  const [streamFailed, setStreamFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    dialog.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close.current();
        return;
      }
      if (event.key !== "Tab" || !dialog.current) return;
      const focusable = [...dialog.current.querySelectorAll<HTMLElement>("button:not([disabled]), [href], video, [tabindex]:not([tabindex='-1'])")];
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && (document.activeElement === dialog.current || document.activeElement === first)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const url = streamUrl ?? (clip.phase === "ready" ? clip.url : null);
  const failed = streamUrl
    ? (streamFailed ? t("attach.videoUnavailable") : null)
    : clip.phase === "failed" && clip.full ? clip.reason : null;
  const retry = streamUrl ? () => { setStreamFailed(false); setAttempt((n) => n + 1); } : onRetry;
  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-3 sm:p-6"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label={t("attach.previewVideo", { name })}
        tabIndex={-1}
        className="animate-pop-in flex max-h-full w-full max-w-[min(1200px,100%)] flex-col overflow-hidden rounded-2xl border border-white/15 bg-black/70 shadow-2xl outline-none sm:w-auto sm:min-w-[22rem]"
      >
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-white/10 bg-black/45 px-4 py-3">
          <div className="min-w-0">
            <div className="truncate text-[13px] font-medium text-white">{name}</div>
            <div className="text-[10.5px] text-white/50">{duration !== null ? `${t("attach.video")} · ${clock(duration)}` : t("attach.video")}</div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {url && !failed && (
              <a href={url} download={name} aria-label={t("attach.downloadAria", { name })} title={t("attach.download")}
                className="flex size-9 items-center justify-center rounded-lg text-white/65 hover:bg-white/10 hover:text-white">
                <Download size={17} />
              </a>
            )}
            <button type="button" onClick={onClose} aria-label={t("attach.closeVideo")}
              className="flex size-9 items-center justify-center rounded-lg text-white/65 hover:bg-white/10 hover:text-white">
              <X size={19} />
            </button>
          </div>
        </header>
        <div className="flex min-h-0 flex-1 items-center justify-center bg-black p-2 sm:p-4">
          {url && !failed ? (
            <video
              key={attempt}
              src={url}
              controls
              autoPlay
              playsInline
              preload="metadata"
              aria-label={name}
              className="block max-h-[calc(100dvh-8rem)] max-w-full rounded-lg object-contain"
              onLoadedMetadata={(event) => { if (Number.isFinite(event.currentTarget.duration)) setDuration(event.currentTarget.duration); }}
              onDoubleClick={(event) => void event.currentTarget.requestFullscreen?.().catch(() => undefined)}
              onError={streamUrl ? () => setStreamFailed(true) : onUnplayable}
            />
          ) : failed ? (
            <div role="alert" className="flex max-w-xs flex-col items-center gap-3 px-4 py-16 text-center text-white/70">
              <span className="text-[13px]">{failed}</span>
              <button type="button" onClick={retry}
                className="flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/10 px-3 py-1.5 text-[12px] text-white hover:bg-white/15">
                <RotateCcw size={13} /> {t("chat.retry")}
              </button>
            </div>
          ) : (
            <div role="status" className="flex items-center gap-2 px-6 py-24 text-[13px] text-white/60">
              <LoaderCircle size={17} className="animate-spin" /> {t("attach.videoLoading")}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
