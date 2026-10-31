// Security: the key is write-only; the server reports configured-or-not, never the value.
import { useEffect, useState } from "react";
import { Check, ExternalLink, Loader2 } from "lucide-react";
import { api, useStore, type ConfigStatus } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { Card, SettingRow, Switch } from "./SettingsPrimitives";
import { Select } from "./Select";
import { DECIDER_JOBS, type DeciderJob } from "../../shared/decider-jobs";

const KEY_URL = { jev: "https://typesafe.ai", openrouter: "https://openrouter.ai/keys" } as const;
/** The room decision budget in server/decider/room-routing.ts; slower falls back to the lead. */
const ROOM_BUDGET_MS = 1_500;

type Provider = "jev" | "openrouter";
type ModelList = { source: "openrouter" | "builtin"; models: Array<{ id: string; name: string; group: "recommended" | "more"; api?: "chat" | "decisions" }> };
type TestResult = { ok: true; latencyMs: number } | { ok: false; reason: string; status?: number };

const FAILURES: Record<string, LocaleKey> = {
  rejected: "decider.error.rejected",
  unreachable: "decider.error.unreachable",
  timeout: "decider.error.timeout",
  rate_limited: "decider.error.rateLimited",
  overloaded: "decider.error.overloaded",
  malformed: "decider.error.malformed",
  no_key: "decider.error.noKey",
  misconfigured: "decider.error.misconfigured",
};

/** Cloud Pro's relay refuses an inactive subscription (402) and a used-up month of decisions (429). */
const INCLUDED_FAILURES: Record<string, LocaleKey> = {
  rejected: "decider.included.error.rejected",
  rate_limited: "decider.included.error.limited",
};

const OPENROUTER_FAILURES: Record<string, LocaleKey> = {
  ...FAILURES,
  rejected: "decider.openrouter.error.rejected",
  unreachable: "decider.openrouter.error.unreachable",
  timeout: "decider.openrouter.error.timeout",
  rate_limited: "decider.openrouter.error.rateLimited",
  overloaded: "decider.openrouter.error.overloaded",
  malformed: "decider.openrouter.error.malformed",
};

/** A fixed sentence per failure: the vendor's own body never reaches the UI. */
export function deciderFailureText(result: { reason: string; status?: number }, included = false, provider: Provider = "jev"): string {
  if (provider === "openrouter") {
    // 402 is OpenRouter's answer for an account with no credits left.
    if (result.reason === "http_error" && result.status === 402) return t("decider.openrouter.error.credits");
    if (result.reason === "http_error") return t("decider.openrouter.error.http", { status: String(result.status ?? "?") });
    const key = OPENROUTER_FAILURES[result.reason];
    return key ? t(key) : t("decider.error.other");
  }
  if (included && result.reason === "http_error" && result.status === 402) return t("decider.included.error.subscription");
  if (included && INCLUDED_FAILURES[result.reason]) return t(INCLUDED_FAILURES[result.reason]!);
  if (result.reason === "http_error") return t("decider.error.http", { status: String(result.status ?? "?") });
  const key = FAILURES[result.reason];
  return key ? t(key) : t("decider.error.other");
}

const COMING_SOON: LocaleKey[] = ["decider.jobs.browserClicks"];

