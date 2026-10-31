import { useMemo, useState, type ReactNode } from "react";
import { FileText, Link2, Star } from "lucide-react";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { normalizeState } from "@/lib/mascot";
import { citationPreviewText } from "@/lib/citations";
import { visibleBotText } from "@/lib/visible-bot-text";
import { plainChatText } from "../../shared/plain-chat-text";
import { formatTime, useStore, type Bot, type Group, type Message } from "@/state/store";
import { BotAvatar } from "./Avatar";
import { AttachmentGallery, collectMessageFiles, splitMessageAttachments } from "./AttachmentGallery";
import { AttachmentPreviewDialog, AttachmentThumbnail, previewImage, type PreviewImage } from "./AttachmentPreview";
import type { GalleryFile } from "./AttachmentGallery";

const URL_PATTERN = /https?:\/\/[^\s<>()[\]"'`]+[^\s<>()[\]"'`.,;:!?]/g;

export interface RoomLink { url: string; host: string; messageId: string; at: number }

/** Everything that passed through the room's loaded messages: pictures, links and files, newest first. */
export function roomMedia(messages: readonly Message[]): { images: PreviewImage[]; links: RoomLink[]; files: GalleryFile[] } {
  const images: PreviewImage[] = [];
  const links: RoomLink[] = [];
  const files: GalleryFile[] = [];
  const seenImages = new Set<string>();
  const seenLinks = new Set<string>();
  const seenFiles = new Set<string>();
  for (const message of [...messages].reverse()) {
    if (message.kind !== "text") continue;
    const attached = splitMessageAttachments(message.attachments);
    for (const path of attached.images) {
      const image = previewImage(path);
      if (image && !seenImages.has(image.src)) {
        seenImages.add(image.src);
        images.push(image);
      }
    }
    const text = message.text ?? "";
    for (const file of [...attached.files, ...collectMessageFiles(text, attached.images)]) {
      if (seenFiles.has(file.path)) continue;
      seenFiles.add(file.path);
      files.push(file);
    }
    for (const match of text.matchAll(URL_PATTERN)) {
      const url = match[0];
      if (seenLinks.has(url)) continue;
      seenLinks.add(url);
      let host = url;
      try { host = new URL(url).hostname.replace(/^www\./, ""); } catch {}
      links.push({ url, host, messageId: message.id, at: message.at });
    }
  }
  return { images, links, files };
}

export function roomMediaCount(messages: readonly Message[]): number {
  const media = roomMedia(messages);
  return media.images.length + media.links.length + media.files.length;
}

type GalleryTab = "media" | "links" | "docs";

export function RoomGallery({ group }: { group: Group }) {
  const media = useMemo(() => roomMedia(group.messages), [group.messages]);
  const [tab, setTab] = useState<GalleryTab>(media.images.length ? "media" : media.links.length ? "links" : "docs");
  const [preview, setPreview] = useState<number | null>(null);
  const tabs: Array<[GalleryTab, string, number]> = [
    ["media", t("room.info.galleryMedia"), media.images.length],
    ["links", t("room.info.galleryLinks"), media.links.length],
    ["docs", t("room.info.galleryDocs"), media.files.length],
  ];
  return (
    <div data-room-gallery="" className="flex flex-col gap-4">
      <div role="tablist" className="flex justify-center gap-1">
        {tabs.map(([id, label, count]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            data-room-gallery-tab={id}
            onClick={() => setTab(id)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition-colors",
              tab === id ? "border-white/[0.10] bg-white/[0.12] text-ink" : "border-transparent text-ink-secondary hover:bg-white/[0.05] hover:text-ink",
            )}
          >
            {label} <span className="text-ink-tertiary">{count}</span>
          </button>
        ))}
      </div>
      {tab === "media" && (media.images.length ? (
        <div className="grid grid-cols-3 gap-1.5">
          {media.images.map((image, index) => (
            <div key={image.src} className="aspect-square overflow-hidden rounded-[10px] bg-white/[0.04]">
              <AttachmentThumbnail image={image} onPreview={() => setPreview(index)} className="size-full rounded-none border-0 object-cover [&_img]:size-full [&_img]:object-cover" />
            </div>
          ))}
        </div>
      ) : <Empty text={t("room.info.galleryNoMedia")} />)}
      {tab === "links" && (media.links.length ? (
        <ul className="flex flex-col divide-y divide-hairline/40 rounded-[14px] border border-white/[0.07] bg-white/[0.03]">
          {media.links.map((link) => (
            <li key={link.url}>
              <a href={link.url} target="_blank" rel="noreferrer noopener" className="flex items-center gap-3 px-3 py-2.5 hover:bg-white/[0.04]">
                <LinkIcon host={link.host} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-ink">{link.host}</span>
                  <span className="block truncate text-[11.5px] text-ink-tertiary">{link.url}</span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      ) : <Empty text={t("room.info.galleryNoLinks")} />)}
      {tab === "docs" && (media.files.length ? (
        <AttachmentGallery files={media.files} className="flex-col" />
      ) : <Empty text={t("room.info.galleryNoDocs")} icon={<FileText size={18} aria-hidden="true" />} />)}
      {preview !== null && media.images[preview] && (
        <AttachmentPreviewDialog image={media.images[preview]} images={media.images} initialIndex={preview} onClose={() => setPreview(null)} />
      )}
    </div>
  );
}

/** The site's own icon, asked of the site itself (no third-party favicon service); a plain link icon when it has none. */
function LinkIcon({ host }: { host: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.06]">
      {failed
        ? <Link2 size={14} className="text-ink-secondary" aria-hidden="true" />
        : <img loading="lazy" decoding="async" src={`https://${host}/favicon.ico`} alt="" referrerPolicy="no-referrer" className="size-4" onError={() => setFailed(true)} />}
    </span>
  );
}

function Empty({ text, icon }: { text: string; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center text-[12.5px] text-ink-tertiary">
      {icon}
      {text}
    </div>
  );
}

/** Starred messages of the room, newest star first; a click jumps to the message in the conversation. */
export function RoomFavorites({ group, members, onOpen }: { group: Group; members: Bot[]; onOpen: () => void }) {
  const { dispatch } = useStore();
  const ids = group.favoriteMessageIds ?? [];
  const byId = new Map(group.messages.map((message) => [message.id, message]));
  const shown = ids.map((id) => byId.get(id)).filter((message): message is Message => Boolean(message));
  if (!ids.length) return <Empty text={t("room.info.favoritesNone")} icon={<Star size={18} aria-hidden="true" />} />;
  return (
    <ul data-room-favorites="" className="flex flex-col divide-y divide-hairline/40 rounded-[14px] border border-white/[0.07] bg-white/[0.03]">
      {shown.map((message) => {
        const bot = message.from?.botId ? members.find((member) => member.id === message.from?.botId) : undefined;
        const who = message.role === "user" ? t("chat.you") : (message.from?.name ?? bot?.name ?? t("room.aBot"));
        const text = citationPreviewText(message.role === "user" ? message.text ?? "" : plainChatText(visibleBotText(message.text ?? ""))).replace(/\s+/g, " ").trim();
        return (
          <li key={message.id}>
            <button
              type="button"
              data-room-favorite={message.id}
              onClick={() => {
                dispatch({ type: "focusMessage", threadId: group.threadId, messageId: message.id });
                onOpen();
              }}
              className="flex w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-white/[0.04]"
            >
              {bot
                ? <BotAvatar bot={bot} state={normalizeState(bot.mascotExpression) ?? "happy"} size={28} animated={false} />
                : <span className="size-7 shrink-0 rounded-full bg-white/[0.08]" />}
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[12.5px] font-medium text-ink">{who}</span>
                  <span className="shrink-0 text-[11px] text-ink-tertiary">{formatTime(message.at)}</span>
                </span>
                <span dir="auto" className="line-clamp-2 text-[12.5px] text-ink-secondary">{text}</span>
              </span>
            </button>
          </li>
        );
      })}
      {shown.length < ids.length && (
        <li className="px-3 py-2.5 text-[12px] text-ink-tertiary">{t("room.info.favoritesOlder", { count: ids.length - shown.length })}</li>
      )}
    </ul>
  );
}
