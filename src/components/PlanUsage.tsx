import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { api, StoreContext } from "@/state/store";
import { botUsage, formatUsd, hasFiniteCost, paysPerUse } from "@/lib/usage";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { Card } from "./SettingsPrimitives";

export interface PlanWindow {
  available: boolean;
  remainingPercent: number | null;
  usedPercent: number | null;
  resetsAt: string | null;
}

interface PlanExtra {
  label: string;
  remainingPercent: number;
  usedPercent: number;
  resetsAt: string | null;
}

interface PlanModelUsage {
  name: string;
  windows: PlanExtra[];
}

export interface PlanProvider {
  id: string;
  name: string;
  driver: string;
  plan: string | null;
  ok: boolean;
  error: string | null;
  fiveHour: PlanWindow;
  weekly: PlanWindow;
  extra: PlanExtra[];
  models?: PlanModelUsage[];
}

export interface PlanUsageReport {
  fetchedAt: string;
  providers: PlanProvider[];
}

export function formatResetDistance(resetsAt: string | null, now: number): string | null {
  if (!resetsAt) return null;
  const at = Date.parse(resetsAt);
  if (!Number.isFinite(at) || at <= now) return null;
  const minutes = Math.floor((at - now) / 60_000);
  if (minutes < 1) return t("planUsage.underMinute");
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  return `${mins}m`;
}

/** The plan percentage at which a subscription agent shows "near the plan limit". */
export const PLAN_WARN_PERCENT = 80;

let sharedReport: { at: number; promise: Promise<PlanUsageReport> } | null = null;

/** One plan-usage read shared by every agent profile on screen, refreshed at most once a minute. */
export function usePlanUsageReport(): PlanUsageReport | null {
  const [report, setReport] = useState<PlanUsageReport | null>(null);
  useEffect(() => {
    let alive = true;
    if (!sharedReport || Date.now() - sharedReport.at > 60_000) {
      sharedReport = { at: Date.now(), promise: api<PlanUsageReport>("/api/plan-usage") };
      sharedReport.promise.catch(() => { sharedReport = null; });
    }
    sharedReport.promise.then((next) => { if (alive) setReport(next); }).catch(() => undefined);
    return () => { alive = false; };
  }, []);
  return report;
}

/** The busiest plan window at or past the warning line, if any. */
export function planNearLimit(provider: PlanProvider): { label: string; used: number; resetsAt: string | null } | null {
  const windows = [
    { label: t("planUsage.fiveHour"), window: provider.fiveHour },
    { label: t("planUsage.weekly"), window: provider.weekly },
  ].filter((entry) => entry.window.available && (entry.window.usedPercent ?? 0) >= PLAN_WARN_PERCENT);
  windows.sort((a, b) => (b.window.usedPercent ?? 0) - (a.window.usedPercent ?? 0));
  const top = windows[0];
  return top ? { label: top.label, used: Math.round(top.window.usedPercent ?? 0), resetsAt: top.window.resetsAt } : null;
}

function dueResetDeadlines(report: PlanUsageReport, now: number, seen: Set<string>): string[] {
  const due: string[] = [];
  for (const provider of report.providers) {
    if (!provider.ok) continue;
    const stamps = [
      provider.fiveHour.available ? provider.fiveHour.resetsAt : null,
      provider.weekly.available ? provider.weekly.resetsAt : null,
      ...provider.extra.map((extra) => extra.resetsAt),
      ...(provider.models ?? []).flatMap((model) => model.windows.map((entry) => entry.resetsAt)),
    ];
    for (const resetsAt of stamps) {
      if (!resetsAt || seen.has(resetsAt) || due.includes(resetsAt)) continue;
      const at = Date.parse(resetsAt);
      if (Number.isFinite(at) && at <= now) due.push(resetsAt);
    }
  }
  return due;
}

function usageTone(used: number): string {
  if (used >= 90) return "bg-danger";
  if (used >= 70) return "bg-warning";
  return "bg-success";
}

/** Connected accounts show the company, not the default engine label. */
export function accountName(provider: PlanProvider): string {
  if (provider.driver === "claude") return provider.name.replace(/^Claude\b/, "Anthropic");
  return provider.name;
}

/** The company name for a connected account, or the translated plan name where there is one. */
function accountLabel(provider: PlanProvider): string {
  const label = providerLabel(provider);
  return label === provider.name ? accountName(provider) : label;
}

function providerLabel(provider: Pick<PlanProvider, "name">): string {
  const normalized = provider.name.trim().toLowerCase();
  if (normalized === "chatgpt plan") return t("planUsage.provider.chatgptPlan");
  if (normalized === "claude (api key)") return t("planUsage.provider.claudeApiKey");
  return provider.name;
}

