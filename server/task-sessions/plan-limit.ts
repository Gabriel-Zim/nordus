/** When the Claude plan limit runs out, desk tasks pause together and resume by themselves at the reset. */
export const PLAN_LIMIT_FALLBACK_MS = 30 * 60_000;
/** A reset time already past (or a stale one) never arms a timer shorter than this: that would resume, pause and announce in a loop. */
export const PLAN_LIMIT_MIN_WINDOW_MS = 2 * 60_000;
export const PLAN_LIMIT_RESUME_TEXT = "Continue de onde parou. Antes de repetir qualquer ação externa (publicar, enviar, gravar fora da pasta do pedido), confira o que já foi feito.";

export interface PlanLimitDeps {
  now: () => number;
  setTimer: (ms: number, fn: () => void) => void;
  resume: (threadId: string) => void;
  notify: (text: string, originThreadIds: string[]) => void;
  /** Sends the queue again once the window ends. */
  drain?: () => void;
}

const clock = (at: number) => `${String(new Date(at).getHours()).padStart(2, "0")}:${String(new Date(at).getMinutes()).padStart(2, "0")}`;

export function createPlanLimit(deps: PlanLimitDeps) {
  /** Paused tasks of the open window, each with the desk it reports to. */
  const paused = new Map<string, string>();
  const told = new Set<string>();
  let until = 0;
  let known = false;

  function open(at: number, exact: boolean): void {
    until = Math.max(at, deps.now() + PLAN_LIMIT_MIN_WINDOW_MS);
    known = exact;
    deps.setTimer(until - deps.now(), () => {
      const waiting = [...paused.keys()];
      until = 0;
      known = false;
      paused.clear();
      told.clear();
      for (const threadId of waiting) deps.resume(threadId);
      deps.drain?.();
    });
  }

  return {
    /** `resetsAt`: epoch seconds, when known. */
    onLimit(threadId: string, origin: string, resetsAt: number | null): void {
      const at = resetsAt === null ? deps.now() + PLAN_LIMIT_FALLBACK_MS : resetsAt * 1000;
      if (until === 0) open(at, resetsAt !== null);
      paused.set(threadId, origin);
      if (told.has(origin)) return;
      told.add(origin);
      deps.notify(resetsAt === null
        ? "Pausei as tarefas: o limite do plano acabou. Tento retomar em 30 minutos."
        : `Pausei as tarefas: o limite do plano acabou. Retomo sozinho por volta das ${clock(until)}.`, [origin]);
    },
    /** The open window's line for a task that cannot start now, or null when no window is open. */
    pauseLine: (title: string): string | null => until > 0 && deps.now() < until
      ? `Pausado pelo limite do plano: ${title}. ${known ? `Volta por volta das ${clock(until)}.` : "Tento retomar em 30 minutos."}`
      : null,
    blocked: () => until > 0 && deps.now() < until,
    paused: (threadId: string) => paused.has(threadId),
  };
}

export type PlanLimit = ReturnType<typeof createPlanLimit>;
