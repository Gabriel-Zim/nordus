import { useEffect, useRef, useState } from "react";
import { ClipboardPaste, File as FileIcon, FileText, LoaderCircle, Play, X } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  attachmentImageUrl,
  intakeFiles,
  pasteSummary,
  type Attachment,
  type FileAttachment,
  type PasteAttachment,
} from "@/lib/composer-attachments";
import { AttachmentPreviewDialog, previewImage, type PreviewImage } from "./AttachmentPreview";
import { CitationBadge } from "./CitationUI";
import type { CitationAttachment } from "@/lib/citations";
import { t } from "@/lib/i18n";

/** Electron 32 removed File.path — only the preload can name a file. */
export function pathForFile(file: File): string {
  return window.ogb?.getPathForFile?.(file) ?? "";
}

export function ComposerAttachments({
  placement = "outside",
  items,
  onAdd,
  onRemove,
  onChangeCitation,
  onDisplayInChatBox,
  allowImages = true,
  notice,
  onNotice,
  onPendingChange,
  uploadImage,
  uploadFile,
}: {
  /** outside: the drop overlay and notices, above the box. inside: the thumbnails, at the top of the box. */
  placement?: "outside" | "inside";
  items: Attachment[];
  onAdd: (attachments: Attachment[]) => void;
  onRemove: (id: string) => void;
  onChangeCitation: (citation: CitationAttachment) => void;
  onDisplayInChatBox: (attachment: PasteAttachment) => void;
  allowImages?: boolean;
  notice: string | null;
  onNotice: (notice: string | null) => void;
  onPendingChange?: (pending: boolean) => void;
  uploadImage: (file: File) => Promise<Attachment | null>;
  uploadFile?: (file: File) => Promise<FileAttachment | "added" | null>;
}) {
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<PreviewImage | null>(null);
  // dragenter/dragleave fire once per element crossed, so the overlay tracks depth.
  const depth = useRef(0);
  const callbacks = useRef({ onAdd, onNotice, onPendingChange, allowImages, uploadImage, uploadFile });
  callbacks.current = { onAdd, onNotice, onPendingChange, allowImages, uploadImage, uploadFile };
  const pendingDrops = useRef(new Set<symbol>());

  useEffect(() => {
    // One window listener set: the copy inside the box only draws thumbnails.
    if (placement === "inside") return;
    const carriesFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");

    const onEnter = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      depth.current += 1;
      setDragging(true);
    };
    const onLeave = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    };
    // Without preventDefault the window navigates to the dropped file.
    const onOver = (e: DragEvent) => {
      if (carriesFiles(e)) e.preventDefault();
    };
    const onDrop = async (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setDragging(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      const operation = Symbol("attachment-drop");
      pendingDrops.current.add(operation);
      callbacks.current.onPendingChange?.(true);
      try {
        const { attachments, notice: message } = await intakeFiles(files, {
          allowImages: callbacks.current.allowImages,
          getPath: pathForFile,
          uploadImage: callbacks.current.uploadImage,
          uploadFile: callbacks.current.uploadFile,
        });
        if (attachments.length) callbacks.current.onAdd(attachments);
        if (message) callbacks.current.onNotice(message);
      } finally {
        if (pendingDrops.current.delete(operation)) callbacks.current.onPendingChange?.(false);
      }
    };

    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("dragover", onOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("drop", onDrop);
    };
  }, [placement]);

  if (placement === "outside") {
    return (
      <>
        {dragging && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-10">
            <div className="rounded-2xl border-2 border-dashed border-accent/70 bg-panel/90 px-8 py-6 text-[14px] font-medium text-ink shadow-2xl">
              {t("composer.attachments.drop")}
            </div>
          </div>
        )}
        {notice && (
          <div className="mb-2 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-[12px] text-warning">
            <span className="min-w-0 flex-1">{notice}</span>
            <button onClick={() => onNotice(null)} aria-label={t("composer.attachments.dismiss")} className="shrink-0 rounded p-0.5">
              <X size={12} />
            </button>
          </div>
        )}
      </>
    );
  }

  return (
    <AttachmentStrip
      items={items}
      onRemove={onRemove}
      onChangeCitation={onChangeCitation}
      onDisplayInChatBox={onDisplayInChatBox}
      onPreview={setPreview}
      preview={preview}
    />
  );
}

