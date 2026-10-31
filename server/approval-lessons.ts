// Nordus: a person's "why not" on a declined approval becomes a lesson the bot can keep, through the same card as any proposed lesson.
import { randomUUID } from "node:crypto";
import { DECLINE_REASON_MAX } from "../shared/approvals.ts";
import type { Message } from "./store.ts";

const LESSON_MAX = 300;
const QUOTE_MAX = 80;
const QUOTE_MIN = 12;
const NAME_MAX = 40;

export function tidyReason(reason: unknown): string {
  return typeof reason === "string" ? reason.replace(/\s+/g, " ").trim().slice(0, DECLINE_REASON_MAX) : "";
}

/** One line, with nothing that could close a quote or a bracket, start a line of its own or run past `max`. */
function plain(text: string, max: number): string {
  const flat = text.replace(/[\p{Cc}\p{Cf}“”"()]/gu, " ").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/** The person's own words come first and whole. What the agent said it was doing is the agent's to write, so it follows only as a short
 * quote, and is left out when there is no room: it never pushes the person's words out. */
export function refusalLesson(input: { person: string; intent?: string; reason: string }): string {
  const reason = input.reason.replace(/\s+/g, " ").trim().slice(0, LESSON_MAX);
  const who = plain(input.person, NAME_MAX) || "Alguém";
  const bare = `(${who} recusou)`;
  const space = LESSON_MAX - reason.length - 1;
  const quoteRoom = Math.min(QUOTE_MAX, space - bare.length - 3);
  const quote = quoteRoom >= QUOTE_MIN ? plain(input.intent ?? "", quoteRoom) : "";
  const tail = quote ? `(${who} recusou “${quote}”)` : bare;
  if (tail.length > space) return reason;
  return reason ? `${reason} ${tail}` : tail;
}

export interface RefusalLessonDeps {
  appendMessage(threadId: string, message: Omit<Message, "id" | "at">): Message;
  recordShown?: (row: { threadId: string; requestId: string; botId: string; botName: string; summary: string }) => void;
}

export interface RefusalLessonInput {
  threadId: string;
  bot: { id: string; name: string; color: string };
  speaker: boolean;
  person: string;
  intent?: string;
  reason: string;
}

export function proposeLessonFromRefusal(deps: RefusalLessonDeps, input: RefusalLessonInput): { messageId: string; requestId: string; lesson: string } | null {
  const reason = tidyReason(input.reason);
  if (!reason) return null;
  const lesson = refusalLesson({ person: input.person, intent: input.intent, reason });
  const requestId = randomUUID();
  const message = deps.appendMessage(input.threadId, {
    role: "bot",
    kind: "options",
    ...(input.speaker ? { from: { botId: input.bot.id, name: input.bot.name, color: input.bot.color } } : {}),
    card: {
      title: "Proposed lesson",
      subtitle: lesson,
      options: ["Make it a rule", "Discard"],
      requestId,
      tool: "propose_lesson",
      lessonRequest: { lesson },
      approval: { fromRefusal: true },
    },
  });
  deps.recordShown?.({ threadId: input.threadId, requestId, botId: input.bot.id, botName: input.bot.name, summary: lesson });
  return { messageId: message.id, requestId, lesson };
}
