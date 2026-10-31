import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";

import { api } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { plainErrorLine } from "@/lib/plain-error";
import type { LocaleKey } from "@/locales";
import type { DoctorCheck, DoctorGroup, DoctorReport, DoctorStatus } from "../../shared/doctor";
import { Card } from "./SettingsPrimitives";

const DOCTOR_TIMEOUT_MS = 60_000;

const GROUPS: ReadonlyArray<{ id: DoctorGroup; labelKey: LocaleKey }> = [
  { id: "engines", labelKey: "health.group.engines" },
  { id: "network", labelKey: "health.group.network" },
  { id: "disk", labelKey: "health.group.disk" },
  { id: "tools", labelKey: "health.group.tools" },
  { id: "databases", labelKey: "health.group.databases" },
];

const STATUS: Record<DoctorStatus, { labelKey: LocaleKey; dot: string; text: string }> = {
  ok: { labelKey: "health.status.ok", dot: "bg-success", text: "text-success" },
  warn: { labelKey: "health.status.warn", dot: "bg-warning", text: "text-warning" },
  fail: { labelKey: "health.status.fail", dot: "bg-danger", text: "text-danger" },
};

export function healthSummary(report: DoctorReport): string {
  const fail = report.counts.fail;
  const warn = report.counts.warn;
  const fails = fail === 1 ? t("health.summary.failOne") : t("health.summary.failMany", { count: fail });
  const warns = warn === 1 ? t("health.summary.warnOne") : t("health.summary.warnMany", { count: warn });
  if (fail > 0 && warn > 0) return t("health.summary.both", { fails, warns });
  if (fail > 0) return fails;
  if (warn > 0) return warns;
  return t("health.summary.ok");
}

export function HealthCheckRow({ check }: { check: DoctorCheck }) {
  const status = STATUS[check.status];
  return (
    <li className="border-b border-hairline/20 py-2.5 last:border-b-0" data-health-check={check.id} data-health-status={check.status}>
      <div className="flex items-start gap-3">
        <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", status.dot)} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-[13.5px] font-medium text-ink">{check.label}</span>
            <span className={cn("text-[12px] font-medium", status.text)}>{t(status.labelKey)}</span>
          </div>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-secondary">{check.detail}</p>
          {check.fix && <p className="mt-1 text-[12.5px] leading-relaxed text-ink">{t("health.fix", { fix: check.fix })}</p>}
          {check.technical && (
            <details className="mt-1.5">
              <summary className="cursor-pointer text-[12px] text-ink-secondary hover:text-ink">{t("health.details")}</summary>
              <pre className="mt-1 whitespace-pre-wrap break-words rounded-lg bg-inset p-2 font-mono text-[11.5px] text-ink-secondary">{check.technical}</pre>
            </details>
          )}
        </div>
      </div>
    </li>
  );
}

export function HealthReport({ report }: { report: DoctorReport }) {
  return (
    <div className="flex flex-col gap-4">
      <p role="status" data-health-summary={report.status} className={cn("flex items-center gap-2 text-[14px] font-medium", STATUS[report.status].text)}>
        <span className={cn("size-2.5 rounded-full", STATUS[report.status].dot)} aria-hidden="true" />
        {healthSummary(report)}
      </p>
      {GROUPS.map((group) => {
        const checks = report.checks.filter((check) => check.group === group.id);
        if (checks.length === 0) return null;
        return (
          <section key={group.id} data-health-group={group.id} aria-label={t(group.labelKey)}>
            <h4 className="text-[11.5px] font-medium uppercase tracking-wide text-ink-secondary">{t(group.labelKey)}</h4>
            <ul className="mt-1 flex flex-col">
              {checks.map((check) => <HealthCheckRow key={check.id} check={check} />)}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

export function HealthSection() {
  const [report, setReport] = useState<DoctorReport | null>(null);
  const [running, setRunning] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const run = useCallback(async (refresh: boolean) => {
    setRunning(true);
    setError(null);
    try {
      const body = await api<DoctorReport>(refresh ? "/api/doctor?refresh=1" : "/api/doctor", { timeoutMs: DOCTOR_TIMEOUT_MS });
      if (alive.current) setReport(body);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      if (alive.current) setError(plainErrorLine(message) ?? message);
    } finally {
      if (alive.current) setRunning(false);
    }
  }, []);

  useEffect(() => { void run(false); }, [run]);

  return (
    <Card title={t("health.title")} subtitle={t("health.subtitle")}>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => void run(true)} disabled={running} aria-busy={running || undefined} className="ui-button" data-health-refresh>
          {running ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <RefreshCw size={13} aria-hidden="true" />}
          {running ? t("health.refreshing") : t("health.refresh")}
        </button>
        {report && !running && (
          <span className="text-[12px] text-ink-secondary">{t("health.checkedAt", { time: new Date(report.startedAt).toLocaleString() })}</span>
        )}
      </div>
      {running && !report && <p className="mt-4 text-[13px] text-ink-secondary">{t("health.running")}</p>}
      {error && <p role="alert" className="mt-4 text-[12.5px] text-danger">{t("health.error", { reason: error })}</p>}
      {report && <div className={cn("mt-4", running && "opacity-60")}><HealthReport report={report} /></div>}
    </Card>
  );
}
