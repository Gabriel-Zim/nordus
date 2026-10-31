import { commandDoing, lowerGerund, runningCommand, type CommandKind } from "../shared/command-words.ts";
import type { WorkStepLine } from "../shared/work-steps.ts";
import type { Store } from "./store.ts";

export const LONG_COMMAND_NOTICE_MS = 120_000;

/** The same lines the chat shows (src/locales/pt-br.json `command.kind.*`); a test keeps the two from drifting. */
export const COMMAND_WORDS_PT: Record<CommandKind, string> = {
  allTests: "Rodando todos os testes",
  someTests: "Rodando alguns testes",
  typeCheck: "Conferindo o código",
  lint: "Conferindo o padrão do código",
  install: "Instalando o que o projeto precisa",
  build: "Montando o app",
  gitPush: "Enviando o código",
  gitPull: "Baixando o código atualizado",
  gitMerge: "Juntando versões do código",
  gitCommit: "Salvando uma versão do código",
  video: "Processando o vídeo",
  transcribe: "Transcrevendo o áudio",
  web: "Acessando um endereço na internet",
  copyFiles: "Copiando arquivos",
  remote: "Trabalhando em outro computador",
  wait: "Esperando um pouco",
};

export const COMMAND_FALLBACK_PT = "Rodando um comando";

function agoPt(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  return minutes < 60 ? `há ${minutes} min` : `há ${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`;
}

/** What the bot says when a message reaches it while one command holds the turn, or null while that is still short. */
export function longCommandNotice({ step, command, since, now, queued }: {
  step?: string;
  command: string;
  since: number;
  now: number;
  queued: boolean;
}): string | null {
  const elapsed = now - since;
  if (elapsed < LONG_COMMAND_NOTICE_MS) return null;
  const doing = commandDoing(command, step, (kind) => COMMAND_WORDS_PT[kind], COMMAND_FALLBACK_PT);
  const fate = queued
    ? "Sua mensagem está na fila e entra quando eu terminar."
    : "Leio sua mensagem assim que esse comando terminar.";
  return `Ainda estou ${lowerGerund(doing)}, ${agoPt(elapsed)}. ${fate} Se quiser interromper, use Parar.`;
}

type PathMessage = Parameters<typeof runningCommand>[0][number];

/** The notice for a message that just reached a busy bot, from what the conversation holds now. */
export function longCommandNoticeFor({ busy, path, steps, now, queued }: {
  busy: boolean;
  path: readonly PathMessage[];
  steps?: readonly WorkStepLine[];
  now: number;
  queued: boolean;
}): { text: string; since: number } | null {
  if (!busy) return null;
  const running = runningCommand(path);
  if (!running) return null;
  const step = steps?.findLast((line) => line.text?.trim())?.text;
  const text = longCommandNotice({ step, command: running.command, since: running.since, now, queued });
  return text ? { text, since: running.since } : null;
}

/** A burst of messages inside this window gets one notice, rewritten; a message after it gets its own, under it. */
export const NOTICE_REWRITE_MS = 60_000;
const REMEMBERED_THREADS = 1_000;

type NoticeStore = Pick<Store, "activePath" | "appendMessage" | "patchMessage">;

/** The bot's answer, at once, to a person who writes while one long command holds its turn. */
export class LongCommandNotices {
  private readonly posted = new Map<string, { since: number; at: number; messageId: string }>();
  private readonly store: NoticeStore;

  constructor(store: NoticeStore) {
    this.store = store;
  }

  say(threadId: string, { busy, steps, now, queued }: { busy: boolean; steps?: readonly WorkStepLine[]; now: number; queued: boolean }): void {
    const notice = longCommandNoticeFor({ busy, path: this.store.activePath(threadId), steps, now, queued });
    if (!notice) return;
    const last = this.posted.get(threadId);
    if (last && last.since === notice.since && now - last.at < NOTICE_REWRITE_MS && this.store.patchMessage(threadId, last.messageId, { text: notice.text })) return;
    const message = this.store.appendMessage(threadId, { role: "bot", kind: "text", text: notice.text, quickAck: true, at: now });
    this.posted.delete(threadId);
    this.posted.set(threadId, { since: notice.since, at: now, messageId: message.id });
    if (this.posted.size > REMEMBERED_THREADS) this.posted.delete(this.posted.keys().next().value!);
  }
}