function WindowRow({
  label,
  window,
  now,
  usedHeadline = false,
}: {
  label: string;
  window: PlanWindow;
  now: number;
  usedHeadline?: boolean;
}) {
  const when = window.available ? formatResetDistance(window.resetsAt, now) : null;
  const used = window.usedPercent ?? 0;
  const headline = usedHeadline
    ? window.usedPercent == null ? null : t("planUsage.used", { used: Math.round(window.usedPercent) })
    : window.remainingPercent == null ? null : t("planUsage.left", { remaining: Math.round(window.remainingPercent) });
  return (
    <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1">
      <div className="text-[12px] text-ink-secondary">{label}</div>
      {window.available && headline ? (
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2 text-[13px] text-ink">
            <span className="tabular-nums">{headline}</span>
            {when && <span className="text-[12px] text-ink-secondary">{t("planUsage.resetsIn", { when })}</span>}
          </div>
          <div
            className="mt-1 h-1.5 overflow-hidden rounded-full bg-inset"
            role="meter"
            aria-label={label}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(Math.min(100, Math.max(0, used)))}
          >
            <div className={cn("h-full rounded-full", usageTone(used))} style={{ width: `${Math.min(100, Math.max(0, used))}%` }} />
          </div>
        </div>
      ) : (
        <div className="text-[12px] text-ink-secondary">{t("planUsage.notReported")}</div>
      )}
    </div>
  );
}

export function PlanUsage() {
  const state = useContext(StoreContext)?.state;
  const meteredSpend = (instanceId: string): number | null => {
    const costs = (state?.bots ?? [])
      .filter((bot) => bot.modelSelection.instanceId === instanceId)
      .map((bot) => botUsage(bot).costUsd)
      .filter(hasFiniteCost);
    return costs.length ? costs.reduce((sum, cost) => sum + cost, 0) : null;
  };
  const apiKey = (instanceId: string) => paysPerUse(state?.instances.find((instance) => instance.instanceId === instanceId));
  const [report, setReport] = useState<PlanUsageReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const refreshedDeadlines = useRef(new Set<string>());

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    setError("");
    try {
      const data = await api<PlanUsageReport>(refresh ? "/api/plan-usage?refresh=1" : "/api/plan-usage");
      setReport(data);
      setNow(Date.now());
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : t("planUsage.fetchError"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!report) return;
    const due = dueResetDeadlines(report, now, refreshedDeadlines.current);
    if (due.length === 0) return;
    for (const deadline of due) refreshedDeadlines.current.add(deadline);
    void load(true);
  }, [report, now, load]);

  return (
    <Card title={t("planUsage.title")} subtitle={t("planUsage.subtitle")}>
      <div className="mb-3 flex justify-end">
        <button
          type="button"
          onClick={() => void load(true)}
          disabled={loading}
          aria-label={t("planUsage.refresh")}
          title={t("planUsage.refresh")}
          className="rounded-md p-2 text-ink-secondary hover:bg-control hover:text-ink disabled:opacity-50"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
        </button>
      </div>
      {loading && !report && <p role="status" className="text-[13px] text-ink-secondary">{t("planUsage.loading")}</p>}
      {error && <p role="alert" className="mb-3 text-[13px] text-danger">{error}</p>}
      {report && report.providers.length === 0 && (
        <p className="text-[13px] text-ink-secondary">{t("planUsage.empty")}</p>
      )}
      {report && report.providers.length > 0 && (
        <div className="flex flex-col gap-4">
          {report.providers.map((provider) => (
            <div key={provider.id} className="border-t border-hairline/30 pt-3 first:border-t-0 first:pt-0">
              <div className="mb-2 flex min-w-0 items-baseline gap-2">
                <span className="truncate text-[14px] font-medium text-ink">{accountLabel(provider)}</span>
                {provider.plan && <span className="truncate text-[12px] text-ink-secondary">{provider.plan}</span>}
              </div>
              {apiKey(provider.id) ? (
                <p data-api-key-spend="" className="text-[13px] text-ink-secondary">
                  {(() => {
                    const spent = meteredSpend(provider.id);
                    return spent !== null ? t("planUsage.apiKeySpent", { spent: formatUsd(spent) }) : t("planUsage.apiKey");
                  })()}
                </p>
              ) : provider.ok ? (
                <div className="flex flex-col gap-2">
                  <WindowRow label={t("planUsage.fiveHour")} window={provider.fiveHour} now={now} />
                  <WindowRow label={t("planUsage.weekly")} window={provider.weekly} now={now} />
                </div>
              ) : (
                <p className="text-[13px] text-ink-secondary">{t("planUsage.signInAgain")}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
