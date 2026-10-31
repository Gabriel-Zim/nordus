// Nordus: a team leader is the person's only voice, so its own task brings home, to the conversation it was opened
// from, what the person must see or answer there; the answers given at home go back to the task.
import { isPersistentQuestionCard } from "../shared/ask-question.ts";
import { widgetActions, type WidgetPayload } from "../shared/widget.ts";
import type { Message, Store } from "./store.ts";

export type TaskHomeStore = Pick<Store, "bot" | "taskByThread" | "activePath" | "messagesFor" | "appendMessage" | "patchMessage">;

/** The conversation a team leader's own task was opened from, while both exist. */
export function taskHome(store: TaskHomeStore, botId: string, threadId: string): string | undefined {
  if (!store.bot(botId)?.teamLead) return undefined;
  const opener = store.taskByThread(botId, threadId)?.openedBy;
  if (opener?.botId !== botId || opener.kind || !opener.threadId || opener.threadId === threadId) return undefined;
  return store.taskByThread(botId, opener.threadId) ? opener.threadId : undefined;
}

const asksSomething = (widget: WidgetPayload | undefined): boolean =>
  Boolean(widget && !widget.settled && widgetActions(widget.root).some((entry) => !entry.client));

const copied = (home: Message[], messageId: string): boolean => home.some((message) => message.fromTask?.messageId === messageId);

const attached = (message: Message) => message.role === "bot" && message.kind === "text" && Boolean(message.attachments?.length);

/** What the task holds since the person last wrote there. */
function sinceTheirWord(store: TaskHomeStore, taskThreadId: string): Message[] {
  const path = store.activePath(taskThreadId);
  return path.slice(path.findLastIndex((message) => message.role === "user") + 1);
}

/** Copies `messages` of the task home, skipping any already there; the words brought ("" for none), or undefined. */
function copyHome(store: TaskHomeStore, input: { botId: string; taskThreadId: string; home: string }, messages: Message[]): string | undefined {
  const title = store.taskByThread(input.botId, input.taskThreadId)?.title ?? "";
  const already = store.messagesFor(input.home);
  let brought: string | undefined;
  for (const message of messages) {
    if (copied(already, message.id)) continue;
    store.appendMessage(input.home, {
      role: "bot", kind: message.kind, ...(message.text ? { text: message.text } : {}),
      ...(message.widget ? { widget: structuredClone(message.widget) } : {}),
      ...(message.attachments?.length ? { attachments: structuredClone(message.attachments) } : {}),
      fromTask: { threadId: input.taskThreadId, messageId: message.id, title },
    });
    brought = message.text || brought || "";
  }
  return brought;
}

/**
 * Copies home, in their order, what the task showed the person since they last wrote there: the files it attached (the
 * light version shown with the approval card), its open widgets and the last words of the turn `turnId`. A turn that
 * handed work out and asks nothing (`final` false) brings nothing home. Copying twice copies nothing more. Returns the
 * words brought home ("" for files or a widget without any), or undefined when nothing was.
 */
export function reportHome(store: TaskHomeStore, input: { botId: string; taskThreadId: string; turnId: string; final: boolean }): string | undefined {
  const home = taskHome(store, input.botId, input.taskThreadId);
  if (!home) return undefined;
  const since = sinceTheirWord(store, input.taskThreadId);
  const widgets = since.filter((message) => message.kind === "widget" && asksSomething(message.widget));
  if (!input.final && !widgets.length) return undefined;
  const words = since.findLast((message) => message.role === "bot" && message.kind === "text" && message.turnId === input.turnId &&
    (Boolean(message.text?.trim()) || Boolean(message.attachments?.length)));
  return copyHome(store, { ...input, home }, since.filter((message) => widgets.includes(message) || message === words || attached(message)));
}

/** Copies home the files the task attached since the person last wrote there, so what a card asks about arrives first. */
export function bringFilesHome(store: TaskHomeStore, botId: string, taskThreadId: string): void {
  const home = taskHome(store, botId, taskThreadId);
  if (home) copyHome(store, { botId, taskThreadId, home }, sinceTheirWord(store, taskThreadId).filter(attached));
}

const ABOUT = "Sobre a tarefa \"";

/**
 * Before a card the task's engine raises at home: the line naming the task, unless the last such line since the person
 * last wrote there already names it (the client shows nothing else of where a card comes from), then the task's files.
 */
export function announceHome(store: TaskHomeStore, botId: string, taskThreadId: string, botName: string): void {
  const home = taskHome(store, botId, taskThreadId);
  if (!home) return;
  const about = `${ABOUT}${store.taskByThread(botId, taskThreadId)?.title?.trim() || botName}":`;
  const path = store.activePath(home);
  const last = path.slice(path.findLastIndex((line) => line.role === "user") + 1)
    .findLast((line) => line.role === "bot" && line.kind === "text" && line.text?.startsWith(ABOUT));
  if (last?.text !== about) store.appendMessage(home, { role: "bot", kind: "text", text: about });
  bringFilesHome(store, botId, taskThreadId);
}

