import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { accountBackPhrase } from "@/lib/account-person";
import { resetLabel, type AccountCardData, type AccountWindowView } from "@/lib/account-moves";

// Squared glass: corners stay at 3px, the fill is the settings card tone with a light blur and a hairline rim.
export const SQUARE_PANEL = "rounded-[3px] border border-hairline/50 bg-card/70";

function tone(used: number): string {
  if (used >= 100) return "bg-danger";
  if (used >= 85) return "bg-warning";
  return "bg-success";
}

function WindowLine({ label, view, now }: { label: string; view: AccountWindowView; now: number }) {
  const when = resetLabel(view.resetsAt, now);
  const back = view.used != null && view.used >= 100 ? accountBackPhrase(view.resetsAt, now) : null;
  return (
    <div className="grid grid-cols-[3.25rem_minmax(0,1fr)] items-start gap-x-2">
      <span className="text-[12px] text-ink-secondary">{label}</span>
      {view.used == null ? (
        <span className="text-[12px] text-ink-secondary">{t("accounts.card.notReported")}</span>
      ) : (
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2 text-[13px] text-ink">
            <span className="tabular-nums">{t("accounts.card.used", { percent: Math.round(view.used) })}</span>
            {when && <span className="text-[12px] text-ink-secondary">{back ?? t("accounts.card.resets", { when })}</span>}
          </div>
          <div
            className="mt-1 h-1.5 bg-inset"
            role="meter"
            aria-label={label}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(Math.min(100, Math.max(0, view.used)))}
          >
            <div className={cn("h-full", tone(view.used))} style={{ width: `${Math.min(100, Math.max(0, view.used))}%` }} />
          </div>
        </div>
      )}
    </div>
  );
}

export function robotCountLabel(count: number): string {
  return count === 1 ? t("accounts.card.robot", { count }) : t("accounts.card.robots", { count });
}

export function AccountLimitCards({
  cards,
  now,
  active,
  onPick,
}: {
  cards: AccountCardData[];
  now: number;
  active: string | null;
  onPick: (key: string | null) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {cards.map((card) => (
        <button
          key={card.key}
          type="button"
          data-account-card={card.key}
          aria-pressed={active === card.key}
          aria-label={t("accounts.card.filter", { account: card.label })}
          onClick={() => onPick(active === card.key ? null : card.key)}
          className={cn(
            SQUARE_PANEL,
            "flex min-h-[44px] w-full cursor-pointer flex-col gap-2 p-3 text-left transition-colors hover:bg-card",
            active === card.key && "border-accent",
          )}
        >
          <div className="flex min-w-0 items-baseline justify-between gap-2">
            <span className="truncate text-[14px] font-medium text-ink">{t("model.account")}: {card.label}</span>
            {card.plan && <span className="shrink-0 text-[12px] text-ink-secondary">{card.plan}</span>}
          </div>
          {card.alert && (
            <span
              data-account-alert={card.alert}
              className={cn(
                "w-fit rounded-[2px] px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.04em]",
                card.alert === "exhausted" ? "bg-danger/15 text-danger" : "bg-warning/15 text-warning",
              )}
            >
              {card.alert === "exhausted" ? t("accounts.alert.exhausted") : t("accounts.alert.nearEnd")}
            </span>
          )}
          {card.reading === "ok" ? (
            <div className="flex flex-col gap-2">
              <WindowLine label={t("accounts.card.week")} view={card.weekly} now={now} />
              <WindowLine label={t("accounts.card.fiveHour")} view={card.fiveHour} now={now} />
            </div>
          ) : (
            <p className="text-[12px] text-ink-secondary">{t("accounts.card.noReading")}</p>
          )}
          <span className="text-[12px] text-ink-secondary">{robotCountLabel(card.botCount)}</span>
        </button>
      ))}
    </div>
  );
}
