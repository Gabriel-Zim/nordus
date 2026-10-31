// The loop guard's notice row, in the plain English the server stores: the
// phones read it whole, and the app words it again in the reader's language.

const PATTERN = /^Same call repeated (\d+)× — (.*) — it may be stuck$/s;

export function repeatNotice(count: number, call: string): string {
  return `Same call repeated ${count}× — ${call} — it may be stuck`;
}

/** How many times the call repeated, or null for any other row. */
export function repeatNoticeCount(name: string): number | null {
  const match = PATTERN.exec(name);
  return match ? Number(match[1]) : null;
}
