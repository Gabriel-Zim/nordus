import { ChevronDown, ChevronRight } from "lucide-react";
import { BotAvatar } from "./Avatar";
import { normalizeState } from "@/lib/mascot";
import { t } from "@/lib/i18n";
import { formatTime } from "@/state/store";
import type { PeerLine } from "@/lib/peer-message";
import type { Bot } from "@/state/store";

/** Who sent a line between bots, above its bubble: their face, their name and what they did. */
export function PeerLabel({
  peer,
  bots,
  at,
  open = false,
  onToggle,
}: {
  peer: PeerLine;
  bots: readonly Bot[];
  at?: number;
  open?: boolean;
  onToggle?: () => void;
}) {
  const author =
    bots.find((b) => b.id === peer.botId) ?? bots.find((b) => b.name === peer.name);
  const how =
    peer.delivery === "delegate_bot"
      ? t("chat.peer.delegated")
      : peer.delivery === "start_thread"
        ? t("chat.peer.openedThread")
        : peer.delivery === "coordinate_bots"
          ? t("chat.peer.requested")
          : t("chat.peer.asked");
  const face = (
    <BotAvatar
      bot={author ?? { name: peer.name, color: "blue" }}
      state={normalizeState(author?.mascotExpression) ?? "happy"}
      size={16}
      motion="none"
      motionKey={0}
      animated={false}
    />
  );
  if (!onToggle || at === undefined) {
    return (
      <div className="flex items-center gap-1.5 pl-0.5" data-testid="peer-label">
        {face}
        <span className="text-[11px] text-ink-tertiary">{peer.name}</span>
        <span className="text-[11px] text-ink-tertiary">· {how}</span>
      </div>
    );
  }
  const action = t(open ? "chat.peer.hideMessage" : "chat.peer.showMessage");
  const from = t("chat.peer.messageFrom", { name: peer.name });
  return (
    <div className="my-1 flex w-full justify-center" data-testid="peer-label">
      <button
        type="button"
        aria-expanded={open}
        aria-label={`${action}: ${from}`}
        title={action}
        onClick={onToggle}
        className="flex min-w-0 max-w-full items-center gap-1.5 rounded-full px-3 py-1 text-[12px] text-ink-tertiary transition-colors hover:bg-raised/60 hover:text-ink-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      >
        {face}
        <span className="min-w-0 truncate font-medium text-ink-secondary">{from}</span>
        <span aria-hidden="true" className="shrink-0">·</span>
        <span className="shrink-0">{how}</span>
        <span aria-hidden="true" className="shrink-0">·</span>
        <span className="shrink-0 tabular-nums">{formatTime(at)}</span>
        {open ? <ChevronDown size={13} aria-hidden="true" className="shrink-0" /> : <ChevronRight size={13} aria-hidden="true" className="shrink-0" />}
      </button>
    </div>
  );
}
