import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEnsureList } from "@/state/lazy-lists";
import { Loader2, RefreshCw } from "lucide-react";
import { api, useStore } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import {
  accountKeyOf, brasiliaStamp, buildAccountCards, destinationLabel, effortChoices, filterRobots, groupBySection, instanceLabel,
  isAccountInstance, planMoves, toggleAll, type PlannedMove, type RobotView,
} from "@/lib/account-moves";
import { effortLabel } from "./ModelPicker";
import type { EffortLevel } from "../../shared/wire";
import type { AccountPreset, MoveBatch, MoveSelection } from "../../shared/account-moves";
import { AccountLimitCards, SQUARE_PANEL, robotCountLabel } from "./AccountLimitCards";
import { AccountMoveHistory } from "./AccountMoveHistory";
import type { PlanUsageReport } from "./PlanUsage";
import { Card } from "./SettingsPrimitives";
import { Select } from "./Select";
import { ModelSearchPicker } from "./ModelSearchPicker";
import { visibleInterval } from "@/lib/visible-interval";

const POLL_BATCHES_MS = 10_000;
const POLL_LIMITS_MS = 60_000;

interface Confirming {
  label: string;
  rows: PlannedMove[];
}

const BUTTON = "ui-button min-h-11 rounded-[3px] sm:min-h-8";
const FIELD = "w-full rounded-[3px]";

function errorText(cause: unknown): string {
  return cause instanceof Error && cause.message ? cause.message : t("accounts.error.generic");
}

