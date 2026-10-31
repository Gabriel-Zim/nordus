import { useEffect, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { useStore, type Bot } from "@/state/store";
import { compact, limitFromDraft, money, useBotBudget, type BotBudget } from "@/state/bot-budget";
import { personNamed, useDirectory } from "@/state/people-directory";
import { ToolPermissionsDialog, toolCount, useBotTools } from "./ToolPermissionsDialog";
import { accountName, formatResetDistance, planNearLimit, usePlanUsageReport, type PlanProvider } from "../PlanUsage";

function ProfileRow({ title, hint, onEdit, children, ...rest }: {
  title: string;
  hint?: ReactNode;
  onEdit?: () => void;
  children?: ReactNode;
} & Record<`data-${string}`, string>) {
  return (
    <div className="py-3.5" {...rest}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13.5px] font-semibold text-ink">{title}</div>
          {hint && <div className="mt-0.5 text-[12.5px] leading-relaxed text-ink-secondary">{hint}</div>}
        </div>
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            className="flex shrink-0 items-center gap-0.5 rounded-[8px] px-1.5 py-0.5 text-[12.5px] font-medium text-ink hover:bg-white/[0.06]"
          >
            {t("botSettings.simple.edit")}
            <ChevronRight size={14} className="text-ink-secondary" aria-hidden="true" />
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

function whoTalks(visibility: Bot["visibility"]): string {
  if (!visibility || visibility === "everyone") return t("profile.who.everyone");
  if (visibility === "admins") return t("profile.who.admins");
  return t("profile.who.people", { people: visibility.people.slice(0, 3).join(", ") + (visibility.people.length > 3 ? "…" : "") });
}

function budgetHint(budget: BotBudget): string {
  const limit = budget.monthlyUsd === null ? null : money(budget.monthlyUsd);
  if (budget.spentUsd === undefined) return limit ? t("people.owner.budget.limit", { limit }) : t("people.owner.budget.noLimit");
  const spent = money(budget.spentUsd);
  return limit ? t("profile.budget.of", { spent, limit }) : t("profile.budget.noLimit", { spent });
}

export function AgentProfileSections({ bot, skillCount, onMemory, onSkills, onSection }: {
  bot: Bot;
  skillCount: number;
  onMemory: () => void;
  onSkills: () => void;
  onSection: (section: "visibility" | "permissions" | "usage") => void;
}) {
  const [toolsOpen, setToolsOpen] = useState(false);
  const [toolsVersion, setToolsVersion] = useState(0);
  const tools = useBotTools(bot.id, `${toolsVersion}:${JSON.stringify(bot.toolScope ?? null)}`);
  const count = toolCount(tools);
  const { state } = useStore();
  const { budget, save } = useBotBudget(bot.id);
  const [editingLimit, setEditingLimit] = useState(false);
  const [draft, setDraft] = useState("");
  const { people } = useDirectory();
  const blocked = bot.toolScope?.deny?.length ?? 0;
  const percent = budget?.percent ?? null;
  const subscription = state.instances.find((instance) => instance.instanceId === bot.modelSelection.instanceId)?.snapshot.billing === "subscription";

  const commitLimit = async () => {
    await save(limitFromDraft(draft, budget?.monthlyUsd ?? null));
    setEditingLimit(false);
  };

  return (
    <div data-agent-profile="" className="divide-y divide-white/[0.06]">
      <ProfileRow data-profile-row="knows" title={t("profile.knows.title")} hint={t(bot.memoryEnabled === false ? "profile.knows.off" : "profile.knows.on")} onEdit={onMemory} />
      <ProfileRow
        data-profile-row="owner"
        title={t("people.owner.row", { name: bot.owner ? personNamed(people, bot.owner) : t("people.owner.admins") })}
        hint={t("people.owner.hint")}
      />
      <TagRow bot={bot} />
      <ProfileRow data-profile-row="who" title={t("profile.who.title")} hint={whoTalks(bot.visibility)} onEdit={() => onSection("visibility")} />
      <ProfileRow
        data-profile-row="tools"
        title={t("profile.tools.title")}
        hint={count ? t("profile.tools.count", { on: count.on, total: count.total }) : blocked ? t("profile.tools.blocked", { count: blocked }) : t("profile.tools.all")}
        onEdit={() => setToolsOpen(true)}
      />
      {toolsOpen && <ToolPermissionsDialog bot={bot} onClose={() => setToolsOpen(false)} onSaved={() => setToolsVersion((v) => v + 1)} />}
      <ProfileRow data-profile-row="skills" title={t("profile.skills.title")} hint={t("profile.skills.count", { count: skillCount })} onEdit={onSkills} />
      {subscription ? (
        <PlanRow instanceId={bot.modelSelection.instanceId} runs={budget?.runs ?? null} tokens={budget ? budget.input + budget.output : null} />
      ) : (
      <ProfileRow
        data-profile-row="budget"
        title={t("profile.budget.title")}
        hint={budget ? budgetHint(budget) : t("common.checking")}
        onEdit={() => { setDraft(budget?.monthlyUsd ? String(budget.monthlyUsd) : ""); setEditingLimit((open) => !open); }}
      >
        {percent !== null && (
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.08]" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, percent)}>
            <div
              className={cn("h-full rounded-full", budget?.exceeded ? "bg-danger" : budget?.warn ? "bg-warning" : "bg-accent")}
              style={{ width: `${Math.min(100, percent)}%` }}
            />
          </div>
        )}
        {budget && (
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[11px] text-ink-tertiary">
            <span>{t("profile.budget.runs", { count: budget.runs })}</span>
            <span>{t("profile.budget.tokens", { count: compact(budget.input + budget.output) })}</span>
            {budget.monthlyUsd !== null && <span>{t("profile.budget.alert", { percent: budget.warnAtPercent })}</span>}
          </div>
        )}
        {editingLimit && (
          <form
            className="mt-2 flex items-center gap-2"
            onSubmit={(event) => { event.preventDefault(); void commitLimit(); }}
          >
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
            <button type="submit" className="rounded-[10px] bg-accent px-2.5 py-1 text-[12.5px] font-medium text-white hover:brightness-110">{t("profile.budget.save")}</button>
            {budget?.monthlyUsd !== null && (
              <button type="button" onClick={() => { setDraft(""); void save(null).then(() => setEditingLimit(false)); }} className="rounded-[10px] px-2 py-1 text-[12.5px] text-ink-secondary hover:text-ink">
                {t("profile.budget.remove")}
              </button>
            )}
          </form>
        )}
      </ProfileRow>
      )}
    </div>
  );
}

function planWindowPercent(provider: PlanProvider, which: "fiveHour" | "weekly"): string {
  const window = provider[which];
  return window.available && window.usedPercent !== null ? `${Math.round(window.usedPercent)}%` : "—";
}

/** A subscription agent spends the plan of its connected account, so its row shows the plan, not dollars. */
function PlanRow({ instanceId, runs, tokens }: { instanceId: string; runs: number | null; tokens: number | null }) {
  const report = usePlanUsageReport();
  const provider = report?.providers.find((entry) => entry.id === instanceId && entry.ok) ?? null;
  const near = provider ? planNearLimit(provider) : null;
  const when = near ? formatResetDistance(near.resetsAt, Date.now()) : null;
  return (
    <ProfileRow
      data-profile-row="budget"
      title={t("profile.plan.title")}
      hint={provider
        ? t("profile.plan.hint", { account: accountName(provider), five: planWindowPercent(provider, "fiveHour"), week: planWindowPercent(provider, "weekly") })
        : report ? t("profile.plan.unknown") : t("common.checking")}
    >
      {near && (
        <div data-plan-warning="" role="status" className="mt-1.5 text-[12.5px] text-warning">
          {when
            ? t("profile.plan.near", { window: near.label, percent: near.used, when })
            : t("profile.plan.nearNoReset", { window: near.label, percent: near.used })}
        </div>
      )}
      {runs !== null && tokens !== null && (
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[11px] text-ink-tertiary">
          <span>{t("profile.budget.runs", { count: runs })}</span>
          <span>{t("profile.budget.tokens", { count: compact(tokens) })}</span>
        </div>
      )}
    </ProfileRow>
  );
}

/** "Etiqueta": an optional short label beside the name in the list. Empty shows nothing. */
function TagRow({ bot }: { bot: Bot }) {
  const { dispatch } = useStore();
  const [draft, setDraft] = useState(bot.tag ?? "");
  useEffect(() => setDraft(bot.tag ?? ""), [bot.tag]);
  const commit = () => {
    const next = draft.replace(/\s+/g, " ").trim().slice(0, 24);
    if (next === (bot.tag ?? "")) return;
    dispatch({ type: "updateBot", botId: bot.id, patch: { tag: next } });
  };
  return (
    <ProfileRow data-profile-row="tag" title={t("profile.tag.title")} hint={t("profile.tag.hint")}>
      <input
        value={draft}
        maxLength={24}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
        placeholder={t("profile.tag.placeholder")}
        aria-label={t("profile.tag.title")}
        className="mt-2 w-48 rounded-[10px] border border-white/10 bg-white/[0.04] px-2 py-1 text-[13px] uppercase tracking-[0.04em] text-ink placeholder:normal-case placeholder:tracking-normal placeholder:text-ink-tertiary focus:border-focus focus:outline-none"
      />
    </ProfileRow>
  );
}
