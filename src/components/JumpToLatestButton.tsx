import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ArrowDown } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";

/** How many replies arrived while the person was scrolled up; resets once they are back at the bottom. */
export function useArrivedWhileAway(messages: readonly { id: string; kind: string; role: string }[], following: boolean): number {
  const [lastSeenId, setLastSeenId] = useState<string | null>(null);
  const latestId = useRef<string | undefined>(undefined);
  latestId.current = messages.at(-1)?.id;
  useEffect(() => {
    setLastSeenId(following ? null : (latestId.current ?? null));
  }, [following]);
  if (following || lastSeenId === null) return 0;
  const seenAt = messages.findLastIndex((message) => message.id === lastSeenId);
  if (seenAt < 0) return 0;
  return messages.slice(seenAt + 1).filter((message) => message.kind === "text" && message.role === "bot").length;
}

export function JumpToLatestButton({ onClick, className, style, count = 0 }: { onClick: () => void; className?: string; style?: CSSProperties; count?: number }) {
  if (count > 0) {
    return (
      <button
        onClick={onClick}
        type="button"
        data-new-messages-pill=""
        aria-label={t("chat.jumpToLatestAria")}
        className={cn("animate-pop-in absolute left-1/2 z-10 flex h-8 -translate-x-1/2 items-center gap-1.5 rounded-full bg-unread px-3.5 text-[12.5px] font-medium text-white shadow-lg hover:brightness-110", className)}
        style={style}
      >
        <ArrowDown size={14} aria-hidden="true" />
        {count === 1 ? t("chat.newMessagesOne") : t("chat.newMessagesMany", { count })}
      </button>
    );
  }
  return (
    <button
      onClick={onClick}
      type="button"
      aria-label={t("chat.jumpToLatestAria")}
      title={t("chat.jumpToLatest")}
      className={cn("animate-pop-in absolute left-1/2 z-10 flex size-9 -translate-x-1/2 items-center justify-center nb-pill nb-pill-float rounded-full text-ink shadow-lg", className)}
      style={style}
    >
      <ArrowDown size={18} aria-hidden="true" />
    </button>
  );
}
