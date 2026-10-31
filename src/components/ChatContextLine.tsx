import { t } from "@/lib/i18n";
import { approvalModeFor } from "../../shared/approval-mode";
import type { Bot } from "@/state/store";

/** Under the composer: what this bot reads and what always waits for the person. */
export function ChatContextLine({ bot }: { bot: Bot }) {
  const mode = approvalModeFor(bot);
  const key = mode === "full" ? "chatContext.full" : mode === "auto" ? "chatContext.auto" : "chatContext.ask";
  return (
    <p data-chat-context="" className="pointer-events-auto mx-auto -mt-1 mb-2 max-w-[760px] px-6 text-center text-[11px] leading-snug text-ink-tertiary">
      {t(key, { name: bot.name })}
    </p>
  );
}

export function headerRoleLine(bot: Pick<Bot, "title">, owner: string): string {
  const role = bot.title.trim();
  return role ? t("chatHeader.roleOwner", { role, owner }) : t("chatHeader.owner", { owner });
}
