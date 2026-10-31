import { t } from "./i18n";
import { webhookMessageView } from "./webhook-message";

/** What started a turn that no person typed: an email that arrived, another webhook, or a routine. */
export type TriggerLine =
  | { kind: "email"; from: string; subject: string }
  | { kind: "webhook"; name: string | null }
  | { kind: "routine"; name: string };

const ROUTINE_HEADER = /^\[(?:Scheduled routine|Routine) ("(?:[^"\\]|\\.)*") — do this now:\]\n/;

type Fields = Record<string, unknown>;
const str = (value: unknown) => typeof value === "string" ? value.trim() : "";

function firstText(record: Fields, keys: readonly string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (value && typeof value === "object") {
      const nested = value as Fields;
      const named = str(nested.name) || str(nested.nome) || str(nested.email) || str(nested.address);
      if (named) return named;
    }
  }
  return "";
}

function emailOf(payload: string): { from: string; subject: string } | null {
  let parsed: unknown;
  try { parsed = JSON.parse(payload); } catch { return null; }
  if (!parsed || typeof parsed !== "object") return null;
  const candidates = [parsed as Fields, ...Object.values(parsed as Fields).filter((value): value is Fields => Boolean(value) && typeof value === "object" && !Array.isArray(value))];
  for (const record of candidates) {
    const subject = firstText(record, ["assunto", "subject"]);
    const from = firstText(record, ["de_nome", "from_name", "fromName", "de_email", "from_email", "from", "de", "sender"]);
    if (subject || (from && ("assunto" in record || "subject" in record))) return { from, subject };
  }
  return null;
}

export function triggerLine(text: string | undefined): TriggerLine | null {
  if (!text) return null;
  const routine = ROUTINE_HEADER.exec(text);
  if (routine) {
    try { return { kind: "routine", name: JSON.parse(routine[1]!) as string }; } catch { return { kind: "routine", name: routine[1]!.slice(1, -1) }; }
  }
  if (!text.includes("[UNTRUSTED WEBHOOK EVENT DATA]")) return null;
  const view = webhookMessageView(text);
  const email = view?.payload ? emailOf(view.payload) : null;
  if (email) return { kind: "email", ...email };
  const event = /\nEvent: ([^\n]+)/.exec(text)?.[1]?.trim();
  return { kind: "webhook", name: event || null };
}

/** The one quiet line a trigger reads as, in the chat and in the sidebar preview. */
export function triggerLabel(trigger: TriggerLine): string {
  if (trigger.kind === "email") {
    const subject = trigger.subject || t("chat.trigger.noSubject");
    return trigger.from ? t("chat.trigger.emailFrom", { from: trigger.from, subject }) : t("chat.trigger.email", { subject });
  }
  if (trigger.kind === "routine") return t("chat.trigger.routine", { name: trigger.name });
  return trigger.name ? t("chat.trigger.webhookNamed", { name: trigger.name }) : t("chat.trigger.webhook");
}
