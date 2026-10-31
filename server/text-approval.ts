// Nordus: a yes-or-no card meant for a person is asked in the conversation, as a line of the bot, and the person's
// typed answer answers the card through the same route a click takes. The card stays as the record of the decision
// and for the notification; clients do not draw it.
import { classifyReply, type Reply } from "./conversation-approval.ts";
import type { OptionCardData } from "../shared/wire.ts";
import type { Message, Store } from "./store.ts";

export type TextAskStore = Pick<Store, "messagesFor" | "activePath" | "appendMessage" | "patchMessage" | "botByThread" | "taskByThread" | "groupByThread">;

/** The labels of every card whose whole answer is allow or deny. */
const YES_NO = new Set(["Allow", "Deny", "Always allow", "Confirm", "Cancel", "Make it a rule", "Discard", "Permitir", "Negar", "Sempre permitir", "Confirmar", "Cancelar"]);
/** Security invariant: a line typed while the question was only just drawn may answer something else. */
export const MIN_SEEN_MS = 1_500;
const MAX_DETAIL = 400;

const open = (card: OptionCardData | undefined): card is OptionCardData =>
  Boolean(card?.requestId && !card.answered && !card.dismissed && !card.expired && !card.autoApplied);

/** A card a yes or a no answers whole. A skill is approved for the exact text the card shows, so it keeps its card. */
export function textAskable(card: OptionCardData | undefined): card is OptionCardData {
  return open(card) && !card.byText && !card.questionRequest && !card.quotaSwitch && !card.skillRequest && !card.releasedTask &&
    card.options.every((option) => YES_NO.has(option));
}

/** A conversation the person holds with the bot: not a room, a routine's run, or work another bot sent there. */
export function personConversation(store: TextAskStore, threadId: string): boolean {
  if (store.groupByThread(threadId)) return false;
  const bot = store.botByThread(threadId);
  if (!bot) return false;
  const task = store.taskByThread(bot.id, threadId);
  if (task?.routineRunId) return false;
  return !task?.openedBy || task.openedBy.botId === bot.id;
}

const plain = (text: string | undefined): string =>
  (text ?? "").replace(/\s*[—–]\s*/g, ", ").replace(/\s+/g, " ").trim();

const clip = (text: string): string => text.length > MAX_DETAIL ? `${text.slice(0, MAX_DETAIL - 1).trimEnd()}…` : text;

const sentence = (text: string): string => /[.!?…:]$/.test(text) ? text : `${text}.`;

/** What the bot says to ask for the card's answer, in Brazilian Portuguese, showing what the answer decides. */
export function askText(card: OptionCardData, fallback?: string): string {
  const intent = plain(card.intent);
  const detail = clip(plain(card.subtitle));
  if (card.relayFor) {
    return `${card.relayFor.name} precisa do seu ok para ${intent || plain(fallback) || "seguir com uma ação"}. Libero?`;
  }
  if (card.lessonRequest) return `Quer que eu guarde isto como regra: "${clip(plain(card.lessonRequest.lesson))}"?`;
  if (card.outboundRequest) return `Vou enviar em seu nome: ${sentence(detail || plain(fallback) || "a mensagem")} Posso mandar?`;
  const lead = plain(card.explanation) || (intent ? `Quero ${intent}.` : "") ||
    (card.tool && card.requestType !== "question" ? `Preciso do seu ok para ${plain(fallback) || "seguir com uma ação"}${detail ? `: ${detail}` : ""}` : "") ||
    `${plain(card.title)}${detail ? `: ${detail}` : ""}`;
  return `${sentence(lead)} Posso seguir?`;
}

/** Marks the card in `message` as one asked in words, so clients stop drawing it; false when it stays a card. */
export function holdForText(store: TextAskStore, threadId: string, message: Message): boolean {
  const card = message.card;
  if (message.kind !== "options" || !textAskable(card) || !personConversation(store, threadId)) return false;
  store.patchMessage(threadId, message.id, { card: { ...card, byText: true } });
  return true;
}

/** The bot's line asking for the held card `messageId`, unless the card was settled meanwhile. */
export function postAsk(store: TextAskStore, threadId: string, messageId: string, speaker: Message["from"], fallback?: string): Message | undefined {
  const card = store.messagesFor(threadId).find((message) => message.id === messageId)?.card;
  if (!open(card) || !card.byText) return undefined;
  return store.appendMessage(threadId, {
    role: "bot", kind: "text", text: askText(card, fallback), textAsk: { requestId: card.requestId! }, ...(speaker ? { from: speaker } : {}),
  });
}

/** Holds the card and asks for it at once. */
export function askByText(store: TextAskStore, threadId: string, message: Message, speaker: Message["from"], fallback?: string): Message | undefined {
  return holdForText(store, threadId, message) ? postAsk(store, threadId, message.id, speaker, fallback) : undefined;
}

const isBotLine = (message: Message) => message.role === "bot" && message.kind === "text" && Boolean(message.text) && !message.quickAck;

const cardOf = (store: TextAskStore, threadId: string, requestId: string) =>
  store.messagesFor(threadId).find((message) => message.card?.requestId === requestId)?.card;

/** The person's line as the route received it. */
export interface TypedLine {
  text: string;
  sender?: Message["sender"];
  peerAsk?: unknown;
  relayed?: boolean;
  queued?: boolean;
}

/**
 * The card a line typed now answers, and how: the question must be the conversation's last bot line asking anything,
 * still open, on screen for a moment, and the line must come from an admin person typing in the conversation.
 * Security invariant: a bot's words (peerAsk), a relayed or queued line, or a member's line never answer a card.
 */
export function textAnswer(store: TextAskStore, threadId: string, line: TypedLine, now = Date.now()): { requestId: string; reply: Reply } | undefined {
  if (line.peerAsk || line.relayed || line.queued || line.sender?.admin !== true || !line.text.trim()) return undefined;
  const asked = store.activePath(threadId).findLast((message) => isBotLine(message) && (message.textAsk !== undefined || message.text!.includes("?")));
  if (!asked?.textAsk || now - asked.at < MIN_SEEN_MS) return undefined;
  const requestId = asked.textAsk.requestId;
  const card = cardOf(store, threadId, requestId);
  if (!open(card) || !card.byText) return undefined;
  return { requestId, reply: classifyReply(line.text, asked.text!) };
}

/** After an answer, the next card still waiting in the conversation is asked again, so the next yes is about it. */
export function askNextOpen(store: TextAskStore, threadId: string, answered: string): Message | undefined {
  const lines = store.activePath(threadId).filter((message) => message.textAsk && message.textAsk.requestId !== answered);
  const waiting = lines.findLast((message) => open(cardOf(store, threadId, message.textAsk!.requestId)));
  if (!waiting) return undefined;
  return store.appendMessage(threadId, {
    role: "bot", kind: "text", text: waiting.text!, textAsk: { requestId: waiting.textAsk!.requestId }, ...(waiting.from ? { from: waiting.from } : {}),
  });
}