export function DecisionModelSettings() {
  const { state, dispatch } = useStore();
  const decider = state.config?.decider;
  const provider: Provider = decider?.provider === "openrouter" ? "openrouter" : "jev";
  const openrouter = provider === "openrouter";
  const configured = decider?.configured ?? false;
  const included = configured && decider?.included === true;
  const usingShared = openrouter && configured && decider?.keySource === "shared";
  const sharedKey = openrouter && decider?.sharedKey === true;
  const ownKey = configured && !included && !usingShared;
  const enabled = decider?.enabled ?? false;
  const jobOn = (job: DeciderJob) => decider?.jobs[job] ?? true;
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<{ ok: boolean; text: string } | null>(null);
  const [models, setModels] = useState<ModelList | null>(null);
  const draft = value.trim();
  const clearing = !draft && ownKey;
  const keyHint: LocaleKey | null = !openrouter || included
    ? null
    : usingShared
      ? "decider.openrouter.status.sharedHint"
      : !configured
        ? "decider.openrouter.status.notConnectedHint"
        : sharedKey
          ? "decider.openrouter.status.ownFallbackHint"
          : null;

  const applied = (config: ConfigStatus) => dispatch({ type: "configStatus", config });

  const patch = async (decision: Record<string, unknown>) => {
    if (switching) return;
    setSwitching(true);
    setError(null);
    try {
      applied(await api<ConfigStatus>("/api/config", { method: "PUT", body: JSON.stringify({ decider: decision }) }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSwitching(false);
    }
  };

  useEffect(() => {
    if (!openrouter || models) return;
    let cancelled = false;
    api<ModelList>("/api/decider/models").then(
      (list) => { if (!cancelled) setModels(list); },
      () => undefined,
    );
    return () => { cancelled = true; };
  }, [openrouter, models]);

  const choose = (decision: { provider: Provider } | { openrouterModel: string; openrouterApi: "chat" | "decisions" }) => {
    setValue("");
    setVerdict(null);
    void patch(decision);
  };

  const save = async () => {
    if (saving || (!draft && !ownKey)) return;
    setSaving(true);
    setError(null);
    setVerdict(null);
    try {
      const status = window.ogb?.setCredential
        ? await window.ogb.setCredential(openrouter ? "openrouterDeciderKey" : "jevApiKey", draft)
        : await api<ConfigStatus>("/api/config", { method: "PUT", body: JSON.stringify({ decider: { [openrouter ? "openrouterKey" : "key"]: draft } }) });
      applied(status);
      setValue("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    if (testing || saving || (!draft && !configured)) return;
    setTesting(true);
    setVerdict(null);
    setError(null);
    const testingIncluded = !draft && included;
    const testingShared = !draft && usingShared;
    try {
      const result = await api<TestResult>("/api/decider/test", { method: "POST", body: JSON.stringify(draft ? { key: draft } : {}) });
      setVerdict(result.ok
        ? {
          ok: true,
          text: openrouter
            ? [
              t(testingShared ? "decider.openrouter.test.okShared" : "decider.openrouter.test.ok", { ms: String(result.latencyMs) }),
              ...(result.latencyMs > ROOM_BUDGET_MS ? [t("decider.test.slow")] : []),
            ].join(" ")
            : t("decider.test.ok", { ms: String(result.latencyMs) }),
        }
        : { ok: false, text: deciderFailureText(result, testingIncluded, provider) });
    } catch (cause) {
      setVerdict({ ok: false, text: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      setTesting(false);
    }
  };

  return (
    <>
      <section className="space-y-2 px-4">
        <p className="text-[13px] leading-relaxed text-ink-secondary">{t("decider.intro")}</p>
      </section>
      <SettingRow title={t("decider.provider.label")}>
        <Select className="w-48"
          data-testid="decider-provider"
          value={provider}
          onChange={(event) => choose({ provider: event.target.value === "openrouter" ? "openrouter" : "jev" })}
          disabled={switching || !state.config}
          aria-label={t("decider.provider.label")}
        >
          <option value="jev">{t("decider.provider.jev")}</option>
          <option value="openrouter">{t("decider.provider.openrouter")}</option>
        </Select>
      </SettingRow>
      {openrouter && (
        <SettingRow title={t("decider.model.label")} subtitle={models?.source === "builtin" ? t("decider.model.builtinNote") : undefined}>
          <Select className="w-64 max-w-full"
            data-testid="decider-model"
            value={decider?.model ?? ""}
            onChange={(event) => choose({
              openrouterModel: event.target.value,
              openrouterApi: models?.models.find((model) => model.id === event.target.value)?.api ?? "chat",
            })}
            disabled={switching}
            aria-label={t("decider.model.label")}
          >
            {decider?.model && !models?.models.some((model) => model.id === decider.model) && (
              <option value={decider.model}>{decider.model}</option>
            )}
            {(["recommended", "more"] as const).map((group) => {
              const inGroup = models?.models.filter((model) => model.group === group) ?? [];
              return inGroup.length > 0 && (
                <optgroup key={group} label={t(group === "recommended" ? "decider.model.recommended" : "decider.model.more")}>
                  {inGroup.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
                </optgroup>
              );
            })}
          </Select>
        </SettingRow>
      )}
      <SettingRow
        title={t(openrouter ? "decider.openrouter.master" : "decider.master")}
        subtitle={configured ? undefined : t(openrouter ? "decider.masterNeedsKey.openrouter" : "decider.masterNeedsKey")}
      >
        <Switch
          data-testid="decider-master"
          aria-label={t(openrouter ? "decider.openrouter.master" : "decider.master")}
          checked={enabled}
          disabled={!configured || switching || !state.config}
          onClick={() => void patch({ enabled: !enabled })}
          className="cursor-pointer"
        />
      </SettingRow>

      <Card title={t(openrouter ? "decider.openrouter.key.label" : "decider.key.label")}>
        <div role="status" className="mb-2 flex items-center gap-2 text-[13px] text-ink-secondary">
          <span className={cn("size-1.5 rounded-full", configured ? "bg-success" : "bg-raised-hover")} />
          <span className={configured ? "text-success" : undefined}>
            {included
              ? t("keys.includedWithCloudPro")
              : usingShared
                ? t("decider.openrouter.status.shared")
                : configured
                  ? t(sharedKey ? "decider.openrouter.status.own" : "decider.status.connected")
                  : t("decider.status.notConnected")}
          </span>
        </div>
        {keyHint && (
          <p className="mb-2 text-[12px] leading-relaxed text-ink-secondary">
            {t(keyHint)}
            {!ownKey && (
              <>
                {" "}
                <button
                  type="button"
                  data-testid="decider-manage-keys"
                  onClick={() => dispatch({ type: "toggleAppSettings", open: true, section: "connections" })}
                  className="cursor-pointer text-accent hover:underline"
                >
                  {t("decider.openrouter.key.manageLink")}
                </button>
              </>
            )}
          </p>
        )}
        <div className="flex gap-2">
          <input
            type="password"
            value={value}
            onChange={(event) => { setVerdict(null); setError(null); setValue(event.target.value); }}
            onKeyDown={(event) => event.key === "Enter" && void save()}
            disabled={saving}
            placeholder={ownKey ? t("keys.replace") : t(usingShared ? "decider.openrouter.key.overridePlaceholder" : openrouter ? "decider.openrouter.key.placeholder" : "decider.key.placeholder")}
            aria-label={t(openrouter ? "decider.openrouter.key.label" : "decider.key.label")}
            autoComplete="off"
            spellCheck={false}
            className="w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[13px] text-ink placeholder:text-ink-secondary focus:outline-none"
          />
          <button
            type="button"
            data-testid="decider-save"
            onClick={() => void save()}
            disabled={saving || (!draft && !ownKey)}
            title={clearing ? t("keys.removeKey") : t("common.save")}
            className={cn(
              "flex w-[72px] shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-control py-2 text-[13px] hover:bg-raised-hover disabled:cursor-not-allowed disabled:opacity-50",
              clearing ? "text-danger" : "text-ink",
            )}
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : clearing ? t("keys.clear") : <><Check size={13} />{t("common.save")}</>}
          </button>
          <button
            type="button"
            data-testid="decider-test"
            onClick={() => void test()}
            disabled={testing || saving || (!draft && !configured)}
            className="flex shrink-0 cursor-pointer items-center justify-center rounded-lg border border-hairline/40 px-3 py-2 text-[13px] text-ink-secondary hover:bg-raised/50 hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
          >
            {testing ? t("keys.testing") : t("keys.test")}
          </button>
        </div>
        {error && <p role="alert" className="mt-1 text-[12px] text-danger">{error}</p>}
        {verdict && <p role="status" className={cn("mt-1 text-[12px]", verdict.ok ? "text-success" : "text-danger")}>{verdict.text}</p>}
        {!usingShared && (
          <a
            href={KEY_URL[provider]}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex cursor-pointer items-center gap-1 text-[12px] text-accent hover:underline"
          >
            {t(openrouter ? "decider.openrouter.key.getKey" : "decider.key.getKey")}
            <ExternalLink size={11} aria-hidden="true" />
          </a>
        )}
      </Card>

      <Card title={t("decider.jobs.title")}>
        <ul className="flex flex-col">
          {DECIDER_JOBS.map((job, index) => (
            <li key={job} className={cn("flex items-start justify-between gap-4 py-2", index > 0 && "border-t border-hairline/40")}>
              <div className="min-w-0">
                <div className="text-[13px] font-medium text-ink">{t(`decider.jobs.${job}`)}</div>
                <div className="mt-0.5 text-[12px] leading-relaxed text-ink-secondary">{t(`decider.jobs.${job}Detail`)}</div>
              </div>
              <Switch
                data-testid={`decider-job-${job}`}
                aria-label={t(`decider.jobs.${job}`)}
                checked={enabled && jobOn(job)}
                disabled={!enabled || switching}
                onClick={() => void patch({ jobs: { [job]: !jobOn(job) } })}
                className="cursor-pointer"
              />
            </li>
          ))}
          {COMING_SOON.map((label) => (
            <li key={label} data-testid="decider-coming-soon" aria-disabled="true" className="flex items-center justify-between gap-4 border-t border-hairline/40 py-2 opacity-50">
              <span className="text-[13px] text-ink-secondary">{t(label)}</span>
              <span className="rounded bg-control px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-secondary">
                {t("decider.jobs.comingSoon")}
              </span>
            </li>
          ))}
        </ul>
      </Card>
      {configured && enabled && jobOn("criticalCheck") && (
        <JevApprovesCard limits={decider?.autoApprove ?? { creditsPerTask: 5, creditsPerDay: 20 }} disabled={switching} onSave={(autoApprove) => void patch({ autoApprove })} />
      )}
      {configured && <DecisionLog />}
    </>
  );
}

const ALWAYS_ASK_KEYS = [
  "decider.approve.always.payment", "decider.approve.always.delete", "decider.approve.always.security",
  "decider.approve.always.unapproved", "decider.approve.always.newContact", "decider.approve.always.outside",
] as const satisfies readonly LocaleKey[];

/** Jev aprova por você: the credit limits (editable) and what always asks (read-only). */
function JevApprovesCard({ limits, disabled, onSave }: {
  limits: { creditsPerTask: number; creditsPerDay: number };
  disabled: boolean;
  onSave: (limits: { creditsPerTask: number; creditsPerDay: number }) => void;
}) {
  const field = (key: "creditsPerTask" | "creditsPerDay", label: LocaleKey) => (
    <label className="flex items-center justify-between gap-4 py-1.5 text-[13px] text-ink">
      <span>{t(label)}</span>
      <input
        type="number"
        min={0}
        max={key === "creditsPerTask" ? 1_000 : 10_000}
        defaultValue={limits[key]}
        disabled={disabled}
        data-testid={`decider-approve-${key}`}
        onBlur={(event) => {
          const value = Number(event.currentTarget.value);
          if (Number.isInteger(value) && value >= 0 && value !== limits[key]) onSave({ ...limits, [key]: value });
        }}
        className="w-20 rounded-lg border border-hairline/40 bg-inset px-2 py-1 text-right text-[13px] tabular-nums text-ink focus:outline-none"
      />
    </label>
  );
  return (
    <Card title={t("decider.approve.title")}>
      <p className="mb-2 text-[12px] leading-relaxed text-ink-secondary">{t("decider.approve.help")}</p>
      {field("creditsPerTask", "decider.approve.perTask")}
      {field("creditsPerDay", "decider.approve.perDay")}
      <div className="mt-3 text-[12.5px] font-medium text-ink">{t("decider.approve.alwaysTitle")}</div>
      <ul data-testid="decider-approve-always" className="mt-1 list-disc pl-5 text-[12px] leading-relaxed text-ink-secondary">
        {ALWAYS_ASK_KEYS.map((key) => <li key={key}>{t(key)}</li>)}
      </ul>
    </Card>
  );
}

type LogRow = { at: string; seam: string; ok: boolean; reason?: string; choice?: string; pTop: number | null; latencyMs: number };
const SPECIAL_CHOICES: Record<string, LocaleKey> = {
  __everyone__: "decider.log.everyone",
  __nobody__: "decider.log.nobody",
  __boss__: "decider.log.boss",
  __none__: "decider.log.none",
  urgent: "decider.log.urgent",
  normal: "decider.log.normal",
  noise: "decider.log.noise",
  important: "decider.log.important",
  newsletter: "decider.log.newsletter",
  spam: "decider.log.spam",
  bot: "decider.log.bot",
};

/** Registros: the latest decisions, newest first, in plain words. */
function DecisionLog() {
  const { state } = useStore();
  const [rows, setRows] = useState<LogRow[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    Promise.resolve(api<{ rows: LogRow[] }>("/api/decider/log")).then(
      (body) => { if (!cancelled && body && Array.isArray(body.rows)) setRows(body.rows.slice(0, 50)); },
      () => undefined,
    );
    return () => { cancelled = true; };
  }, []);
  const bots = (state as { bots?: Array<{ id: string; name: string }> }).bots ?? [];
  const label = (row: LogRow) => {
    if (!row.ok) return t("decider.log.failed");
    if (!row.choice) return t("decider.log.answered");
    const level = /^level:(\d)$/.exec(row.choice);
    if (level) return t((["decider.log.light", "decider.log.medium", "decider.log.heavy"] as const)[Number(level[1])] ?? "decider.log.answered");
    if (row.choice === "ack" || row.choice.startsWith("ack:")) return t("decider.log.ack");
    const lane = /^lane:(continue|queue|parallel)$/.exec(row.choice);
    if (lane) return t(lane[1] === "continue" ? "decider.log.laneContinue" : lane[1] === "queue" ? "decider.log.laneQueue" : "decider.log.laneParallel");
    if (row.choice === "approved:lesson") return t("decider.log.lessonSaved");
    const approved = /^approved:(\w+)$/.exec(row.choice);
    if (approved) return t("decider.log.approved", { what: t(`decider.approve.kind.${approved[1]}` as LocaleKey) });
    const asked = /^asked:([\w-]+)$/.exec(row.choice);
    if (asked) return t("decider.log.asked", { why: t(`decider.approve.why.${asked[1]}` as LocaleKey) });
    const ceiling = /^ceiling:(\d+)$/.exec(row.choice);
    if (ceiling) return t("decider.log.ceiling", { minutes: ceiling[1]! });
    const special = SPECIAL_CHOICES[row.choice];
    if (special) return t(special);
    return bots.find((bot) => bot.id === row.choice)?.name ?? row.choice;
  };
  const jobName = (seam: string) => (DECIDER_JOBS as readonly string[]).includes(seam) ? t(`decider.jobs.${seam as DeciderJob}`) : t("decider.log.check");
  return (
    <Card title={t("decider.log.title")}>
      {!rows?.length ? (
        <p className="text-[12px] text-ink-secondary">{t("decider.log.empty")}</p>
      ) : (
        <ul data-testid="decider-log" className="flex flex-col">
          {rows.map((row, index) => (
            <li key={`${row.at}-${index}`} className={cn("flex items-baseline justify-between gap-3 py-1.5 text-[12.5px]", index > 0 && "border-t border-hairline/30")}>
              <span className="min-w-0 truncate text-ink">
                {jobName(row.seam)}: <span className={row.ok ? "text-ink" : "text-ink-secondary"}>{label(row)}</span>
              </span>
              <span className="shrink-0 tabular-nums text-[11px] text-ink-tertiary">
                {row.ok && row.pTop !== null ? `${Math.round(row.pTop * 100)}% · ` : ""}{new Date(row.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
