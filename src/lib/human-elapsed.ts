import { t } from "@/lib/i18n";

const AGO = ["workingNow.agoSeconds", "workingNow.agoMinutes", "workingNow.agoHours"] as const;
const TOOK = ["workingNow.tookSeconds", "workingNow.tookMinutes", "workingNow.tookHours"] as const;

function inWords(ms: number, [seconds, minutes, hours]: typeof AGO | typeof TOOK): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  if (total < 60) return t(seconds, { count: total });
  const whole = Math.floor(total / 60);
  if (whole < 60) return t(minutes, { count: whole });
  return t(hours, { hours: Math.floor(whole / 60), minutes: String(whole % 60).padStart(2, "0") });
}

/** "há 16 s", "há 3 min", "há 1 h 05 min": how long, in words a person reads at a glance. */
export function humanElapsed(ms: number): string {
  return inWords(ms, AGO);
}

/** "16 s", "12 min", "1 h 05 min": how long a step took. */
export function humanDuration(ms: number): string {
  return inWords(ms, TOOK);
}
