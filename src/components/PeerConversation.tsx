import { ArrowLeftRight } from "lucide-react";
import { t } from "@/lib/i18n";
import type { Bot } from "@/state/store";
import { BotAvatar } from "./Avatar";

type Party = { name: string; bot?: Bot };

function PartyChip({ party }: { party: Party }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      {party.bot ? <BotAvatar bot={party.bot} size={22} animated={false} /> : null}
      <span className="bot-identity nb-name truncate text-[13px]" data-bot-color={party.bot?.color}>{party.name}</span>
    </span>
  );
}

/** The header of a conversation between two bots: who asked, who answers, nothing else. */
export function PeerConversationPill({ from, to }: { from: Party; to: Party }) {
  return (
    <div className="flex justify-center" data-peer-conversation="">
      <div
        className="nb-pill flex max-w-full items-center gap-2.5 rounded-[14px] px-3 py-1.5"
        aria-label={t("handoff.header", { from: from.name, to: to.name })}
      >
        <PartyChip party={from} />
        <ArrowLeftRight size={13} aria-hidden="true" className="shrink-0 text-ink-tertiary" />
        <PartyChip party={to} />
      </div>
    </div>
  );
}

/** The header of a task a bot opened on itself: what the task is, not who talks to whom. */
export function TaskConversationTitle({ title }: { title: string }) {
  return (
    <div className="flex justify-center pb-2" data-task-conversation="">
      <div className="nb-pill flex max-w-full min-w-0 items-center gap-2 rounded-[14px] px-3 py-1.5">
        <span className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-tertiary">{t("task.header.label")}</span>
        <span className="truncate text-[13px] font-medium text-ink" title={title}>{title}</span>
      </div>
    </div>
  );
}

export function ClosePeerConversation({ onClose }: { onClose: () => void }) {
  return (
    <div className="pointer-events-auto flex justify-center pb-4 pt-2">
      <button
        type="button"
        data-close-peer-conversation=""
        onClick={onClose}
        className="nb-pill rounded-full px-5 py-2 text-[13px] font-medium text-ink transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      >
        {t("peerConversation.close")}
      </button>
    </div>
  );
}