/** "37%": whole percent, never below 0 or above 100. */
export function uploadPercentLabel(progress: number): string {
  return `${Math.min(100, Math.max(0, Math.round(progress)))}%`;
}

const VIDEO_NAME = /\.(?:mp4|m4v|mov|webm)$/i;

/**
 * Inside the composer, at the top of the box, the way Grok shows them: square thumbnails cut to fill, a pill
 * for any other file, a small glass X on each. The strip opens and closes with a short height animation, so
 * the box grows up when something is attached and shrinks back when the last one goes.
 */
function AttachmentStrip({
  items,
  onRemove,
  onChangeCitation,
  onDisplayInChatBox,
  onPreview,
  preview,
}: {
  items: Attachment[];
  onRemove: (id: string) => void;
  onChangeCitation: (citation: CitationAttachment) => void;
  onDisplayInChatBox: (attachment: PasteAttachment) => void;
  onPreview: (image: PreviewImage | null) => void;
  preview: PreviewImage | null;
}) {
  // Kept while the strip closes, so the last thumbnails fold away instead of vanishing.
  const [shown, setShown] = useState(items);
  useEffect(() => {
    if (items.length) {
      setShown(items);
      return;
    }
    const timer = setTimeout(() => setShown([]), 240);
    return () => clearTimeout(timer);
  }, [items]);
  // A video whose first frame cannot load (its copy is gone) falls back to the file pill.
  const [broken, setBroken] = useState<ReadonlySet<string>>(() => new Set());
  const open = items.length > 0;
  const list = open ? items : shown;
  return (
    <>
      <div
        data-composer-attachments=""
        aria-hidden={open ? undefined : true}
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-[220ms] ease-out motion-reduce:transition-none",
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="flex items-start gap-2 overflow-x-auto px-1.5 pb-1.5 pt-1.5 [scrollbar-width:thin]">
            {list.map((a) =>
              a.kind === "citation" ? (
                <CitationBadge key={a.id} citation={a} onChange={onChangeCitation} onRemove={() => onRemove(a.id)} />
              ) : a.kind === "image" ? (
                <Tile key={a.id} name={a.name} onRemove={() => onRemove(a.id)}>
                  <button
                    type="button"
                    onClick={() => {
                      const image = previewImage(a.path, a.name);
                      const src = image?.src ?? a.previewUrl;
                      if (src) onPreview(image ?? { src, name: a.name });
                    }}
                    disabled={!attachmentImageUrl(a.path) && !a.previewUrl}
                    aria-busy={a.uploading || undefined}
                    aria-label={t("composer.attachments.preview", { name: a.name })}
                    className="block size-full focus-visible:outline-none disabled:cursor-default"
                  >
                    <img
                      src={attachmentImageUrl(a.path) ?? a.previewUrl}
                      alt={a.name}
                      loading="eager"
                      fetchPriority="high"
                      className="size-full object-cover"
                    />
                  </button>
                  {a.uploading && (
                    <span className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/25" aria-label={t("composer.attachments.uploading")}>
                      <LoaderCircle size={20} className="animate-spin text-white" aria-hidden="true" />
                      {typeof a.progress === "number" && (
                        <span data-upload-percent="" className="text-[12px] font-medium tabular-nums text-white">{uploadPercentLabel(a.progress)}</span>
                      )}
                    </span>
                  )}
                </Tile>
              ) : a.kind === "file" && VIDEO_NAME.test(a.name) && a.previewUrl && !broken.has(a.id) ? (
                <Tile key={a.id} name={a.name} onRemove={() => onRemove(a.id)}>
                  <video
                    src={`${a.previewUrl}#t=0.1`}
                    muted
                    playsInline
                    preload="metadata"
                    onError={() => setBroken((current) => new Set(current).add(a.id))}
                    className="size-full object-cover"
                    aria-label={a.name}
                  />
                  <span className="pointer-events-none absolute bottom-2 left-2 flex size-7 items-center justify-center rounded-full border border-white/25 bg-black/40 text-white">
                    <Play size={12} className="translate-x-px fill-current" aria-hidden="true" />
                  </span>
                </Tile>
              ) : a.kind === "paste" ? (
                <Pill
                  key={a.id}
                  icon={<ClipboardPaste size={15} aria-hidden="true" />}
                  label={t("composer.attachments.pasted")}
                  detail={pasteSummary(a)}
                  title={a.text.slice(0, 4000)}
                  onClick={() => onDisplayInChatBox(a)}
                  clickLabel={t("composer.attachments.showInBox")}
                  onRemove={() => onRemove(a.id)}
                  removeLabel={t("composer.attachments.remove", { name: t("composer.attachments.pasted") })}
                />
              ) : (
                <Pill
                  key={a.id}
                  icon={/\.pdf$/i.test(a.name) ? <FileText size={15} aria-hidden="true" /> : <FileIcon size={15} aria-hidden="true" />}
                  label={a.name}
                  title={a.name}
                  progress={a.kind === "file" && a.uploading ? (a.progress ?? 0) : undefined}
                  onRemove={() => onRemove(a.id)}
                  removeLabel={t("composer.attachments.remove", { name: a.name })}
                />
              ),
            )}
          </div>
        </div>
      </div>
      {preview && <AttachmentPreviewDialog image={preview} onClose={() => onPreview(null)} />}
    </>
  );
}

