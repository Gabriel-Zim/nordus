import { t } from "@/lib/i18n";
import { durationText } from "@/lib/today";
import { formatCount, formatUsd } from "@/lib/board-text";
import type { MissionReceipt as Receipt } from "../../../shared/board";

const hasCost = (value: number | null | undefined): value is number => typeof value === "number";

export function MissionReceipt({ receipt }: { receipt: Receipt }) {
  const showCost = hasCost(receipt.total.costUsd) || receipt.agents.some((agent) => hasCost(agent.costUsd));
  const usage = (input: number, output: number) => formatCount(input + output);
  const breakdown = (input: number, output: number) => `${t("chat.usage.in", { tokens: formatCount(input) })} · ${t("chat.usage.out", { tokens: formatCount(output) })}`;
  const minutes = Math.max(1, Math.round((receipt.to - receipt.from) / 60_000));
  return (
    <section aria-labelledby="mission-receipt" data-mission-receipt="" className="mt-4 space-y-2 rounded-xl bg-card p-3.5">
      <div className="flex items-baseline justify-between gap-3">
        <h4 id="mission-receipt" className="text-[13px] font-semibold text-ink">{t("missions.receipt.title")}</h4>
        <span className="text-[11.5px] text-ink-secondary">{t("missions.receipt.took", { time: durationText(minutes) })}</span>
      </div>
      <table className="w-full border-collapse text-left text-[12.5px]">
        <thead>
          <tr className="text-ink-secondary">
            <th scope="col" className="py-1 pr-2 font-medium">{t("missions.receipt.agent")}</th>
            <th scope="col" className="px-2 py-1 text-right font-medium">{t("missions.receipt.turns")}</th>
            <th scope="col" title={t("missions.receipt.usageHint")} className="px-2 py-1 text-right font-medium">{t("missions.receipt.usage")}</th>
            {showCost && <th scope="col" className="py-1 pl-2 text-right font-medium">{t("missions.receipt.cost")}</th>}
          </tr>
        </thead>
        <tbody>
          {receipt.agents.map((agent) => (
            <tr key={agent.botId} data-receipt-agent={agent.botId} className="border-t border-hairline/40">
              <th scope="row" className="py-1.5 pr-2 font-medium text-ink">{agent.name}</th>
              <td className="px-2 py-1.5 text-right tabular-nums">{formatCount(agent.turns)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums" title={breakdown(agent.input, agent.output)}>{usage(agent.input, agent.output)}</td>
              {showCost && <td className="py-1.5 pl-2 text-right tabular-nums">{hasCost(agent.costUsd) ? formatUsd(agent.costUsd) : ""}</td>}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr data-receipt-total="" className="border-t border-hairline font-semibold text-ink">
            <th scope="row" className="py-1.5 pr-2">{t("missions.receipt.total")}</th>
            <td className="px-2 py-1.5 text-right tabular-nums">{formatCount(receipt.total.turns)}</td>
            <td className="px-2 py-1.5 text-right tabular-nums" title={breakdown(receipt.total.input, receipt.total.output)}>{usage(receipt.total.input, receipt.total.output)}</td>
            {showCost && <td className="py-1.5 pl-2 text-right tabular-nums">{hasCost(receipt.total.costUsd) ? formatUsd(receipt.total.costUsd) : ""}</td>}
          </tr>
        </tfoot>
      </table>
    </section>
  );
}
