import { useState } from "react";
import { ChevronDown, FileText, Plus } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { BotOverview } from "@/lib/bot-overview-types";
import type { Routine } from "@/lib/routines";
import { routineFinished, routineNextLabel } from "@/lib/routine-display";
import { scheduleLabel } from "@/lib/schedule-label";
import { useStore, type Bot } from "@/state/store";
import { engineReady } from "../EngineLibrary";
import { RoutineEditor } from "../RoutinesPage";
import type { useBotSettingsDerived } from "../bot-settings/useBotSettingsDerived";
import { AdvancedPanel } from "./AdvancedPanel";
import type { PageId, PanelTarget } from "./page-registry";
import { BotSwitch, buttonCls, Card, LabelAction, LinkRow, NoteRow, rowCls } from "./rows";

type Derived = ReturnType<typeof useBotSettingsDerived>;

export function DetailsTab({ bot, derived, overview, slackUrl = null, query, onQuery, advancedOpen, onAdvancedToggle, onOpen, onGo }: {
  bot: Bot;
  derived: Derived;
  overview: BotOverview | null;
  slackUrl?: string | null;
  query: string;
  onQuery: (query: string) => void;
  /** Whether the "Advanced" disclosure is open; the panel owns it, so a link into it can open it. */
  advancedOpen: boolean;
  onAdvancedToggle: () => void;
  onOpen: (page: PageId) => void;
  onGo: (target: PanelTarget) => void;
}) {
  const { state, dispatch } = useStore();
  const [editingRoutine, setEditingRoutine] = useState<Routine | "new" | null>(null);
  const { engine } = derived;

  const routines = [...derived.botRoutines].sort((a, b) =>
    Number(b.enabled) - Number(a.enabled) || (a.nextRunAt ?? Infinity) - (b.nextRunAt ?? Infinity) || a.name.localeCompare(b.name));

  return (
    <div data-panel-tabpanel="details">
      {!(engine && engineReady(engine)) && (
        <Card anchor="model">
          <NoteRow tone="warn">{t("botPanel.noAi", { name: bot.name })}</NoteRow>
          <LinkRow data-panel-link="connect-ai" onClick={() => dispatch({ type: "toggleAppSettings", open: true, section: "engines" })}>
            {t("onboarding.engines.title")}
          </LinkRow>
        </Card>
      )}

      <Card
        label={t("botSettings.simple.routines")}
        anchor="routines"
        action={routines.length > 0 ? (
          <LabelAction data-panel-action="routines" aria-label={t("botPanel.allRoutines")} onClick={() => onOpen("routines")}>
            {routines.length}
          </LabelAction>
        ) : undefined}
      >
        {routines.length === 0 ? (
          <NoteRow>{t("botSettings.simple.routinesEmpty", { name: bot.name })}</NoteRow>
        ) : routines.map((routine) => (
          <div key={routine.id} data-simple-routine={routine.id} className={rowCls}>
            <button type="button" onClick={() => setEditingRoutine(routine)} className="min-w-0 flex-1 text-left">
              <div className="truncate text-[13.5px] font-medium text-ink">{routine.name}</div>
              <div className="mt-px truncate text-[12.5px] text-ink-secondary">
                {scheduleLabel(routine.schedule)} · {routineNextLabel(routine)}
              </div>
            </button>
            {!routineFinished(routine) && (
              <BotSwitch
                color={bot.color}
                checked={routine.enabled}
                aria-label={t("routines.toggle", { name: routine.name })}
                onClick={() => dispatch({ type: "updateRoutine", routineId: routine.id, patch: { enabled: !routine.enabled } })}
              />
            )}
          </div>
        ))}
        <div className={cn(rowCls, "flex-wrap gap-2")}>
          <button type="button" data-panel-action="new-routine" onClick={() => setEditingRoutine("new")} className={buttonCls}>
            <Plus size={14} aria-hidden="true" />
            {t("computer.routines.create")}
          </button>
          <button
            type="button"
            data-panel-action="routine-logs"
            onClick={() => dispatch({ type: "showRoutines", section: "logs", botId: bot.id })}
            className={buttonCls}
          >
            <FileText size={13} aria-hidden="true" />
            {t("routines.logs")}
          </button>
        </div>
        <LinkRow
          data-panel-link="schedules"
          onClick={() => dispatch({ type: "showRoutines", section: "schedule", view: "list", botId: bot.id })}
        >
          {t("computer.routines.openTitle")}
        </LinkRow>
      </Card>

      <section data-panel-card="advanced">
        <button
          type="button"
          data-panel-advanced-toggle
          aria-expanded={advancedOpen}
          onClick={onAdvancedToggle}
          className="mt-5 flex min-h-8 w-full items-center justify-between gap-2 rounded-[7px] px-1 text-left text-[12.5px] text-ink-secondary hover:bg-ink/[0.04] hover:text-ink"
        >
          <span>{t("botPanel.advanced")}</span>
          <ChevronDown size={14} aria-hidden="true" className={cn("shrink-0 transition-transform", advancedOpen && "rotate-180")} />
        </button>
        {advancedOpen && (
          <AdvancedPanel
            bot={bot}
            derived={derived}
            overview={overview}
            slackUrl={slackUrl}
            query={query}
            onQuery={onQuery}
            onOpen={onOpen}
            onGo={onGo}
          />
        )}
      </section>

      {editingRoutine && (
        <RoutineEditor
          key={bot.id}
          routine={editingRoutine === "new" ? undefined : editingRoutine}
          bots={[bot]}
          lockedBotId={bot.id}
          onClose={() => setEditingRoutine(null)}
        />
      )}
      {state.routinesLoadState === "error" && <p role="alert" className="mx-1 mt-2 text-[12px] text-danger">{t("routines.loadError")}</p>}
    </div>
  );
}
