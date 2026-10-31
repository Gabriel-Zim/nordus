import { ShieldCheck } from "lucide-react";
import { decidableCount, useApprovalsFeed } from "@/lib/approvals-feed";
import { t } from "@/lib/i18n";
import { useStore } from "@/state/store";

export function TodayApprovals() {
  const { dispatch } = useStore();
  const { items } = useApprovalsFeed();
  const count = decidableCount(items);
  if (!count) return null;
  return (
    <section aria-labelledby="today-approvals" className="flex items-start gap-3 rounded-xl border border-warning/30 bg-card px-4 py-3" data-testid="today-approvals">
      <ShieldCheck size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-warning" />
      <div className="min-w-0 flex-1">
        <h2 id="today-approvals" className="text-[13.5px] font-medium text-ink">{t("inbox.today.title", { count })}</h2>
        <p className="mt-0.5 text-[12.5px] text-ink-secondary">{t("inbox.today.body")}</p>
      </div>
      <button type="button" className="ui-button ui-button-sm shrink-0" onClick={() => dispatch({ type: "showInbox" })}>{t("inbox.today.open")}</button>
    </section>
  );
}
