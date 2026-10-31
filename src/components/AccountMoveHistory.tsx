import { useState } from "react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { brasiliaStamp } from "@/lib/account-moves";
import { itemCounts, type MoveBatch, type MoveSelection } from "../../shared/account-moves";
import { SQUARE_PANEL } from "./AccountLimitCards";

const STATUS_KEYS = {
  pendente: "accounts.status.pendente",
  ok: "accounts.status.ok",
  falhou: "accounts.status.falhou",
  cancelado: "accounts.status.cancelado",
  expirado: "accounts.status.expirado",
  pulado: "accounts.status.pulado",
} as const;

function selectionLabel(selection: MoveSelection, labelOf: (instanceId: string) => string): string {
  return [labelOf(selection.instanceId), selection.model, selection.effort].filter(Boolean).join(" · ");
}

export function AccountMoveHistory({
  batches,
  labelOf,
  busyId,
  onUndo,
  onCancel,
}: {
  batches: MoveBatch[];
  labelOf: (instanceId: string) => string;
  busyId: string | null;
  onUndo: (id: string) => void;
  onCancel: (id: string) => void;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  if (batches.length === 0) return <p className="text-[13px] text-ink-secondary">{t("accounts.history.empty")}</p>;
  return (
    <ul className="flex flex-col gap-2">
      {batches.map((batch) => {
        const counts = itemCounts(batch.items);
        const failed = counts.falhou + counts.expirado;
        const expanded = open.has(batch.id);
        const canUndo = counts.ok > 0 && !batch.undoneBy;
        return (
          <li key={batch.id} data-move-batch={batch.id} className={cn(SQUARE_PANEL, "p-3")}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <span className="min-w-0 truncate text-[14px] font-medium text-ink">{batch.label}</span>
              <span className="text-[12px] tabular-nums text-ink-secondary">{brasiliaStamp(batch.createdAt)}</span>
            </div>
            <div className="mt-1 text-[12px] text-ink-secondary">
              {t("accounts.history.counts", { ok: counts.ok, pending: counts.pendente, failed })}
              {batch.undoneBy ? ` · ${t("accounts.history.undone")}` : ""}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                className="ui-button ui-button-sm min-h-9 rounded-[3px] sm:min-h-6"
                aria-expanded={expanded}
                onClick={() => setOpen((current) => {
                  const next = new Set(current);
                  if (!next.delete(batch.id)) next.add(batch.id);
                  return next;
                })}
              >
                {expanded ? t("accounts.history.hide") : t("accounts.history.show")}
              </button>
              <button
                type="button"
                className="ui-button ui-button-sm min-h-9 rounded-[3px] sm:min-h-6"
                disabled={!canUndo || busyId === batch.id}
                onClick={() => onUndo(batch.id)}
              >
                {t("accounts.history.undo")}
              </button>
              {counts.pendente > 0 && (
                <button
                  type="button"
                  className="ui-button ui-button-sm min-h-9 rounded-[3px] sm:min-h-6"
                  disabled={busyId === batch.id}
                  onClick={() => onCancel(batch.id)}
                >
                  {t("accounts.history.cancelPending")}
                </button>
              )}
            </div>
            {expanded && (
              <ul className="mt-3 flex flex-col gap-2 border-t border-hairline/30 pt-3">
                {batch.items.map((item) => (
                  <li key={item.botId} data-move-item={item.status} className="text-[12px]">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <span className="text-[13px] text-ink">{item.botName}</span>
                      <span className={cn("font-semibold uppercase tracking-[0.04em]", item.status === "falhou" || item.status === "expirado" ? "text-danger" : item.status === "ok" ? "text-success" : "text-ink-secondary")}>
                        {t(STATUS_KEYS[item.status])}
                      </span>
                    </div>
                    <div className="text-ink-secondary">
                      {selectionLabel(item.before, labelOf)} → {selectionLabel(item.target, labelOf)}
                    </div>
                    {item.message && <div className="text-ink-secondary">{item.message}</div>}
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}
