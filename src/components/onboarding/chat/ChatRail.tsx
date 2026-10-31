import { Check, Minus } from "lucide-react";
import { brand } from "@/lib/brand";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { RailRow } from "@/lib/onboarding-chat";

export function remainingText(left: number): string {
  if (left <= 0) return t("onboarding.chat.allDone");
  return left === 1 ? t("onboarding.chat.remainingOne") : t("onboarding.chat.remaining", { count: left });
}

export function ProgressBar({ share }: { share: number }) {
  const percent = Math.round(share * 100);
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-label={t("onboarding.chat.progress")}
      className="h-1.5 overflow-hidden rounded-full bg-control"
    >
      <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${percent}%` }} />
    </div>
  );
}

function Marker({ status }: { status: RailRow["status"] }) {
  if (status === "done") {
    return <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-success/15 text-success"><Check size={12} strokeWidth={3} aria-hidden="true" /></span>;
  }
  if (status === "skipped") {
    return <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-control text-ink-secondary"><Minus size={12} strokeWidth={3} aria-hidden="true" /></span>;
  }
  return (
    <span className={cn("flex size-5 shrink-0 items-center justify-center rounded-full border", status === "current" ? "border-accent" : "border-hairline/50")}>
      {status === "current" && <span className="size-2 rounded-full bg-accent" />}
    </span>
  );
}

export function ChatRail({ rows, left, share }: { rows: readonly RailRow[]; left: number; share: number }) {
  return (
    <aside className="glass-rail hidden w-[264px] shrink-0 flex-col gap-6 border-r border-hairline/40 p-6 sm:flex" aria-label={t("onboarding.chat.railLabel")}>
      <div>
        <p className="text-[15px] font-semibold text-ink">{brand().name}</p>
        <p className="mb-3 mt-1 text-[12.5px] text-ink-secondary" aria-live="polite">{remainingText(left)}</p>
        <ProgressBar share={share} />
      </div>
      <ol className="flex flex-col gap-1">
        {rows.map((row) => (
          <li
            key={row.id}
            aria-current={row.status === "current" ? "step" : undefined}
            className={cn("flex items-center gap-3 rounded-lg px-2 py-2", row.status === "current" && "bg-control/50")}
          >
            <Marker status={row.status} />
            <span className="min-w-0 flex-1">
              <span className={cn("block truncate text-[13px] font-medium", row.status === "upcoming" ? "text-ink-secondary" : "text-ink")}>{row.label}</span>
              {row.answer && <span className="block truncate text-[12px] text-ink-secondary">{row.answer}</span>}
            </span>
          </li>
        ))}
      </ol>
    </aside>
  );
}