/** Whether `home` holds an open question a leader's own task asked there: one answered later still reaches the task. */
export function homeHasOpenQuestionCard(store: TaskHomeStore, home: string): boolean {
  return store.messagesFor(home).some((message) => {
    const card = message.card;
    return Boolean(card?.requestId && card.relayFor && !card.answered && !card.dismissed && isPersistentQuestionCard(card) &&
      taskHome(store, card.relayFor.botId, card.relayFor.threadId) === home);
  });
}

/** A leader task's card at home for the live request `requestId`. */
export function homeCard(store: TaskHomeStore, botId: string, taskThreadId: string, requestId: string): Message | undefined {
  const home = taskHome(store, botId, taskThreadId);
  return home ? store.messagesFor(home).find((message) => message.card?.requestId === requestId && message.card.relayFor?.threadId === taskThreadId) : undefined;
}

/** Whether the task's own widget still waits: unanswered, and the person has not written in the task since. */
function stillAsked(store: TaskHomeStore, taskThreadId: string, messageId: string): boolean {
  const path = store.activePath(taskThreadId);
  const at = path.findIndex((message) => message.id === messageId);
  return at >= 0 && asksSomething(path[at]!.widget) && !path.slice(at + 1).some((message) => message.role === "user");
}

/** The tasks whose copied questions still wait at `home`, newest first: each a copied widget still asked in its task. */
export function openHomeQuestions(store: TaskHomeStore, home: string): string[] {
  const open: string[] = [];
  for (const message of [...store.activePath(home)].reverse()) {
    const from = message.fromTask;
    if (!from || message.kind !== "widget" || !asksSomething(message.widget) || open.includes(from.threadId)) continue;
    if (stillAsked(store, from.threadId, from.messageId)) open.push(from.threadId);
  }
  return open;
}

/** The task that words typed at `home` answer: the one whose copy they reply to, else the only question still open
 * there. With two or more open and no reply, the words stay home: a guess could hand one client's answer to another. */
export function homeAnswerTask(store: TaskHomeStore, botId: string, home: string, replyToId: unknown): string | undefined {
  if (typeof replyToId === "string" && replyToId) {
    const from = store.messagesFor(home).find((message) => message.id === replyToId)?.fromTask;
    return from && store.taskByThread(botId, from.threadId) ? from.threadId : undefined;
  }
  const open = openHomeQuestions(store, home);
  return open.length === 1 ? open[0] : undefined;
}

/** A press on a copied widget, aimed at the task's own widget. */
export function homePress(store: TaskHomeStore, home: string, widgetAction: unknown):
  { threadId: string; widgetAction: Record<string, unknown> } | undefined {
  if (!widgetAction || typeof widgetAction !== "object" || Array.isArray(widgetAction)) return undefined;
  const press = widgetAction as Record<string, unknown>;
  const copy = store.messagesFor(home).find((message) => message.id === press.messageId && message.kind === "widget");
  if (!copy?.fromTask) return undefined;
  return { threadId: copy.fromTask.threadId, widgetAction: { ...press, messageId: copy.fromTask.messageId } };
}

/** The copies at home of the task's widget `messageId` show the answer it took. */
export function settleCopies(store: TaskHomeStore, botId: string, taskThreadId: string, messageId: string): void {
  const home = taskHome(store, botId, taskThreadId);
  const settled = home && store.messagesFor(taskThreadId).find((message) => message.id === messageId)?.widget?.settled;
  if (!home || !settled) return;
  for (const copy of store.messagesFor(home)) {
    if (copy.fromTask?.threadId !== taskThreadId || copy.fromTask.messageId !== messageId || !copy.widget || copy.widget.settled) continue;
    store.patchMessage(home, copy.id, { widget: { ...copy.widget, settled: structuredClone(settled) } });
  }
}

const MAX_HOPS = 4;

/**
 * The person's conversation above work another bot sent to `botId` in `threadId`: up the bots that opened it, to the
 * first conversation no other bot opened. Undefined in a conversation no other bot opened, or when the way up leaves
 * the bots' own conversations (a room) or is gone.
 */
export function peerHome(store: Pick<Store, "taskByThread">, botId: string, threadId: string): string | undefined {
  let owner = botId;
  let thread = threadId;
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    const opener = store.taskByThread(owner, thread)?.openedBy;
    if (!opener || opener.botId === owner || !opener.threadId) return hop === 0 ? undefined : thread;
    if (!store.taskByThread(opener.botId, opener.threadId)) return undefined;
    owner = opener.botId;
    thread = opener.threadId;
  }
  return undefined;
}
