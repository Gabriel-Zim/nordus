import { Inbox } from "lucide-react";
import { decidableCount, useApprovalsFeed } from "@/lib/approvals-feed";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { SidebarDensity } from "@/lib/sidebar-preferences";
import { useStore } from "@/state/store";

const BADGE_MAX = 9;

export function SidebarInboxNav({ density, inline = false }: { density: SidebarDensity; /** The icon on the list's top row. */ inline?: boolean }) {
  const { state, dispatch } = useStore();
  const { items } = useApprovalsFeed();
  const waiting = decidableCount(items);
  const active = state.activeView === "inbox";
  const label = waiting ? t("inbox.nav.waiting", { count: waiting }) : t("inbox.nav.label");
  const iconsOnly = density === "icons";
  if (!inline && !iconsOnly) return null;
  return (
    <div className={iconsOnly ? "flex justify-center px-2 pb-1" : "contents"}>
      <button
        type="button"
        data-sidebar-nav="inbox"
        data-preload="inbox"
        data-waiting={waiting || undefined}
        aria-label={label}
        title={label}
        aria-current={active ? "page" : undefined}
        onClick={() => dispatch({ type: "showInbox" })}
        className={cn(
          "relative flex shrink-0 items-center justify-center rounded-xl transition-colors",
          iconsOnly ? "mx-auto size-[46px]" : "size-6",
          active ? "bg-raised text-ink" : "text-ink-secondary hover:bg-raised/50 hover:text-ink",
        )}
      >
        <Inbox size={iconsOnly ? 20 : 16} aria-hidden="true" className={active ? "text-accent" : undefined} />
        {waiting > 0 && (
          <span
            data-testid="inbox-badge"
            aria-hidden="true"
            className={cn(
              "absolute flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-danger px-1 text-[9.5px] font-semibold leading-none tabular-nums text-white",
              iconsOnly ? "right-1.5 top-1.5" : "-right-1 -top-1",
            )}
          >
            {waiting > BADGE_MAX ? `${BADGE_MAX}+` : waiting}
          </span>
        )}
      </button>
    </div>
  );
}
