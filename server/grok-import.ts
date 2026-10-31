// Grok Bot history, copied once into its own conversation beside the bot's or room's live one.
// Written straight into the transcript store (like a team backup restore): no turn starts, nothing
// is queued, the conversation is never activated and never marked unread.
import { newId } from "./contracts.ts";
import type { Message, Store } from "./store.ts";

export const GROK_IMPORT_MAX_MESSAGES = 20_000;
const MAX_TEXT = 60_000;

export interface GrokImportLine {
  role: "user" | "bot";
  text: string;
  /** Epoch milliseconds of the original line. */
  at: number;
  /** Who wrote it, when not the person (user lines) or the bot itself (bot lines). In a room, a member's name. */
  sender?: string;
}

export interface GrokImportInput {
  target: { kind: "bot" | "group"; id: string };
  title: string;
  lines: GrokImportLine[];
}

export class GrokImportError extends Error {
  readonly status: 400 | 404 | 409;
  constructor(status: 400 | 404 | 409, message: string) {
    super(message);
    this.status = status;
  }
}

export function parseGrokImport(body: unknown): GrokImportInput {
  const value = body as Partial<GrokImportInput> | null;
  const kind = value?.target?.kind;
  const id = value?.target?.id;
  if ((kind !== "bot" && kind !== "group") || typeof id !== "string" || !id) throw new GrokImportError(400, "Escolha o robô ou a sala de destino.");
  const title = typeof value?.title === "string" ? value.title.trim().slice(0, 80) : "";
  if (!title) throw new GrokImportError(400, "Dê um título à conversa importada.");
  if (!Array.isArray(value?.lines) || !value.lines.length) throw new GrokImportError(400, "Não há mensagens para importar.");
  if (value.lines.length > GROK_IMPORT_MAX_MESSAGES) throw new GrokImportError(400, "Conversa grande demais para uma importação.");
  const lines = value.lines.map((line, index): GrokImportLine => {
    if ((line?.role !== "user" && line?.role !== "bot") || typeof line.text !== "string" || !Number.isFinite(line.at)) {
      throw new GrokImportError(400, `Mensagem ${index + 1} inválida.`);
    }
    const sender = typeof line.sender === "string" && line.sender.trim() ? line.sender.trim().slice(0, 80) : undefined;
    return { role: line.role, text: line.text.slice(0, MAX_TEXT), at: Math.trunc(line.at), ...(sender ? { sender } : {}) };
  });
  return { target: { kind, id }, title, lines };
}

/** Additive and once per title: a second import of the same conversation is refused, never duplicated. */
export function importGrokHistory(store: Store, input: GrokImportInput): { threadId: string; imported: number } {
  const { target } = input;
  const bot = target.kind === "bot" ? store.bot(target.id) : undefined;
  const group = target.kind === "group" ? store.group(target.id) : undefined;
  if (!bot && !group) throw new GrokImportError(404, "Robô ou sala não encontrado.");
  const existing = bot ? bot.tasks ?? [] : group!.tasks ?? [];
  if (existing.some((task) => task.title === input.title)) throw new GrokImportError(409, "Essa conversa já foi importada.");

  const members = new Map((group ? group.memberIds : []).flatMap((botId) => {
    const member = store.bot(botId);
    return member ? [[member.name.trim().toLowerCase(), member] as const] : [];
  }));
  // Stable by time: equal stamps keep the export's order.
  const ordered = input.lines.map((line, index) => ({ line, index })).sort((a, b) => a.line.at - b.line.at || a.index - b.index);
  let parentId: string | null = null;
  const messages: Message[] = ordered.map(({ line }) => {
    const member = group && line.role === "bot" && line.sender ? members.get(line.sender.toLowerCase()) : undefined;
    const message: Message = {
      id: newId(),
      role: line.role,
      kind: "text",
      text: line.sender && !member ? `${line.sender}:\n${line.text}` : line.text,
      at: line.at,
      parentId,
      imported: { source: "grok", ...(line.sender ? { sender: line.sender } : {}) },
      ...(member ? { from: { botId: member.id, name: member.name, color: member.color } } : {}),
    };
    parentId = message.id;
    return message;
  });

  const task = bot ? store.createTask(bot.id, input.title, false) : store.createGroupTask(group!.id, input.title, false);
  if (!task) throw new GrokImportError(404, "Robô ou sala não encontrado.");
  store.importTranscript(task.threadId, messages, parentId);
  store.markImportedThread(target, task.threadId);
  return { threadId: task.threadId, imported: messages.length };
}
