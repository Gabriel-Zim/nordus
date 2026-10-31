// Security: a bot's HTML page runs only inside this sandboxed frame. The sandbox never carries allow-same-origin, so the
// page gets an opaque origin: no cookies, no storage, no calls to the app's API. The server serves it under the same
// exact-message grant as stored media, with a CSP that also applies when the URL is opened in its own tab.
// The page can talk to the app only through src/lib/html-bridge.ts, and only a message whose event.source is this card's
// own frame is heard. Nothing the page says is ever sent as a message by itself.
import { useCallback, useContext, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { ExternalLink, GripHorizontal, Maximize2, Square, X } from "lucide-react";
import { attachmentBasename } from "@/lib/composer-attachments";
import { appendComposerDraft } from "@/lib/drafts";
import { autoHeight, draftStorageKey, loadHtmlDraft, parseBridgeMessage, saveHtmlDraft } from "@/lib/html-bridge";
import { RecordError, startRecording, type Recording } from "@/lib/html-recorder";
import { t } from "@/lib/i18n";
import { StoreContext } from "@/state/store";
import { AttachedFileChip, type MessageAttachmentContext } from "./AttachmentPreview";
import type { GalleryFile } from "./AttachmentGallery";
import { NoticeToast } from "./NoticeCard";

/** The bare generated name of a stored HTML page, the only file reference a frame URL carries. */
const HTML_ATTACHMENT_NAME = /^[A-Za-z0-9-]+\.html$/i;
export const HTML_FRAME_SANDBOX = "allow-scripts allow-popups allow-popups-to-escape-sandbox";
const MIN_HEIGHT = 320;
const STEP = 40;
const REPEAT_WINDOW_MS = 1000;

export function isHtmlAttachmentName(path: string): boolean {
  return HTML_ATTACHMENT_NAME.test(attachmentBasename(path));
}

export function messageHtmlUrl(message: MessageAttachmentContext, file: { path: string; private?: boolean }): string | null {
  if (!file.private) return null;
  const name = attachmentBasename(file.path);
  if (!HTML_ATTACHMENT_NAME.test(name)) return null;
  return `/api/threads/${encodeURIComponent(message.threadId)}/messages/${encodeURIComponent(message.messageId)}/file?html=1&name=${encodeURIComponent(name)}`;
}

function transcribeUrl(message: MessageAttachmentContext, name: string): string {
  return `/api/threads/${encodeURIComponent(message.threadId)}/messages/${encodeURIComponent(message.messageId)}/transcribe?name=${encodeURIComponent(name)}`;
}

interface ActiveRecording { id: string; source: Window; rec: Recording | null; cancelled: boolean }

const clockText = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

function RecordingBar({ seconds, onStop, onCancel, dark }: { seconds: number; onStop: () => void; onCancel: () => void; dark?: boolean }) {
  return (
    <div data-html-recording="" role="status" className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-[13px] ${dark ? "border-white/15 bg-black/70 text-white" : "border-white/10 bg-white/[0.06] text-ink"}`}>
      <span aria-hidden="true" className="size-2.5 shrink-0 animate-pulse rounded-full bg-red-500" />
      <span className="min-w-0 flex-1 truncate">{t("attach.htmlRecording")} <span className="tabular-nums">{clockText(seconds)}</span></span>
      <button type="button" onClick={onCancel} className="inline-flex h-8 items-center rounded-lg px-2.5 text-[12px] opacity-80 hover:bg-white/10 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">{t("attach.htmlRecordCancel")}</button>
      <button type="button" onClick={onStop} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-red-600 px-2.5 text-[12px] font-medium text-white hover:bg-red-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
        <Square size={11} className="fill-current" aria-hidden="true" /> {t("attach.htmlRecordStop")}
      </button>
    </div>
  );
}

function initialHeight(): number {
  const viewport = typeof window === "undefined" ? 0 : window.innerHeight;
  return Math.max(MIN_HEIGHT, Math.round(viewport * 0.7));
}

function PageFrame({ url, name, className, style, frameRef, onLoad }: {
  url: string;
  name: string;
  className?: string;
  style?: CSSProperties;
  frameRef?: RefObject<HTMLIFrameElement | null>;
  onLoad?: () => void;
}) {
  return (
    <iframe
      ref={frameRef}
      src={url}
      title={name}
      sandbox={HTML_FRAME_SANDBOX}
      allow="microphone"
      referrerPolicy="no-referrer"
      loading="lazy"
      onLoad={onLoad}
      className={className}
      style={style}
    />
  );
}

export function HtmlAttachment({ file, message }: { file: GalleryFile; message: MessageAttachmentContext }) {
  const url = messageHtmlUrl(message, file);
  const name = attachmentBasename(file.path);
  const store = useContext(StoreContext);
  const [height, setHeight] = useState(initialHeight);
  const [auto, setAuto] = useState<number | null>(null);
  const [full, setFull] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const drag = useRef<{ startY: number; startHeight: number } | null>(null);
  const manual = useRef(false);
  const opener = useRef<HTMLButtonElement>(null);
  const inline = useRef<HTMLIFrameElement>(null);
  const overlay = useRef<HTMLIFrameElement>(null);
  const last = useRef<{ text: string; at: number } | null>(null);
  const transcribing = useRef(false);
  const recording = useRef<ActiveRecording | null>(null);
  const [recAt, setRecAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const fullRef = useRef(full);
  fullRef.current = full;
  const draftId = (() => {
    const bot = store?.state.bots.find((candidate) => candidate.threadId === message.threadId);
    if (bot) return `bot:${bot.id}:${bot.threadId}`;
    const group = store?.state.groups.find((candidate) => candidate.threadId === message.threadId);
    return group ? `group:${group.id}:${group.threadId}` : null;
  })();
  const draftIdRef = useRef(draftId);
  draftIdRef.current = draftId;
  const storageKey = draftStorageKey(message.threadId, message.messageId, name);

  const closeFull = useCallback(() => {
    setFull(false);
    requestAnimationFrame(() => opener.current?.focus());
  }, []);

  const sendToFrame = useCallback((target: Window, payload: Record<string, unknown>) => {
    try { target.postMessage({ versao: 1, ...payload }, "*"); } catch { /* the frame went away */ }
  }, []);

  const restoreDraft = useCallback((frame: RefObject<HTMLIFrameElement | null>) => {
    const dados = loadHtmlDraft(storageKey);
    const target = frame.current?.contentWindow;
    if (dados !== undefined && target) sendToFrame(target, { tipo: "nordus:rascunho", dados });
  }, [storageKey, sendToFrame]);

  const transcribe = useCallback(async (source: Window, id: string, mime: string, body: BodyInit) => {
    transcribing.current = true;
    try {
      const response = await fetch(transcribeUrl(message, name), { method: "POST", headers: { "content-type": mime }, body });
      const result = (await response.json().catch(() => ({}))) as { text?: unknown };
      if (!response.ok || typeof result.text !== "string") throw new Error("failed");
      sendToFrame(source, { tipo: "nordus:transcricao", id, texto: result.text });
    } catch {
      sendToFrame(source, { tipo: "nordus:transcricao", id, erro: t("attach.htmlTranscribeFailed") });
    } finally {
      transcribing.current = false;
    }
  }, [message, name, sendToFrame]);

  const fail = useCallback((source: Window, id: string, text: string) => {
    sendToFrame(source, { tipo: "nordus:transcricao", id, erro: text });
  }, [sendToFrame]);

  // Stops (send) or cancels the recording the app is making for this card; the microphone is always released.
  const endRecording = useCallback(async (send: boolean) => {
    const current = recording.current;
    if (!current) return;
    if (!current.rec) { current.cancelled = true; return; }
    recording.current = null;
    setRecAt(null);
    const { id, source, rec } = current;
    if (!send) {
      rec.cancel();
      sendToFrame(source, { tipo: "nordus:gravacao", id, estado: "cancelada" });
      return;
    }
    sendToFrame(source, { tipo: "nordus:gravacao", id, estado: "transcrevendo" });
    const { blob, tooLarge } = await rec.stop();
    if (tooLarge) return fail(source, id, t("attach.htmlRecordTooLarge"));
    if (blob.size === 0) return fail(source, id, t("attach.htmlRecordFailed"));
    await transcribe(source, id, rec.mime, blob);
  }, [fail, sendToFrame, transcribe]);
  const endRef = useRef(endRecording);
  endRef.current = endRecording;

  const beginRecording = useCallback(async (source: Window, id: string) => {
    if (recording.current || transcribing.current) return fail(source, id, t("attach.htmlRecordBusy"));
    const current: ActiveRecording = { id, source, rec: null, cancelled: false };
    recording.current = current;
    let rec: Recording;
    try {
      rec = await startRecording(() => void endRef.current(true));
    } catch (error) {
      if (recording.current === current) recording.current = null;
      const reason = error instanceof RecordError ? error.reason : "failed";
      return fail(source, id, reason === "blocked" ? t("attach.htmlRecordBlocked") : reason === "missing" ? t("attach.htmlRecordMissing") : t("attach.htmlRecordFailed"));
    }
    if (current.cancelled || recording.current !== current) {
      rec.cancel();
      if (recording.current === current) recording.current = null;
      sendToFrame(source, { tipo: "nordus:gravacao", id, estado: "cancelada" });
      return;
    }
    current.rec = rec;
    setRecAt(Date.now());
    sendToFrame(source, { tipo: "nordus:gravacao", id, estado: "gravando" });
  }, [fail, sendToFrame]);

  useEffect(() => () => { recording.current?.rec?.cancel(); recording.current = null; }, []);
  useEffect(() => {
    if (recAt === null) { setElapsed(0); return; }
    const tick = () => setElapsed(Math.floor((Date.now() - recAt) / 1000));
    tick();
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [recAt]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const fromInline = Boolean(event.source) && event.source === inline.current?.contentWindow;
      const fromOverlay = Boolean(event.source) && event.source === overlay.current?.contentWindow;
      if (!fromInline && !fromOverlay) return;
      const parsed = parseBridgeMessage(event.data);
      if (!parsed) return;
      const source = event.source as Window;
      switch (parsed.kind) {
        case "reply-too-long":
          setNotice(t("attach.htmlReplyTooLong"));
          return;
        case "reply": {
          const now = Date.now();
          const previous = last.current;
          last.current = { text: parsed.text, at: now };
          if (previous && previous.text === parsed.text && now - previous.at < REPEAT_WINDOW_MS) return;
          const id = draftIdRef.current;
          if (!id) return;
          // Never sent by itself: it only lands in the box, after whatever the person already wrote.
          appendComposerDraft(id, parsed.text);
          if (fullRef.current) closeFull();
          requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('[data-tour="composer"] textarea')?.focus());
          setNotice(t("attach.htmlReplyInBox"));
          return;
        }
        case "draft":
          saveHtmlDraft(storageKey, parsed.json);
          return;
        case "height":
          if (fromInline && !manual.current) setAuto(autoHeight(parsed.height, window.innerHeight));
          return;
        case "record": {
          // Only the frame that asked may stop or cancel its own recording.
          if (parsed.action === "iniciar") void beginRecording(source, parsed.id);
          else if (recording.current?.id === parsed.id && recording.current.source === source) void endRecording(parsed.action === "parar");
          return;
        }
        case "transcribe": {
          if (transcribing.current || recording.current) {
            fail(source, parsed.id, t("attach.htmlTranscribeBusy"));
            return;
          }
          void transcribe(source, parsed.id, parsed.mime, parsed.audio);
          return;
        }
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [beginRecording, closeFull, endRecording, fail, sendToFrame, storageKey, transcribe]);

  const clamp = (value: number) => Math.max(MIN_HEIGHT, Math.min(value, 4000));
  const shown = manual.current || auto === null ? height : auto;
  const onDown = (event: PointerEvent<HTMLDivElement>) => {
    // From the first drag on, the person's height wins over the page's.
    manual.current = true;
    drag.current = { startY: event.clientY, startHeight: shown };
    setHeight(shown);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const onMove = (event: PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (state) setHeight(clamp(state.startHeight + event.clientY - state.startY));
  };
  const onUp = () => { drag.current = null; };
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    if (!manual.current) { manual.current = true; setHeight(shown); }
    const base = manual.current ? shown : height;
    setHeight(clamp(base + (event.key === "ArrowDown" ? STEP : -STEP)));
  };

  if (!url) return <AttachedFileChip file={file} linked={file.linked} message={message} compact className="max-w-full" />;
  const button = "inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 text-[12px] text-ink-secondary transition-colors hover:bg-white/10 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60";
  return (
    <div data-html-card="" className="flex w-full min-w-0 max-w-full flex-col gap-1.5">
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <span className="min-w-0 flex-1 basis-40 truncate text-[12px] font-medium text-ink-secondary" title={file.name}>{file.name}</span>
        <button ref={opener} type="button" onClick={() => setFull(true)} className={button}>
          <Maximize2 size={14} aria-hidden="true" /> {t("attach.htmlFullscreen")}
        </button>
        <a href={url} target="_blank" rel="noopener noreferrer" className={button}>
          <ExternalLink size={14} aria-hidden="true" /> {t("attach.htmlNewTab")}
        </a>
      </div>
      <div className="overflow-hidden rounded-2xl border border-white/10 bg-white">
        <PageFrame url={url} name={file.name} frameRef={inline} onLoad={() => restoreDraft(inline)} className="block w-full border-0 bg-white" style={{ height: shown }} />
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label={t("attach.htmlResize")}
          aria-valuenow={shown}
          aria-valuemin={MIN_HEIGHT}
          tabIndex={0}
          data-html-resize=""
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onKeyDown={onKey}
          style={{ touchAction: "none" }}
          className="flex h-5 cursor-row-resize items-center justify-center border-t border-black/10 bg-black/[0.04] text-black/40 hover:bg-black/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          <GripHorizontal size={16} aria-hidden="true" />
        </div>
      </div>
      {recAt !== null && !full && <RecordingBar seconds={elapsed} onStop={() => void endRecording(true)} onCancel={() => void endRecording(false)} />}
      <AttachedFileChip file={file} linked={file.linked} message={message} compact className="max-w-full" />
      {full && <HtmlFullscreen url={url} name={file.name} frameRef={overlay} onLoad={() => restoreDraft(overlay)} onClose={closeFull} bar={recAt !== null ? <RecordingBar dark seconds={elapsed} onStop={() => void endRecording(true)} onCancel={() => void endRecording(false)} /> : null} />}
      {notice && <NoticeToast text={notice} onDone={() => setNotice(null)} />}
    </div>
  );
}

function HtmlFullscreen({ url, name, frameRef, onLoad, onClose, bar }: {
  bar?: ReactNode;
  url: string;
  name: string;
  frameRef: RefObject<HTMLIFrameElement | null>;
  onLoad: () => void;
  onClose: () => void;
}) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      close.current();
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, []);
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={name}
      data-html-fullscreen=""
      className="fixed inset-0 z-[70] flex flex-col bg-black"
      style={{ height: "100dvh" }}
    >
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 bg-black/80 px-3 py-2">
        <div className="min-w-0 truncate text-[13px] font-medium text-white">{name}</div>
        <button type="button" autoFocus onClick={onClose} aria-label={t("attach.htmlCloseFullscreen")} title={t("attach.htmlCloseFullscreen")}
          className="flex size-9 shrink-0 items-center justify-center rounded-lg text-white/70 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
          <X size={19} />
        </button>
      </header>
      {bar && <div className="shrink-0 bg-black px-3 py-2">{bar}</div>}
      <PageFrame url={url} name={name} frameRef={frameRef} onLoad={onLoad} className="block min-h-0 w-full flex-1 border-0 bg-white" />
    </div>,
    document.body,
  );
}
