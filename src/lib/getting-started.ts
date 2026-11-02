import type { LocaleKey } from "@/locales";

export const GETTING_STARTED_HINT = "getting-started";

export type GettingStartedStepId = "engine" | "bot" | "ask" | "app" | "routine";

export interface GettingStartedStep {
  id: GettingStartedStepId;
  label: LocaleKey;
  done: boolean;
}

export interface GettingStartedFacts {
  engineReady: boolean;
  bots: ReadonlyArray<{ hidden?: boolean; tasks?: ReadonlyArray<{ threadId: string; titleFromFirstMessage?: true }> }>;
  firstTurnAt?: string;
  /** null while the connected-apps inventory has not answered. */
  appConnected: boolean | null;
  routines: number;
}

export function gettingStartedSteps(facts: GettingStartedFacts): GettingStartedStep[] {
  const visible = facts.bots.filter((bot) => !bot.hidden);
  const asked = Boolean(facts.firstTurnAt) || visible.some((bot) => (bot.tasks ?? []).some((task) => task.titleFromFirstMessage === true));
  return [
    { id: "engine", label: "gettingStarted.step.engine", done: facts.engineReady },
    { id: "bot", label: "gettingStarted.step.bot", done: visible.length > 0 },
    { id: "ask", label: "gettingStarted.step.ask", done: asked },
    { id: "app", label: "gettingStarted.step.app", done: facts.appConnected === true },
    { id: "routine", label: "gettingStarted.step.routine", done: facts.routines > 0 },
  ];
}

export function gettingStartedVisible(steps: readonly GettingStartedStep[], options: { dismissed: boolean; canSave: boolean }): boolean {
  return options.canSave && !options.dismissed && steps.some((step) => !step.done);
}