function RemoveButton({ label, onRemove, className }: { label: string; onRemove: () => void; className?: string }) {
  // Not `hidden`: that would take the only way to remove an attachment out of the keyboard's reach.
  return (
    <button
      type="button"
      onClick={onRemove}
      aria-label={label}
      title={label}
      className={cn(
        "flex size-6 items-center justify-center rounded-full border border-white/25 bg-black/40 text-white opacity-0 transition-opacity hover:bg-black/55 focus-visible:opacity-100 group-hover:opacity-100 touch:opacity-100",
        className,
      )}
    >
      <X size={12} strokeWidth={2.5} aria-hidden="true" />
    </button>
  );
}

function Tile({ children, name, onRemove }: { children: React.ReactNode; name: string; onRemove: () => void }) {
  return (
    <div title={name} className="group relative size-[120px] shrink-0 overflow-hidden rounded-2xl bg-inset sm:size-[150px]">
      {children}
      <RemoveButton label={t("composer.attachments.remove", { name })} onRemove={onRemove} className="absolute right-1.5 top-1.5" />
    </div>
  );
}

function Pill({
  icon,
  label,
  detail,
  title,
  onClick,
  clickLabel,
  progress,
  onRemove,
  removeLabel,
}: {
  icon: React.ReactNode;
  label: string;
  detail?: string;
  title: string;
  onClick?: () => void;
  clickLabel?: string;
  /** Whole percent while the file is still going up: shown as a number and a thin bar. */
  progress?: number;
  onRemove: () => void;
  removeLabel: string;
}) {
  const uploading = typeof progress === "number";
  const content = (
    <>
      <span className="shrink-0 text-ink-secondary">{icon}</span>
      <span className="min-w-0 truncate text-[13px] text-ink">{label}</span>
      {detail && <span className="shrink-0 text-[12px] text-ink-tertiary">· {detail}</span>}
      {uploading && <span data-upload-percent="" className="shrink-0 text-[12px] tabular-nums text-ink-tertiary">· {uploadPercentLabel(progress)}</span>}
    </>
  );
  return (
    <div title={title} aria-busy={uploading || undefined} className="group relative flex h-10 max-w-[260px] shrink-0 items-center overflow-hidden rounded-xl border border-hairline/50 bg-raised pl-3 pr-9">
      {onClick ? (
        <button type="button" onClick={onClick} aria-label={clickLabel} title={clickLabel} className="flex min-w-0 items-center gap-2 focus-visible:outline-none">
          {content}
        </button>
      ) : (
        <span className="flex min-w-0 items-center gap-2">{content}</span>
      )}
      <button
        type="button"
        onClick={onRemove}
        aria-label={removeLabel}
        title={removeLabel}
        className="absolute right-2 flex size-6 items-center justify-center rounded-full text-ink-tertiary hover:bg-ink/10 hover:text-ink"
      >
        <X size={13} aria-hidden="true" />
      </button>
      {uploading && (
        <span
          role="progressbar"
          aria-label={t("composer.attachments.uploading")}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.min(100, Math.max(0, Math.round(progress)))}
          className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-ink/10"
        >
          <span className="block h-full bg-accent transition-[width] duration-150" style={{ width: `${Math.min(100, Math.max(0, progress))}%` }} />
        </span>
      )}
    </div>
  );
}
