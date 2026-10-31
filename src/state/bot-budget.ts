import { useEffect, useState } from "react";

import { visibleInterval } from "@/lib/visible-interval";
import { api } from "./api";

export interface BotBudget {
  month: string;
  /** Left out of the answer for the person an agent answers to: they see the limit and its use, never the money spent. */
  spentUsd?: number;
  runs: number;
  input: number;
  output: number;
  monthlyUsd: number | null;
  warnAtPercent: number;
  percent: number | null;
  warn: boolean;
  exceeded: boolean;
}

export function useBotBudget(botId: string) {
  const [budget, setBudget] = useState<BotBudget | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => void api<BotBudget>(`/api/bots/${botId}/budget`).then((next) => { if (alive) setBudget(next); }).catch(() => undefined);
    load();
    const stop = visibleInterval(load, 30_000);
    return () => { alive = false; stop(); };
  }, [botId]);
  const save = async (monthlyUsd: number | null) => {
    setBudget(await api<BotBudget>(`/api/bots/${botId}/budget`, { method: "PUT", body: JSON.stringify({ monthlyUsd }) }));
  };
  return { budget, save };
}

export function money(value: number): string {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: value < 1 ? 3 : 2 }).format(value);
}

export function compact(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

/** What a limit typed in the box means: empty removes it, a positive number sets it, anything else keeps the one saved. */
export function limitFromDraft(draft: string, current: number | null): number | null {
  if (draft.trim() === "") return null;
  const value = Number(draft.trim().replace(",", "."));
  return Number.isFinite(value) && value > 0 ? value : current;
}