export function AccountMovesSettings() {
  const { state } = useStore();
  useEnsureList("routines");
  const [report, setReport] = useState<PlanUsageReport | null>(null);
  const [limitsLoading, setLimitsLoading] = useState(true);
  const [limitsError, setLimitsError] = useState("");
  const [batches, setBatches] = useState<MoveBatch[]>([]);
  const [presets, setPresets] = useState<AccountPreset[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [account, setAccount] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [toId, setToId] = useState("");
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState("");
  const [confirming, setConfirming] = useState<Confirming | null>(null);
  const [moveLabel, setMoveLabel] = useState("");
  const [saving, setSaving] = useState<"selection" | "split" | null>(null);
  const [presetName, setPresetName] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const alive = useRef(true);

  const loadLimits = useCallback(async (refresh = false) => {
    setLimitsLoading(true);
    setLimitsError("");
    try {
      const next = await api<PlanUsageReport>(refresh ? "/api/plan-usage?refresh=1" : "/api/plan-usage");
      if (alive.current) setReport(next);
    } catch (cause) {
      if (alive.current) setLimitsError(errorText(cause));
    } finally {
      if (alive.current) { setLimitsLoading(false); setNow(Date.now()); }
    }
  }, []);

  const loadBatches = useCallback(async () => {
    try {
      const next = await api<{ batches: MoveBatch[] }>("/api/account-moves");
      if (alive.current) { setBatches(next.batches); setNow(Date.now()); }
    } catch { /* the next poll tries again */ }
  }, []);

  const loadPresets = useCallback(async () => {
    try {
      const next = await api<{ presets: AccountPreset[] }>("/api/account-presets");
      if (alive.current) setPresets(next.presets);
    } catch { /* shown empty */ }
  }, []);

  useEffect(() => {
    alive.current = true;
    void loadLimits(false);
    void loadBatches();
    void loadPresets();
    const stopFast = visibleInterval(() => void loadBatches(), POLL_BATCHES_MS);
    const stopSlow = visibleInterval(() => void loadLimits(false), POLL_LIMITS_MS);
    return () => { alive.current = false; stopFast(); stopSlow(); };
  }, [loadLimits, loadBatches, loadPresets]);

  const instances = state.instances ?? [];
  const robots: RobotView[] = state.bots ?? [];
  const cards = useMemo(() => buildAccountCards(instances, report?.providers ?? [], robots), [instances, report, robots]);
  const labelOf = useCallback((instanceId: string) => instanceLabel(instances, instanceId), [instances]);

  const chips = useMemo(() => {
    const seen = new Map(cards.map((card) => [card.key, card.label]));
    for (const bot of robots) {
      const key = accountKeyOf(bot.modelSelection.instanceId);
      if (!seen.has(key)) seen.set(key, labelOf(bot.modelSelection.instanceId));
    }
    return [...seen.entries()].map(([key, label]) => ({
      key, label, count: robots.filter((bot) => accountKeyOf(bot.modelSelection.instanceId) === key).length,
    }));
  }, [cards, robots, labelOf]);

  const visible = useMemo(() => filterRobots(robots, account, query), [robots, account, query]);
  const groups = useMemo(() => groupBySection(visible, state.sections ?? []), [visible, state.sections]);
  const visibleIds = visible.map((bot) => bot.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const chosen = robots.filter((bot) => selected.has(bot.id));

  const destinations = useMemo(() => instances.filter((instance) =>
    isAccountInstance(instance) && (instance.snapshot.state === "available" || instance.instanceId === toId)), [instances, toId]);
  const destination = destinations.find((instance) => instance.instanceId === toId);
  const modelOptions = destination ? [destination.models.default, ...destination.models.options.map((option) => option.id)].filter((id, index, all) => id && all.indexOf(id) === index) : [];
  const labelFor = (id: string) => destination?.models.options.find((option) => option.id === id)?.label;
  const pickerModels = modelOptions.map((id) => ({ id, name: labelFor(id) && labelFor(id) !== id ? labelFor(id) : undefined }));
  const effortOptions = destination ? effortChoices(destination) : [];
  const ruleModels: string[] = [];
  const planned = destination ? planMoves(chosen, destination, { model, effort }) : [];

  if (destination) for (const row of planMoves(chosen, destination, { model: "", effort })) if (!ruleModels.includes(row.to.model)) ruleModels.push(row.to.model);

  const routinesOf = (botId: string) => (state.routines ?? []).filter((routine) => routine.botId === botId);

  const post = async (path: string, init: RequestInit) => {
    setError("");
    try {
      return await api(path, init);
    } catch (cause) {
      setError(errorText(cause));
      return null;
    }
  };

  const askConfirm = () => {
    if (!destination || chosen.length === 0) return;
    setMoveLabel("");
    setConfirming({ label: t("accounts.defaultLabel", { count: chosen.length, account: labelOf(destination.instanceId) }), rows: planned });
  };

  const send = async () => {
    if (!confirming) return;
    setWorking(true);
    const result = await post("/api/account-moves", {
      method: "POST",
      body: JSON.stringify({
        label: moveLabel.trim() || confirming.label,
        targets: confirming.rows.map((row) => ({ botId: row.botId, ...row.to })),
      }),
    });
    setWorking(false);
    if (!result) return;
    setConfirming(null);
    setExpanded(false);
    setSelected(new Set());
    setNotice(t("accounts.sent"));
    await loadBatches();
  };

  const act = async (id: string, action: "undo" | "cancel") => {
    setBusyId(id);
    await post(`/api/account-moves/${encodeURIComponent(id)}/${action}`, { method: "POST", body: "{}" });
    setBusyId(null);
    await loadBatches();
  };

  const savePreset = async () => {
    const targets: Array<{ botId: string } & MoveSelection> = saving === "selection"
      ? planned.map((row) => ({ botId: row.botId, ...row.to }))
      : robots.map((bot) => ({ botId: bot.id, ...(bot.modelSelection as MoveSelection) }));
    const result = await post("/api/account-presets", { method: "PUT", body: JSON.stringify({ name: presetName, targets }) });
    if (!result) return;
    setSaving(null);
    setPresetName("");
    await loadPresets();
  };

  const applyPreset = (preset: AccountPreset) => {
    setMoveLabel("");
    setConfirming({
      label: preset.name,
      rows: preset.targets.map((target) => {
        const bot = robots.find((candidate) => candidate.id === target.botId);
        const { botId, ...to } = target;
        return { botId, botName: bot?.name ?? botId, from: (bot?.modelSelection as MoveSelection | undefined) ?? { instanceId: "", model: "" }, to, fellBack: false };
      }),
    });
  };

  const removePreset = async (id: string) => {
    await post(`/api/account-presets/${encodeURIComponent(id)}`, { method: "DELETE" });
    await loadPresets();
  };

  const confirmGroups = useMemo(() => {
    const byAccount = new Map<string, PlannedMove[]>();
    for (const row of confirming?.rows ?? []) byAccount.set(row.to.instanceId, [...(byAccount.get(row.to.instanceId) ?? []), row]);
    return [...byAccount.entries()].map(([instanceId, rows]) => ({ instanceId, rows }));
  }, [confirming]);
  const outside = chosen.filter((bot) => !visibleIds.includes(bot.id));

  const busyNow = (botId: string) => robots.find((bot) => bot.id === botId)?.busy === true;
  const line = (selection: MoveSelection) => [labelOf(selection.instanceId), selection.model, selection.effort ? effortLabel(selection.effort as EffortLevel) : ""].filter(Boolean).join(" · ");

  return (
    <div data-account-moves="" className="flex flex-col gap-4">
      <Card title={t("accounts.limits.title")} subtitle={t("accounts.subtitle")}>
        <div className="mb-3 flex justify-end">
          <button
            type="button"
            onClick={() => void loadLimits(true)}
            disabled={limitsLoading}
            aria-label={t("accounts.refresh")}
            title={t("accounts.refresh")}
            className="ui-icon-button size-11 sm:size-8"
          >
            {limitsLoading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          </button>
        </div>
        {limitsLoading && !report && <p role="status" className="text-[13px] text-ink-secondary">{t("accounts.loading")}</p>}
        {limitsError && <p role="alert" className="mb-3 text-[13px] text-danger">{limitsError}</p>}
        {cards.length === 0 && !limitsLoading && <p className="text-[13px] text-ink-secondary">{t("accounts.noAccounts")}</p>}
        <AccountLimitCards cards={cards} now={now} active={account} onPick={setAccount} />
      </Card>

      <Card title={t("accounts.robots.title")} subtitle={t("accounts.robots.subtitle")}>
        <div className="flex flex-col gap-3">
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="group" aria-label={t("accounts.filter.label")}>
            {[{ key: null as string | null, label: t("accounts.filter.all"), count: robots.length }, ...chips].map((chip) => (
              <button
                key={chip.key ?? "all"}
                type="button"
                data-account-chip={chip.key ?? "all"}
                aria-pressed={account === chip.key}
                onClick={() => setAccount(chip.key)}
                className={cn("ui-button min-h-11 shrink-0 rounded-[3px] sm:min-h-8", account === chip.key && "border-accent")}
              >
                {chip.label} <span className="tabular-nums text-ink-secondary">{chip.count}</span>
              </button>
            ))}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("accounts.search")}
              aria-label={t("accounts.search")}
              className="min-h-11 w-full rounded-[3px] border border-hairline/40 bg-inset px-3 text-[14px] text-ink placeholder:text-ink-secondary focus:outline-none sm:min-h-8 sm:flex-1"
            />
            <button
              type="button"
              data-select-all=""
              disabled={visibleIds.length === 0}
              onClick={() => setSelected(toggleAll(selected, visibleIds))}
              className={BUTTON}
            >
              {allVisibleSelected ? t("accounts.unselectAll") : t("accounts.selectAll")}
            </button>
          </div>

          {groups.length === 0 && <p className="text-[13px] text-ink-secondary">{t("accounts.empty")}</p>}
          {groups.map((group) => (
            <section key={group.section ?? "none"} data-robot-group={group.section ?? ""} className="flex flex-col gap-2">
              <h4 className="text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-secondary">{group.section ?? t("accounts.noSection")}</h4>
              {group.bots.map((bot) => {
                const rows = routinesOf(bot.id);
                return (
                  <label
                    key={bot.id}
                    data-robot={bot.id}
                    className={cn(SQUARE_PANEL, "flex min-h-14 cursor-pointer items-start gap-3 p-3", selected.has(bot.id) && "border-accent")}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 size-5 shrink-0 accent-[var(--color-accent)]"
                      checked={selected.has(bot.id)}
                      onChange={() => setSelected(toggleAll(selected, [bot.id]))}
                      aria-label={bot.name}
                    />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                        <span className="truncate text-[14px] font-medium text-ink">{bot.name}</span>
                        <span data-robot-state={bot.busy ? "busy" : "free"} className={cn("text-[11px] font-semibold uppercase tracking-[0.04em]", bot.busy ? "text-warning" : "text-success")}>
                          {bot.busy ? t("accounts.state.busy") : t("accounts.state.free")}
                        </span>
                      </span>
                      <span className="text-[12px] text-ink-secondary">{line(bot.modelSelection as MoveSelection)}</span>
                      {rows.map((routine) => (
                        <span key={routine.id} data-routine="" className="text-[12px] text-ink-secondary">
                          {routine.enabled && routine.nextRunAt
                            ? t("accounts.routine.next", { name: routine.name, when: brasiliaStamp(routine.nextRunAt) })
                            : t("accounts.routine.paused", { name: routine.name })}
                        </span>
                      ))}
                    </span>
                  </label>
                );
              })}
            </section>
          ))}
        </div>
      </Card>

      {(chosen.length > 0 || confirming) && <div
        data-account-bar=""
        className={cn(SQUARE_PANEL, "sticky bottom-0 z-10 flex flex-col gap-3 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-8px_24px_rgba(0,0,0,0.25)]")}
      >
        {confirming ? (
          <div role="group" aria-label={t("accounts.confirm.title")} data-account-confirm="" className="flex flex-col gap-2">
            <div className="text-[14px] font-medium text-ink">{t("accounts.confirm.title")}</div>
            <p className="text-[12px] text-ink-secondary">{t("accounts.confirm.summary", { count: confirming.rows.length })}</p>
            <div data-confirm-list="" className="flex max-h-48 flex-col gap-2 overflow-y-auto text-[12px] text-ink">
              {confirmGroups.map((group) => (
                <div key={group.instanceId} data-confirm-group={group.instanceId}>
                  <div className="font-semibold text-ink-secondary">{t("accounts.confirm.group", { account: labelOf(group.instanceId), count: group.rows.length })}</div>
                  <ul className="flex flex-col gap-1">
                    {group.rows.map((row) => (
                      <li key={row.botId}>
                        <span className="font-medium">{row.botName}</span>: {line(row.from)} → {line(row.to)}
                        {busyNow(row.botId) ? ` (${t("accounts.confirm.busyNow")})` : ""}
                        {row.fellBack ? ` (${t("accounts.confirm.fallback")})` : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <input
              value={moveLabel}
              onChange={(event) => setMoveLabel(event.target.value)}
              maxLength={120}
              placeholder={t("accounts.confirm.label")}
              aria-label={t("accounts.confirm.label")}
              className="min-h-11 w-full rounded-[3px] border border-hairline/40 bg-inset px-3 text-[14px] text-ink placeholder:text-ink-secondary focus:outline-none sm:min-h-8"
            />
            <div className="grid grid-cols-2 gap-2 sm:flex sm:justify-end">
              <button type="button" className={BUTTON} onClick={() => { setConfirming(null); setExpanded(false); }} disabled={working}>{t("accounts.confirm.back")}</button>
              <button type="button" data-confirm-go="" className={cn(BUTTON, "ui-button-primary")} onClick={() => void send()} disabled={working}>
                {working ? <Loader2 size={14} className="animate-spin" /> : t("accounts.confirm.go")}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink">
              <span role="status" data-selected-count="" className="font-medium">
                {chosen.length === 1 ? t("accounts.selectedOne") : t("accounts.selected", { count: chosen.length })}
              </span>
              {outside.length > 0 && (
                <span data-outside-filter="" className="flex items-center gap-2 text-[12px] text-warning">
                  {t("accounts.outside", { count: outside.length })}
                  <button
                    type="button"
                    data-clear-outside=""
                    className="ui-button ui-button-sm min-h-9 rounded-[3px] sm:min-h-6"
                    onClick={() => setSelected(new Set(chosen.filter((bot) => visibleIds.includes(bot.id)).map((bot) => bot.id)))}
                  >
                    {t("accounts.outsideClear")}
                  </button>
                </span>
              )}
              {!expanded && (
                <button type="button" data-open-bar="" className={cn(BUTTON, "ui-button-primary ml-auto sm:hidden")} onClick={() => setExpanded(true)}>
                  {t("accounts.bar.to")}
                </button>
              )}
            </div>
            <div data-bar-fields="" className={cn("grid-cols-1 gap-2 sm:grid sm:grid-cols-[repeat(3,minmax(0,1fr))_auto]", expanded ? "grid" : "hidden")}>
              <div className="text-[13px] font-medium text-ink sm:hidden">{t("accounts.bar.to")}</div>
              <Select
                className={FIELD}
                aria-label={t("accounts.bar.account")}
                value={toId}
                onChange={(event) => { setToId(event.target.value); setModel(""); setEffort(""); }}
              >
                <option value="">{t("accounts.bar.pick")}</option>
                {destinations.map((instance) => <option key={instance.instanceId} value={instance.instanceId}>{destinationLabel(instance.instanceId, labelOf(instance.instanceId))}</option>)}
              </Select>
              <ModelSearchPicker
                ariaLabel={t("accounts.bar.model")}
                value={model}
                onChange={setModel}
                disabled={!destination}
                models={pickerModels}
                ruleHint={ruleModels.length === 1 ? ruleModels[0]! : ruleModels.length > 1 ? t("accounts.bar.modelMany") : ""}
              />
              <Select className={FIELD} aria-label={t("accounts.bar.effort")} value={effort} disabled={!destination || effortOptions.length === 0} onChange={(event) => setEffort(event.target.value)}>
                <option value="">{t("accounts.bar.effortRule")}</option>
                <option value="none">{t("accounts.bar.effortNone")}</option>
                {effortOptions.map((level) => <option key={level} value={level}>{effortLabel(level as EffortLevel)}</option>)}
              </Select>
              <button type="button" data-apply="" className={cn(BUTTON, "ui-button-primary")} disabled={!destination || chosen.length === 0} onClick={askConfirm}>
                {t("accounts.bar.apply")}
              </button>
              <button type="button" data-close-bar="" className={cn(BUTTON, "sm:hidden")} onClick={() => setExpanded(false)}>
                {t("accounts.cancel")}
              </button>
            </div>
          </>
        )}
        {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
        {notice && !error && <p role="status" className="text-[13px] text-success">{notice}</p>}
      </div>}

      <Card title={t("accounts.presets.title")} subtitle={t("accounts.presets.subtitle")}>
        <div className="flex flex-col gap-3">
          {presets.length === 0 && <p className="text-[13px] text-ink-secondary">{t("accounts.presets.empty")}</p>}
          {presets.map((preset) => (
            <div key={preset.id} data-preset={preset.id} className={cn(SQUARE_PANEL, "flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between")}>
              <div className="min-w-0">
                <div className="truncate text-[14px] font-medium text-ink">{preset.name}</div>
                <div className="text-[12px] text-ink-secondary">{robotCountLabel(preset.targets.length)}</div>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:flex">
                <button type="button" className={BUTTON} onClick={() => applyPreset(preset)}>{t("accounts.bar.apply")}</button>
                <button type="button" className={BUTTON} onClick={() => void removePreset(preset.id)}>{t("accounts.presets.delete")}</button>
              </div>
            </div>
          ))}
          {saving ? (
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                value={presetName}
                onChange={(event) => setPresetName(event.target.value)}
                maxLength={80}
                placeholder={t("accounts.presets.namePlaceholder")}
                aria-label={t("accounts.presets.name")}
                className="min-h-11 w-full rounded-[3px] border border-hairline/40 bg-inset px-3 text-[14px] text-ink placeholder:text-ink-secondary focus:outline-none sm:min-h-8 sm:flex-1"
              />
              <div className="grid grid-cols-2 gap-2 sm:flex">
                <button type="button" className={BUTTON} onClick={() => { setSaving(null); setPresetName(""); }}>{t("accounts.cancel")}</button>
                <button type="button" data-preset-save="" className={cn(BUTTON, "ui-button-primary")} disabled={!presetName.trim()} onClick={() => void savePreset()}>{t("accounts.presets.save")}</button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2 sm:flex-row">
              <button type="button" data-preset-from-selection="" className={BUTTON} disabled={!destination || chosen.length === 0} onClick={() => setSaving("selection")}>
                {t("accounts.presets.saveSelection")}
              </button>
              <button type="button" data-preset-from-split="" className={BUTTON} disabled={robots.length === 0} onClick={() => setSaving("split")}>
                {t("accounts.presets.saveSplit")}
              </button>
            </div>
          )}
        </div>
      </Card>

      <Card title={t("accounts.history.title")}>
        <AccountMoveHistory batches={batches} labelOf={labelOf} busyId={busyId} onUndo={(id) => void act(id, "undo")} onCancel={(id) => void act(id, "cancel")} />
      </Card>
    </div>
  );
}
