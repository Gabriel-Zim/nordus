import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { Bot } from "@/state/store";
import { ApprovalHoldButton } from "./ApprovalHoldButton";
import { APPROVAL_CONTROL, approvalNaturalText, useApprovalDecision, type Pending } from "./PendingApproval";

/** An approval answered from the collapsed list's hover card: the same sentence and the same decision as the card in
 *  the conversation, in smaller buttons, and nothing technical (that stays behind "Ver detalhes", in the conversation).
 *  No button takes the focus on its own, so the card does not close under the person's pointer. */
export function SidebarRailApproval({ pending, threadId, bot, onDetails }: {
  pending: Pending;
  threadId: string;
  bot: Pick<Bot, "id" | "name">;
  onDetails: () => void;
}) {
  const { allowOnce, releaseTask, alwaysAllow, deny, critical } = useApprovalDecision(pending, threadId, bot);
  const small = cn(APPROVAL_CONTROL, "h-6 rounded-[8px] px-2.5 text-[12px]");
  return (
    <div data-rail-approval="" className="flex flex-col gap-2 border-t border-white/[0.08] pt-2">
      <p className="line-clamp-3 text-[12.5px] leading-[17px] text-ink">{approvalNaturalText(pending)}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        {critical
          ? <ApprovalHoldButton onApprove={allowOnce.run} disabled={allowOnce.disabled} className={small} />
          : <button type="button" onClick={allowOnce.run} disabled={allowOnce.disabled}
            className={cn(small, "bg-accent text-white hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-40")}>
            {allowOnce.label}
          </button>}
        {releaseTask && (
          <button type="button" onClick={releaseTask.run} aria-label={releaseTask.name} title={releaseTask.hint}
            className={cn(small, "bg-ink/[0.07] text-ink hover:bg-ink/[0.12]")}>
            {releaseTask.label}
          </button>
        )}
        {alwaysAllow && (
          <button type="button" onClick={alwaysAllow.run} aria-label={alwaysAllow.name} title={alwaysAllow.hint}
            className={cn(small, "bg-ink/[0.07] text-ink hover:bg-ink/[0.12]")}>
            {alwaysAllow.label}
          </button>
        )}
        <button type="button" onClick={deny.run} className={cn(small, "bg-ink/[0.07] text-danger hover:bg-danger/15")}>
          {deny.label}
        </button>
        <button type="button" onClick={onDetails} className="ml-auto rounded-md px-1 text-[11.5px] text-ink-tertiary hover:text-ink">
          {t("sidebar.rail.approvalDetails")}
        </button>
      </div>
    </div>
  );
}

/** The card's foot while the request is being read, or when the bot waits for something that is not an approval. */
export function SidebarRailWaiting({ loading, onDetails }: { loading: boolean; onDetails: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2 border-t border-white/[0.08] pt-2">
      <span className="text-[12px] text-ink-tertiary">{loading ? t("sidebar.rail.approvalLoading") : t("sidebar.rail.waitingOther")}</span>
      <button type="button" onClick={onDetails} className="rounded-md px-1 text-[11.5px] text-ink-tertiary hover:text-ink">
        {t("sidebar.rail.approvalDetails")}
      </button>
    </div>
  );
}
