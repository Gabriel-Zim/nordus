import type { Message } from "@/state/store";
import { activeLocale, t } from "@/lib/i18n";
import { lastNonReceipt } from "@/lib/receipts";

export interface TranscriptLookups {
  editVersions(message: Message): readonly Message[] | undefined;
  replyTarget(message: Message): Message | undefined;
  retryableId: string | undefined;
}

const sameAsk = (a: Message, b: Message): boolean =>
  a.text === b.text && a.replyToId === b.replyToId;

export function transcriptLookups(all: readonly Message[], branch: readonly Message[]): TranscriptLookups {
  const byId = new Map<string, Message>();
  const forks = new Map<string | null, Message[]>();
  const answered = new Set<string>();
  for (const message of all) {
    byId.set(message.id, message);
    if (message.parentId) answered.add(message.parentId);
    if (message.role !== "user" || message.kind !== "text") continue;
    const parent = message.parentId ?? null;
    const siblings = forks.get(parent);
    if (siblings) siblings.push(message);
    else forks.set(parent, [message]);
  }
  for (const [parent, siblings] of forks) {
    siblings.sort((a, b) => a.at - b.at);
    // A twin that nothing ever followed offers no other branch to page to: it is a resend, not a version.
    const versions = siblings.filter((message, index) => answered.has(message.id) ||
      !siblings.slice(index + 1).some((later) => sameAsk(message, later)));
    if (versions.length !== siblings.length) forks.set(parent, versions);
  }
  const retryableId = lastNonReceipt(branch)?.id;
  return {
    editVersions(message) {
      if (message.role !== "user" || message.kind !== "text") return undefined;
      const versions = forks.get(message.parentId ?? null);
      return versions && versions.length > 1 ? versions : undefined;
    },
    replyTarget: (message) => (message.replyToId ? byId.get(message.replyToId) : undefined),
    retryableId,
  };
}

export function localDay(at: number): number {
  const date = new Date(at);
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000;
}

let dates: { locale: string; format: (at: number) => string } | null = null;

export function dayLabel(at: number, today = localDay(Date.now())): string {
  const daysAgo = today - localDay(at);
  if (daysAgo === 0) return t("chat.day.today");
  if (daysAgo === 1) return t("chat.day.yesterday");
  // toLocaleDateString's output, where Intl.DateTimeFormat.format would throw
  if (Number.isNaN(daysAgo)) return "Invalid Date";
  const locale = activeLocale();
  if (dates?.locale !== locale) {
    const formatter = new Intl.DateTimeFormat(locale, { weekday: "short", month: "short", day: "numeric" });
    dates = { locale, format: (value) => formatter.format(value) };
  }
  return dates.format(at);
}
