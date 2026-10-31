/** The wait before try number `attempt` (1-based) from a fixed schedule; past the end it keeps the last wait. */
export function computeBackoffSchedule(scheduleMs: readonly number[], attempt: number): number {
  if (attempt <= 0 || scheduleMs.length === 0) return 0;
  return scheduleMs[Math.min(attempt, scheduleMs.length) - 1] ?? 0;
}
