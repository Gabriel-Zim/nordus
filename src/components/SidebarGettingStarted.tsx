import { useEffect, useState } from "react";
import { Check, Circle, X } from "lucide-react";
import { api, openBot, useStore, type Action } from "@/state/store";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { hintSeen, hintSeenPatch } from "@/lib/onboarding";
import { GETTING_STARTED_HINT, gettingStartedSteps, gettingStartedVisible, type GettingStartedStepId } from "@/lib/getting-started";
import { hasActiveConnection } from "@/lib/connector-status";
import { useShowThreads } from "@/lib/thread-preferences";
import { useViewer } from "@/lib/use-viewer";
import { preloadConnectedApps } from "./connected-apps";

const STEP_ACTIONS: Record<Exclude<GettingStartedStepId, "ask">, Action> = {
  engine: { type: "toggleAppSettings", open: true, section: "engines" },
  bot: { type: "toggleNewBot", open: true },
  app: { type: "togglePlugins", open: true, surface: "apps" },
  routine: { type: "showRoutines" },
};

function useAppConnected(enabled: boolean): boolean | null {
  const [connected, setConnected] = useState<boolean | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void preloadConnectedApps()
      .then((inventory) => { if (alive) setConnected(Object.values(inventory.services).some(hasActiveConnection)); })
      .catch(() => {});
    return () => { alive = false; };
  }, [enabled]);
  return connected;
}

export function SidebarGettingStarted() {
  const { state, dispatch } = useStore();
  const showThreads = useShowThreads();
  const viewer = useViewer();
  const record = state.config?.onboarding;
  const [closed, setClosed] = useState(false);
  const dismissed = closed || hintSeen(record, GETTING_STARTED_HINT);
  const eligible = viewer.admin && !dismissed && Boolean(state.config);
  const appConnected = useAppConnected(eligible);
  const steps = gettingStartedSteps({
    engineReady: state.instances.some((instance) => instance.snapshot.state === "available"),
    bots: state.bots,
    firstTurnAt: record?.firstTurnAt,
    appConnected,
    routines: state.routines.length,
  });
  if (!eligible || !gettingStartedVisible(steps, { dismissed, canSave: viewer.admin })) return null;

  const done = steps.filter((step) => step.done).length;
  const dismiss = () => {
    setClosed(true);
    const patch = hintSeenPatch(record, GETTING_STARTED_HINT);
    if (!patch) return;
    void api("/api/config", { method: "PUT", body: JSON.stringify(patch) })
      .then((config) => dispatch({ type: "configStatus", config }))
      .catch(() => {});
  };
  const run = (id: GettingStartedStepId) => {
    if (id !== "ask") return dispatch(STEP_ACTIONS[id]);
    const bot = state.bots.find((entry) => entry.id === state.selectedId && !entry.hidden) ?? state.bots.find((entry) => !entry.hidden);
    if (bot) openBot(dispatch, bot, showThreads);
    else dispatch(STEP_ACTIONS.bot);
  };

  return (
    <section data-sidebar-getting-started="" aria-labelledby="getting-started-title" className="mb-2 rounded-xl bg-inset/40 px-3 pb-2 pt-2.5">
      <div className="flex items-center gap-2">
        <h2 id="getting-started-title" className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink">{t("gettingStarted.title")}</h2>
        <span className="text-[11px] tabular-nums text-ink-secondary">{t("gettingStarted.progress", { done, total: steps.length })}</span>
        <button type="button" onClick={dismiss} aria-label={t("gettingStarted.hide")} title={t("gettingStarted.hide")}
          className="flex size-5 shrink-0 items-center justify-center rounded text-ink-tertiary hover:bg-raised hover:text-ink">
          <X size={12} aria-hidden="true" />
        </button>
      </div>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-raised" aria-hidden="true">
        <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${(done / steps.length) * 100}%` }} />
      </div>
      <ul className="mt-1.5">
        {steps.map((step) => (
          <li key={step.id}>
            <button type="button" disabled={step.done} onClick={() => run(step.id)} data-step={step.id}
              className={cn("flex w-full items-center gap-2 rounded-md px-1 py-1 text-left text-[12.5px]",
                step.done ? "text-ink-tertiary line-through" : "text-ink-secondary hover:bg-raised hover:text-ink")}>
              {step.done
                ? <Check size={13} className="shrink-0 text-success" aria-hidden="true" />
                : <Circle size={13} className="shrink-0" aria-hidden="true" />}
              <span className="min-w-0 truncate">{t(step.label)}</span>
              {step.done && <span className="sr-only">{t("gettingStarted.done")}</span>}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
