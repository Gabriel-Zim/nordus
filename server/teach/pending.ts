// Nordus: ensinar uma tarefa (frente G). A pergunta "Salvo como tarefa?" fica pendente na conversa ate a pessoa responder (ou 24 h).
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { TeachRecording } from "../../shared/teach.ts";
import type { TeachDraft } from "./draft.ts";

export interface PendingTeach {
  botId: string;
  threadId: string;
  recId: string;
  draft: TeachDraft;
  askedMessageId: string;
  at: number;
}

export const PENDING_TTL_MS = 24 * 60 * 60_000;
const ID_RE = /^[\w-]{1,64}$/;

export type TeachReply = "yes" | "no" | { change: string } | "other";

const CHANGE_START = /^(muda|mude|mudar|troca|troque|trocar|altera|altere|alterar|ajusta|ajuste|ajustar|corrige|corrija|corrigir|na verdade|mas)\b/;
const CHANGE_WORD = /\b(mas|muda|mude|troca|troque|altera|altere|ajusta|ajuste|corrige|corrija|na verdade)\b/;
const YES_START = /^(sim|s|pode( salvar| sim)?|salva|salvar|isso( mesmo)?|ok|okay|beleza|manda ver|yes|claro|combinado)\b/;
const NO_START = /^(nao|no|descarta|descartar|esquece|cancela|cancelar)\b/;
const NO_WHOLE = /^(deixa|deixa pra la|deixa para la|deixa quieto)$/;

function plain(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

/** Como a pessoa respondeu a "Salvo como tarefa?". */
export function classifyTeachReply(text: string): TeachReply {
  const norm = plain(text);
  if (!norm) return "other";
  const words = norm.split(" ").length;
  if (CHANGE_START.test(norm)) return { change: text.trim() };
  if (NO_WHOLE.test(norm)) return "no";
  if (words <= 4 && NO_START.test(norm)) return CHANGE_WORD.test(norm.replace(NO_START, "")) ? { change: text.trim() } : "no";
  if (YES_START.test(norm)) {
    if (CHANGE_WORD.test(norm.replace(YES_START, ""))) return { change: text.trim() };
    if (words <= 4) return "yes";
  }
  return "other";
}

/** Pendentes por conversa, em dir/pending.json. */
export class TeachPendingStore {
  private file: string;
  private now: () => number;
  constructor(dir: string, now: () => number = Date.now) { this.file = join(dir, "pending.json"); this.now = now; }

  private read(): PendingTeach[] {
    try {
      const raw = JSON.parse(readFileSync(this.file, "utf8")) as unknown;
      return Array.isArray(raw) ? (raw as PendingTeach[]).filter((p) => p && typeof p.botId === "string" && typeof p.threadId === "string" && this.now() - p.at < PENDING_TTL_MS) : [];
    } catch { return []; }
  }

  private write(list: PendingTeach[]): void {
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(list), { mode: 0o600 });
    renameSync(tmp, this.file);
  }

  get(botId: string, threadId: string): PendingTeach | null {
    return this.read().find((p) => p.botId === botId && p.threadId === threadId) ?? null;
  }

  /** Um pendente por conversa: o novo troca o antigo. */
  set(entry: PendingTeach): void {
    this.write([...this.read().filter((p) => !(p.botId === entry.botId && p.threadId === entry.threadId)), entry]);
  }

  clear(botId: string, threadId: string): void {
    this.write(this.read().filter((p) => !(p.botId === botId && p.threadId === threadId)));
  }
}

/** A gravacao salva (sem valores secretos) para refazer o rascunho. */
export function loadTeachRecording(dir: string, botId: string, recId: string): TeachRecording | null {
  if (!ID_RE.test(botId) || !ID_RE.test(recId)) return null;
  try {
    const raw = JSON.parse(readFileSync(join(dir, botId, recId, "recording.json"), "utf8")) as TeachRecording;
    return raw && Array.isArray(raw.steps) ? raw : null;
  } catch { return null; }
}
