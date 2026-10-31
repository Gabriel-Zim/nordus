import { UsersRound } from "lucide-react";
import { t } from "@/lib/i18n";
import type { Bot } from "@/state/store";
import { BotAvatar } from "./Avatar";
import type { AttentionThread } from "./SidebarBotActivity";

export function needsYouEntries(entries: readonly AttentionThread[]): AttentionThread[] {
  return entries.filter((entry) => entry.task.activity === "waiting-on-you");
}

export function NeedsYouPanel({ entries, bots, onJump }: {
  entries: AttentionThread[];
  bots: readonly Bot[];
  onJump: (entry: AttentionThread) => void;
}) {
  return (
    <section data-needs-you="" aria-label={t("needsYou.title")} className="mb-2">
      <div className="flex items-center gap-2 px-2 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-secondary">
        <span className="min-w-0 flex-1 truncate">{t("needsYou.title")}</span>
        {entries.length > 0 && (
          <span className="rounded-[7px] bg-accent px-1.5 text-[10.5px] leading-[18px] tabular-nums text-white">{entries.length}</span>
        )}
      </div>
      {entries.length === 0 ? (
        <div className="px-2 pb-1 text-[12px] text-ink-tertiary">{t("needsYou.empty")}</div>
      ) : entries.map((entry) => {
        const bot = entry.kind === "bot" ? bots.find((item) => item.id === entry.botId) : undefined;
        const owner = entry.kind === "bot" ? entry.botName : entry.groupName;
        return (
          <button
            key={`${entry.kind}:${entry.task.threadId}`}
            type="button"
            onClick={() => onJump(entry)}
            className="flex w-full min-w-0 items-center gap-2.5 rounded-[10px] border border-transparent px-2 py-1.5 text-left hover:border-white/10 hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
          >
            {bot ? (
              <BotAvatar bot={bot} size={30} animated={false} />
            ) : (
              <span className="grid size-[30px] shrink-0 place-items-center rounded-[8px] border border-white/10 bg-white/[0.04] text-ink-secondary">
                <UsersRound size={14} aria-hidden="true" />
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold text-ink">{owner}</span>
              <span className="block truncate text-[11.5px] text-ink-secondary">{entry.task.title}</span>
            </span>
            <span className="size-2 shrink-0 rounded-full bg-warning" aria-hidden="true" />
          </button>
        );
      })}
    </section>
  );
}
