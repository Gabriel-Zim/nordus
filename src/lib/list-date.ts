import { activeLocale } from "./i18n";

const DAY = 24 * 60 * 60 * 1000;

function startOfDay(at: number): number {
  const date = new Date(at);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/**
 * The date on a bot's row, in the app's own language: the clock for today
 * ("14:05"), "ontem" for yesterday, the short weekday inside a week ("seg."),
 * then the day and short month ("22 out.").
 */
export function formatListDate(at: number, now: number = Date.now(), locale: string = activeLocale()): string {
  if (!Number.isFinite(at)) return "";
  try {
    const days = Math.round((startOfDay(now) - startOfDay(at)) / DAY);
    if (days <= 0) {
      const date = new Date(at);
      return `${date.getHours()}:${String(date.getMinutes()).padStart(2, "0")}`;
    }
    if (days === 1) return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(-1, "day");
    if (days < 7) return new Intl.DateTimeFormat(locale, { weekday: "short" }).format(at);
    const parts = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).formatToParts(at);
    const day = parts.find((part) => part.type === "day")?.value ?? "";
    const month = parts.find((part) => part.type === "month")?.value ?? "";
    return `${day} ${month}`.trim();
  } catch {
    return "";
  }
}
