import { useState } from "react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { compact, limitFromDraft, money, useBotBudget, type BotBudget } from "@/state/bot-budget";
import type { Bot } from "@/state/store";

function status(budget: BotBudget): string | null {
  if (budget.exceeded) return t("people.owner.budget.exceeded");
  if (budget.warn) return t("people.owner.budget.warn");
  return budget.percent === null ? null : t("people.owner.budget.used", { percent: Math.round(budget.percent) });
}

/** The monthly limit of an agent, for the person it answers to: the limit and how much of it is used, never the money spent. */
export function OwnerBudget({ bot }: { bot: Pick<Bot, "id" | "name"> }) {
  const { budget, save } = useBotBudget(bot.id);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const percent = budget?.percent ?? null;
  const note = budget ? status(budget) : null;

  const commit = async (value: number | null) => {
    setBusy(true);
    setError(null);
    try {
      await save(value);
      setEditing(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-owner-budget="" className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13.5px] font-medium text-ink">
            {budget ? (budget.monthlyUsd === null ? t("people.owner.budget.noLimit") : t("people.owner.budget.limit", { limit: money(budget.monthlyUsd) })) : t("common.checking")}
          </div>
          {budget && note && (
            <div className={cn("mt-px text-[12.5px] leading-[1.35]", budget.exceeded ? "text-danger" : budget.warn ? "text-warning" : "text-ink-secondary")}>{note}</div>
          )}
        </div>
        {budget && (
          <button
            type="button"
            data-owner-budget-edit=""
            onClick={() => { setDraft(budget.monthlyUsd ? String(budget.monthlyUsd) : ""); setEditing((open) => !open); }}
            className="shrink-0 rounded-[8px] px-1.5 py-0.5 text-[12.5px] font-medium text-ink hover:bg-white/[0.06]"
          >
            {t("botSettings.simple.edit")}
          </button>
        )}
      </div>
      {percent !== null && (
        <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.08]" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.round(percent))}>
          <div className={cn("h-full rounded-full", budget?.exceeded ? "bg-danger" : budget?.warn ? "bg-warning" : "bg-accent")} style={{ width: `${Math.min(100, percent)}%` }} />
        </div>
      )}
      {budget && (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[11px] text-ink-tertiary">
          <span>{t("profile.budget.runs", { count: budget.runs })}</span>
          <span>{t("profile.budget.tokens", { count: compact(budget.input + budget.output) })}</span>
        </div>
      )}
      {editing && budget && (
        <form className="flex flex-wrap items-center gap-2" onSubmit={(event) => { event.preventDefault(); void commit(limitFromDraft(draft, budget.monthlyUsd)); }}>
          <span className="text-[12.5px] text-ink-secondary">US$</span>
          <input
            autoFocus
            inputMode="decimal"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={t("profile.budget.placeholder")}
            aria-label={t("profile.budget.limitAria", { name: bot.name })}
            className="w-24 rounded-[10px] border border-white/10 bg-white/[0.04] px-2 py-1 text-[13px] text-ink focus:border-focus focus:outline-none"
          />
          <button type="submit" disabled={busy} className="rounded-[10px] bg-accent px-2.5 py-1 text-[12.5px] font-medium text-white hover:brightness-110 disabled:opacity-50">{t("profile.budget.save")}</button>
          {budget.monthlyUsd !== null && (
            <button type="button" disabled={busy} onClick={() => void commit(null)} className="rounded-[10px] px-2 py-1 text-[12.5px] text-ink-secondary hover:text-ink disabled:opacity-50">
              {t("profile.budget.remove")}
            </button>
          )}
        </form>
      )}
      {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
    </div>
  );
}
