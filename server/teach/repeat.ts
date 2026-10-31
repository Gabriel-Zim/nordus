// Nordus: ensinar uma tarefa (frente G). Repetir uma tarefa ensinada: reconhece o pedido e manda o robo seguir o SKILL.md no navegador.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface TaughtTask { name: string; description: string; trigger: string; path: string }
export interface TaughtEntry { name: string; description: string; trigger: string; taughtAt: number }

const ID_RE = /^[\w-]{1,64}$/;

/** A lista das tarefas ensinadas de um robo, em dir/<botId>/taught.json (a skill em si mora no armazem de skills). */
export class TaughtStore {
  private dir: string;
  constructor(dir: string) { this.dir = dir; }

  list(botId: string): TaughtEntry[] {
    if (!ID_RE.test(botId)) return [];
    try {
      const raw = JSON.parse(readFileSync(join(this.dir, botId, "taught.json"), "utf8")) as unknown;
      return Array.isArray(raw) ? (raw as TaughtEntry[]).filter((e) => e && typeof e.name === "string" && typeof e.trigger === "string") : [];
    } catch { return []; }
  }

  /** Acrescenta ou troca (pelo nome). */
  put(botId: string, entry: TaughtEntry): void {
    if (!ID_RE.test(botId)) return;
    const folder = join(this.dir, botId);
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    const file = join(folder, "taught.json");
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify([...this.list(botId).filter((e) => e.name !== entry.name), entry], null, 2), { mode: 0o600 });
    renameSync(tmp, file);
  }

  remove(botId: string, name: string): void {
    if (!ID_RE.test(botId)) return;
    const rest = this.list(botId).filter((e) => e.name !== name);
    const file = join(this.dir, botId, "taught.json");
    try { writeFileSync(file, JSON.stringify(rest, null, 2), { mode: 0o600 }); } catch {}
  }
}

const STOP = new Set([
  "a", "o", "as", "os", "um", "uma", "de", "do", "da", "dos", "das", "no", "na", "em", "para", "pra", "por", "com", "e", "que", "faz", "fazer", "faca", "aquela", "aquele",
  "tarefa", "novo", "nova", "repete", "repetir", "mesma", "mesmo", "agora", "favor", "ensinei", "voce", "pode", "me", "la", "ai", "do", "site",
]);
const CUE = /\b(aquela|aquele|tarefa|de novo|novamente|repete|repetir|repita|mesma|ensinei)\b/;

function plain(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

function keywords(text: string): string[] {
  return plain(text).split(" ").filter((w) => w.length >= 4 && !STOP.has(w));
}

/** O quanto o pedido casa com a tarefa: 100 quando contem o gatilho; senao as palavras que a frase tem em comum (precisa de um "aquela/tarefa/de novo/repete"). */
function score(request: string, task: TaughtTask): number {
  const text = plain(request);
  const trigger = plain(task.trigger);
  if (trigger.length >= 6 && (text === trigger || ` ${text} `.includes(` ${trigger} `))) return 100;
  if (!CUE.test(text)) return 0;
  const words = new Set(text.split(" "));
  const own = new Set([...keywords(task.name.replace(/-/g, " ")), ...keywords(task.description), ...keywords(task.trigger)]);
  let common = 0;
  for (const w of own) if (words.has(w)) common++;
  return common;
}

/** Cada nota termina com a ordem de seguir o SKILL.md; aqui so a nota, para quem a junta ao texto de outro jeito. */
export function taughtTaskNote(task: TaughtTask): string {
  return `[Tarefa ensinada: ${task.name}] Leia ${JSON.stringify(task.path)} e faça os passos no seu navegador (ferramentas de navegador), na ordem, conferindo cada ponto de conferência. ` +
    "Antes de passo marcado para aprovação, pergunte na conversa e espere o sim. " +
    'Se a página mudou e você não achar um elemento, pare e peça: "Me mostra só onde fica <elemento>."';
}

/** A tarefa ensinada que o pedido pede, ou null (sem relacao, ou mais de uma igualmente provavel). */
export function matchTaughtTask(text: string, taught: TaughtTask[]): TaughtTask | null {
  if (!text.trim() || text.trimStart().startsWith("/")) return null;
  const scored = taught.map((task) => ({ task, score: score(text, task) })).filter((s) => s.score > 0).sort((a, b) => b.score - a.score);
  if (!scored.length) return null;
  if (scored.length > 1 && scored[0]!.score === scored[1]!.score && scored[0]!.score < 100) return null;
  return scored[0]!.task;
}

/** O texto do turno: o pedido original mais a ordem de repetir a tarefa; null quando o pedido nao e de uma tarefa ensinada. */
export function taughtTaskTurnText(text: string, taught: TaughtTask[]): string | null {
  const task = matchTaughtTask(text, taught);
  return task ? `${text}\n\n${taughtTaskNote(task)}` : null;
}
