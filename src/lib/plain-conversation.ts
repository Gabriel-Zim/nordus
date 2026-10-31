import { t } from "@/lib/i18n";
import { handoffKind, handoffLabel } from "@/lib/handoff-label";
import type { Message } from "@/state/store";
import { plainChatText } from "../../shared/plain-chat-text";
import type { WorkStepLine } from "../../shared/work-steps";

/** What the Simple chat shows for a line the server writes about its own mechanics: nothing, or one plain sentence. */
export type PlainLine = { hide: true } | { say: string };

const HIDE: PlainLine = { hide: true };

const RULES: ReadonlyArray<{ pattern: RegExp; line: (match: RegExpExecArray) => PlainLine }> = [
  // The bot moved to a backup or back to its own account and carries on: nothing for the person to do.
  { pattern: /^recovery:/, line: () => HIDE },
  { pattern: /^Aprovado automaticamente:/, line: () => HIDE },
  { pattern: /^Liberado na conversa:/, line: () => HIDE },
  { pattern: /^Opened thread #/, line: () => HIDE },
  { pattern: /^Comecei em paralelo: (.+)$/s, line: (m) => ({ say: t("plain.parallel", { title: m[1]!.trim() }) }) },
  {
    pattern: /^(.+?) levou este pedido a você(?:: (.+))?$/s,
    line: (m) => ({ say: m[2] ? t("plain.leadAsksWhat", { name: m[1]!, what: m[2].trim() }) : t("plain.leadAsks", { name: m[1]! }) }),
  },
];

/** The Simple chat's reading of a server line that speaks mechanics; null for any other line. */
export function plainMechanicalLine(name: string): PlainLine | null {
  for (const { pattern, line } of RULES) {
    const match = pattern.exec(name);
    if (match) return line(match);
  }
  return null;
}

export function plainLineSays(name: string): boolean {
  const line = plainMechanicalLine(name);
  return Boolean(line && "say" in line);
}

/** A hand-off or thread chip the Simple chat shows: only when its words are the app's own, never the server's raw title. */
export function plainChipShown(message: Message): boolean {
  const name = message.tool?.name;
  if (!name) return false;
  if (name.startsWith("Incident:") || handoffKind(name) !== null) return true;
  return handoffLabel(name) !== name;
}

/** A failed turn the bot got past by itself: it answered again before the person wrote anything. */
export function recoveredAfter(transcript: readonly Message[], index: number): boolean {
  for (let i = index + 1; i < transcript.length; i += 1) {
    const row = transcript[i]!;
    if (row.role === "user") return false;
    if (row.role === "bot" && row.kind === "text" && row.turnTerminal && row.text?.trim()) return true;
  }
  return false;
}

const LINE_MAX = 110;

/** The bot's own first words of progress ("Avisando o GerenteDeOperacao e montando a conferência."), the one line a folded turn shows. */
export function narrationLine(messages: readonly Message[]): string | undefined {
  const first = messages.find((message) => message.text?.trim())?.text;
  if (!first) return undefined;
  const plain = plainChatText(first).replace(/[`*_#>]/g, "").replace(/\s+/g, " ").trim();
  const sentence = /^(.+?[.!?…])(?:\s|$)/u.exec(plain)?.[1] ?? plain;
  if (!sentence) return undefined;
  return sentence.length > LINE_MAX ? `${sentence.slice(0, LINE_MAX - 1).trimEnd()}…` : sentence;
}

/** The one live line the Simple chat shows while the bot works: its newest step in its own words, or "Trabalhando nisso". */
export function simpleWorkingLine(steps: readonly WorkStepLine[] | undefined): string {
  const step = steps?.findLast((line) => line.text?.trim())?.text;
  const plain = step ? plainChatText(step).replace(/[`*_#>]/g, "").replace(/\s+/g, " ").trim().replace(/[.!…:;,]+$/u, "") : "";
  if (!plain || /\/[\w.-]+\//.test(plain)) return t("chat.activity.onIt");
  return plain.length > LINE_MAX ? plain.slice(0, LINE_MAX).trimEnd() : plain;
}
