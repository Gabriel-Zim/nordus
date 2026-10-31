// A routine run as its source conversation shows it: the card, and the plain text clients without cards read.
import type { Message } from "./store.ts";
import { redactSecretsInText } from "./redact.ts";
import type { RoutineRun } from "./routines.ts";

export function routineRunCard(run: RoutineRun): NonNullable<Message["routineRun"]> {
  const visibleSummary = run.status === "waiting" ? run.attention : run.output;
  const summary = visibleSummary ? redactSecretsInText(visibleSummary).slice(0, 2_000) : undefined;
  const error = run.error ? redactSecretsInText(run.error).slice(0, 500) : undefined;
  const card: NonNullable<Message["routineRun"]> = {
    runId: run.id,
    routineId: run.routineId,
    routineName: redactSecretsInText(run.routineName),
    scheduledFor: run.scheduledFor,
    status: run.status,
  };
  if (run.goalStatus) card.goalStatus = run.goalStatus;
  if (run.deferredAt != null && run.status === "queued") card.deferredAt = run.deferredAt;
  if (run.threadId) card.executionThreadId = run.threadId;
  if (summary) card.summary = summary;
  if (error) card.error = error;
  return card;
}

type RunCard = NonNullable<Message["routineRun"]>;
// Nordus: the plain text clients without cards read is in Portuguese.
const RUN_FALLBACK_STATE: Record<RunCard["status"], string> = {
  queued: "na fila",
  running: "rodando",
  waiting: "precisa da sua atenção",
  completed: "concluída",
  failed: "falhou",
  cancelled: "foi cancelada",
  missed: "foi perdida",
};
const GOAL_FALLBACK_STATE: Partial<Record<NonNullable<RunCard["goalStatus"]>, string>> = {
  "needs-input": "precisa da sua resposta",
  blocked: "ficou bloqueada",
  "limit-reached": "chegou ao limite",
  stopped: "foi interrompida",
  failed: "falhou",
};

export function routineRunFallbackText(card: RunCard): string {
  const state = (card.goalStatus && GOAL_FALLBACK_STATE[card.goalStatus])
    ?? (card.status === "queued" && card.deferredAt != null ? "adiada: destino ocupado" : RUN_FALLBACK_STATE[card.status]);
  const detail = card.summary ?? card.error;
  return `Rotina “${card.routineName}” ${state}${detail ? `\n\n${detail}` : ""}`;
}
