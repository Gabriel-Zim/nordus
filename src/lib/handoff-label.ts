import { t } from "@/lib/i18n";
import { foldPerStretch } from "@/lib/stretch-fold";
import type { LocaleKey } from "@/locales";
import type { Message } from "@/state/store";

export type HandoffKind = "sent" | "back";

interface HandoffRule {
  pattern: RegExp;
  kind: HandoffKind;
  label: (match: RegExpExecArray) => string;
}

const named = (pattern: RegExp, key: LocaleKey): HandoffRule => ({ pattern, kind: "back", label: (m) => t(key, { name: m[1]! }) });

/** What the server writes when a bot hands work to another or the answer comes back. Order matters: a status line or a question
 *  can quote the word "replied", so those patterns come before the plain "replied". */
const HANDOFF_RULES: readonly HandoffRule[] = [
  named(/^Waiting on your answer in @(.+)$/, "handoff.waitingAnswer"),
  named(/^Waiting on your approval in @(.+)$/, "handoff.waitingApproval"),
  named(/^Nobody answered @(.+?)'s question in time$/, "handoff.answerTimeout"),
  named(/^Nobody answered @(.+?)'s approval in time — that step did not run$/, "handoff.approvalTimeout"),
  named(/^@(.+?)'s turn ended before anyone answered its question$/, "handoff.turnEnded"),
  named(/^@(.+?)'s approval closed before anyone answered — that step did not run$/, "handoff.approvalClosed"),
  named(/^@(.+?)'s question was dismissed$/, "handoff.dismissed"),
  named(/^@(.+?)'s request was denied$/, "handoff.denied"),
  named(/^@(.+?) got your answer$/, "handoff.gotAnswer"),
  named(/^@(.+?) got your approval$/, "handoff.gotApproval"),
  named(/^@(.+?)'s question was answered$/, "handoff.wasAnswered"),
  named(/^@(.+?)'s request was approved$/, "handoff.wasApproved"),
  {
    pattern: /^(.+?) needs your input: (.*)$/s,
    kind: "back",
    label: (m) => t("handoff.needsInput", { name: m[1]!, question: m[2]! }),
  },
  {
    pattern: /^(.+?) — ([a-z]+):\s*(.*)$/s,
    kind: "back",
    label: (m) => {
      const [name, status, detail] = [m[1]!, m[2]!, m[3]!];
      const key = status === "failed" ? "handoff.failed" : status === "cancelled" ? "handoff.cancelled" : "handoff.stopped";
      return t(key, { name, detail }).replace(/:\s*$/, "");
    },
  },
  {
    pattern: /^(.+?) was cut off by a restart; resuming$/,
    kind: "back",
    label: (m) => t("handoff.cutOff", { name: m[1]! }),
  },
  {
    pattern: /^Result withheld: (.*)$/s,
    kind: "back",
    label: (m) => t("handoff.withheld", { reason: m[1]! }),
  },
  {
    pattern: /^Sent to (.+?)(?: · (.+))?$/,
    kind: "sent",
    label: (m) => (m[2] ? t("handoff.sentIn", { name: m[1]!, room: m[2] }) : t("handoff.sent", { name: m[1]! })),
  },
  {
    pattern: /^(.+?) replied(?: · (.+))?$/,
    kind: "back",
    label: (m) => (m[2] ? t("handoff.repliedIn", { name: m[1]!, room: m[2] }) : t("handoff.replied", { name: m[1]! })),
  },
];

const matchRule = (toolName: string) => {
  for (const rule of HANDOFF_RULES) {
    const match = rule.pattern.exec(toolName);
    if (match) return { rule, match };
  }
  return null;
};

/** "sent" for a request going out, "back" for anything coming back from the other bot, null for a row that is not a hand-off between bots. */
export function handoffKind(toolName: string): HandoffKind | null {
  return matchRule(toolName)?.rule.kind ?? null;
}

/** The server titles hand-off rows in English ("Sent to Ops · Room", "Ops replied · Room"); show them in the person's language. */
export function handoffLabel(name: string): string {
  const found = matchRule(name);
  if (found) return found.rule.label(found.match);
  const resumed = /^Resumed with (.+?) results?\b/.exec(name);
  if (resumed) return t("handoff.resumed", { name: resumed[1]! });
  const brief = /^(.+?)'s recent-work brief\b/.exec(name);
  if (brief) return t("handoff.recentWork");
  const openedOn = /^Opened thread #(.+) on (.+)$/.exec(name);
  if (openedOn) return t("handoff.openedThreadOn", { title: openedOn[1]!, name: openedOn[2]! });
  const posted = /^Posted in (.+)$/.exec(name);
  if (posted) return t("handoff.posted", { room: posted[1]! });
  return name;
}

/** The visible text of a hand-off pill: who the conversation is with, never what the last line said (that goes in the tooltip). */
export function handoffLine(toolName: string, count: number, name: string): string {
  if (count > 1) return t("handoff.messages", { count, name });
  return handoffKind(toolName) === "back" ? t("handoff.messageFrom", { name }) : t("handoff.messageTo", { name });
}

function conversationKey(message: Message): string | null {
  if (message.threadRef) return `${message.threadRef.botId}:${message.threadRef.threadId}`;
  if (message.comm) return `${message.comm.groupId}:${message.comm.threadId ?? ""}:${message.comm.withBotId}`;
  return null;
}

/** The files the lines folded into one pill carry, per line, each file once (the first line to carry it keeps it). */
export interface FoldedAttachments {
  messageId: string;
  attachments: NonNullable<Message["attachments"]>;
}

/** One pill per conversation between two bots, per stretch between the person's messages: the newest line carries the count and
 *  the earlier ones fold away, so five "needs your input" and three failures read as one line. The files of every line in the
 *  fold are listed under the newest one, so a fold never hides an image. */
export function foldHandoffs(messages: readonly Message[]): {
  counts: ReadonlyMap<string, number>;
  folded: ReadonlySet<string>;
  attachments: ReadonlyMap<string, readonly FoldedAttachments[]>;
} {
  const { counts, folded, members } = foldPerStretch(messages, (message) =>
    message.kind === "activity" && message.tool && handoffKind(message.tool.name) !== null ? conversationKey(message) : null);
  const byId = new Map(messages.map((message) => [message.id, message]));
  const attachments = new Map<string, readonly FoldedAttachments[]>();
  for (const [newest, ids] of members) {
    const seen = new Set<string>();
    const lines: FoldedAttachments[] = [];
    for (const id of ids) {
      const fresh = (byId.get(id)?.attachments ?? []).filter((attachment) => !seen.has(attachment.path) && seen.add(attachment.path));
      if (fresh.length) lines.push({ messageId: id, attachments: fresh });
    }
    if (lines.length) attachments.set(newest, lines);
  }
  return { counts, folded, attachments };
}

export const HANDOFF_ROW = "flex justify-center";

export const HANDOFF_PILL =
  "inline-flex max-w-full items-center gap-1.5 rounded-md py-0.5 text-[12.5px] text-ink-tertiary transition-colors hover:text-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60";
