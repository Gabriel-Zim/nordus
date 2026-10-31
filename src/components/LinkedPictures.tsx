import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { requestMessageFile, type MessageAttachmentContext } from "./AttachmentPreview";

/** Pictures a message names by path, as thumbnails side by side; a click opens one full screen with the others below.
 *  Security: each picture is asked of the message that named it, never by its host path in a URL. */
export function LinkedPictures({ paths, message }: { paths: readonly string[]; message: MessageAttachmentContext }) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<number | null>(null);
  const key = paths.join("\n");
  useEffect(() => {
    const controller = new AbortController();
    const made: string[] = [];
    for (const path of key.split("\n")) {
      void requestMessageFile(path, message, controller.signal)
        .then((response) => response.blob())
        .then((blob) => {
          const url = URL.createObjectURL(blob);
          made.push(url);
          setUrls((current) => ({ ...current, [path]: url }));
        })
        .catch(() => undefined);
    }
    return () => {
      controller.abort();
      for (const url of made) URL.revokeObjectURL(url);
    };
  }, [key, message.threadId, message.messageId]);
  useEffect(() => {
    if (open === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(null);
      else if (event.key === "ArrowRight") setOpen((index) => index === null ? index : (index + 1) % paths.length);
      else if (event.key === "ArrowLeft") setOpen((index) => index === null ? index : (index - 1 + paths.length) % paths.length);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, paths.length]);

  // Pictures this message may not hand out (another bot's folder) are only counted: never a path or a file name.
  if (!paths.some((path) => urls[path])) return <p data-linked-pictures="" className="mt-2 text-[12.5px] text-ink-tertiary">{t(paths.length === 1 ? "attach.picturesOne" : "attach.picturesMany", { count: paths.length })}</p>;
  return (
    <>
      <div data-linked-pictures="" className={cn("mt-2 grid gap-1.5", paths.length === 1 ? "grid-cols-1 max-w-[16rem]" : paths.length === 2 ? "grid-cols-2 max-w-[24rem]" : "grid-cols-3 max-w-[30rem]")}>
        {paths.map((path, index) => (
          <button
            key={path}
            type="button"
            onClick={() => setOpen(index)}
            aria-label={t("attach.openImage")}
            className="aspect-[4/5] overflow-hidden rounded-[10px] border border-ink/10 bg-ink/[0.04] hover:border-ink/25"
          >
            {urls[path] && <img loading="lazy" decoding="async" src={urls[path]} alt="" className="size-full object-cover" />}
          </button>
        ))}
      </div>
      {open !== null && createPortal(
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-black/85 p-6" onClick={() => setOpen(null)}>
          <button type="button" onClick={() => setOpen(null)} aria-label={t("whatItDid.close")} className="absolute right-4 top-4 rounded-full p-2 text-white/80 hover:bg-white/10 hover:text-white">
            <X size={20} />
          </button>
          {urls[paths[open]!] && <img loading="lazy" decoding="async" src={urls[paths[open]!]} alt="" className="max-h-[72vh] max-w-full rounded-[12px] object-contain" onClick={(event) => event.stopPropagation()} />}
          {paths.length > 1 && (
            <div className="flex gap-2" onClick={(event) => event.stopPropagation()}>
              {paths.map((path, index) => (
                <button key={path} type="button" onClick={() => setOpen(index)} className={cn("h-16 w-[52px] overflow-hidden rounded-[8px] border", index === open ? "border-white" : "border-white/20 opacity-70 hover:opacity-100")}>
                  {urls[path] && <img loading="lazy" decoding="async" src={urls[path]} alt="" className="size-full object-cover" />}
                </button>
              ))}
            </div>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}
