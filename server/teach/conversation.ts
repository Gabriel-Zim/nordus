// Nordus: ensinar uma tarefa (frente G). A conversa depois de gravar: o robo resume e pergunta "Salvo como tarefa?",
// e a resposta de uma pessoa administradora (sim, nao, muda X) instala, descarta ou refaz. Tudo com dependencias injetadas.
import type { Message } from "../store.ts";
import type { ResolvedSender } from "../../shared/wire.ts";
import type { TeachRecording } from "../../shared/teach.ts";
import {
  botAskedToBeShown, fallbackTeachDraft, parseTeachDraft, teachPrompt, teachSkillMd, uniqueTeachName,
  type TaughtForPrompt, type TeachDraft,
} from "./draft.ts";
import { classifyTeachReply, loadTeachRecording, type TeachPendingStore } from "./pending.ts";
import type { TeachRecorder } from "./recorder.ts";
import type { TaughtStore } from "./repeat.ts";

export interface TeachConversationDeps {
  dir: string;
  recorder: TeachRecorder;
  pending: TeachPendingStore;
  taught: TaughtStore;
  now?(): number;
  /** A fala do robo na conversa. */
  botSays(botId: string, threadId: string, text: string): Message;
  /** A fala da pessoa, gravada como qualquer mensagem. */
  personSays(threadId: string, text: string, sendId: string | undefined, sender: ResolvedSender | undefined): Message;
  /** Ultima fala de texto do robo na conversa: serve para saber se ele travou e pediu ajuda, e se a pergunta ainda e a mais recente. */
  lastBotMessage(threadId: string): { id: string; text: string } | undefined;
  /** Texto do modelo leve (job skill-review), ou null quando nao ha modelo. */
  generateText(botId: string, prompt: string): Promise<string | null>;
  skills: {
    names(botId: string): string[];
    read(botId: string, name: string): string | null;
    install(botId: string, name: string, skillMd: string): { error: string } | { ok: true };
    remove(botId: string, name: string): void;
    enable(botId: string, name: string): { error: string } | { ok: true };
  };
  log?(line: string): void;
}

/** Tempo que o modelo leve tem para redigir o rascunho. */
export const TEACH_MODEL_TIMEOUT_MS = 90_000;

export function askLine(draft: TeachDraft): string {
  return draft.updates
    ? `Aprendi o trecho novo: ${draft.sentence}. Atualizo a tarefa "${draft.updates}"?`
    : `Aprendi: ${draft.sentence}. Salvo como tarefa?`;
}

export interface TeachReceipt { ok: true; threadId: string; message: Message }

export function createTeachConversation(deps: TeachConversationDeps) {
  const now = () => (deps.now ?? Date.now)();

  async function makeDraft(recording: TeachRecording, extra: { change?: string; previous?: TeachDraft } = {}): Promise<TeachDraft | null> {
    const lastBotLine = deps.lastBotMessage(recording.threadId)?.text;
    const wantsSnippet = botAskedToBeShown(lastBotLine);
    const taught: TaughtForPrompt[] = deps.taught.list(recording.botId).map((entry) => {
      const text = wantsSnippet ? deps.skills.read(recording.botId, entry.name) : null;
      return { name: entry.name, description: entry.description, ...(text ? { text } : {}) };
    });
    let model: string | null = null;
    try {
      model = await deps.generateText(recording.botId, teachPrompt({ recording, lastBotLine, taught, change: extra.change, previous: extra.previous }));
    } catch (error) {
      deps.log?.(`teach: modelo indisponivel (${error instanceof Error ? error.message : String(error)}); usando o resumo simples`);
    }
    const parsed = model ? parseTeachDraft(model) : null;
    if (!parsed && extra.previous) return null; // pedido de ajuste sem modelo: nao troca o rascunho por um generico
    const draft = parsed ?? fallbackTeachDraft(recording);
    if (draft.updates && !taught.some((t) => t.name === draft.updates)) delete draft.updates;
    return draft;
  }

  /** Depois do "Parar de gravar": resume, pergunta e deixa o pendente. Sempre libera o "pensando" da interface. */
  async function finishRecording(recording: TeachRecording): Promise<void> {
    const { botId, threadId } = recording;
    try {
      if (!recording.steps.length) {
        deps.botSays(botId, threadId, "Não vi nenhum passo nessa gravação. Quer tentar de novo?");
        return;
      }
      const draft = (await makeDraft(recording))!;
      const asked = deps.botSays(botId, threadId, askLine(draft));
      deps.pending.set({ botId, threadId, recId: recording.id, draft, askedMessageId: asked.id, at: now() });
    } catch (error) {
      deps.log?.(`teach: nao consegui resumir a gravacao: ${error instanceof Error ? error.message : String(error)}`);
      deps.botSays(botId, threadId, "Não consegui resumir o que você me mostrou. Pode gravar de novo?");
    } finally {
      deps.recorder.done(botId);
    }
  }

  function save(botId: string, draft: TeachDraft, recording: TeachRecording): { error: string } | { name: string; updated: boolean } {
    const own = deps.skills.names(botId);
    const taughtNames = deps.taught.list(botId).map((e) => e.name);
    const updating = draft.updates && taughtNames.includes(draft.updates) && own.includes(draft.updates) ? draft.updates : undefined;
    const name = updating ?? uniqueTeachName(draft.name, own);
    const md = teachSkillMd({ ...draft, name, updates: undefined }, recording);
    const previousText = updating ? deps.skills.read(botId, updating) : null;
    if (updating) deps.skills.remove(botId, updating);
    const installed = deps.skills.install(botId, name, md);
    if ("error" in installed) {
      if (updating && previousText) { deps.skills.install(botId, updating, previousText); deps.skills.enable(botId, updating); }
      return { error: installed.error };
    }
    const enabled = deps.skills.enable(botId, name);
    if ("error" in enabled) return { error: enabled.error };
    const previous = deps.taught.list(botId).find((e) => e.name === name);
    deps.taught.put(botId, {
      name, description: draft.description, trigger: updating && previous ? previous.trigger : draft.trigger, taughtAt: now(),
    });
    return { name, updated: !!updating };
  }

  /** A resposta a "Salvo como tarefa?". Devolve null quando a mensagem deve seguir o fluxo normal. */
  async function answer(input: { botId: string; threadId: string; text: string; sendId?: string; sender?: ResolvedSender }): Promise<TeachReceipt | null> {
    const { botId, threadId, text, sendId, sender } = input;
    // So pessoa administradora responde: o carimbo vem do servidor, nunca do texto.
    if (sender?.admin !== true) return null;
    const pending = deps.pending.get(botId, threadId);
    if (!pending) return null;
    // Se o robo falou outra coisa depois da pergunta, um "sim" responde a essa outra coisa.
    if (deps.lastBotMessage(threadId)?.id !== pending.askedMessageId) return null;
    const reply = classifyTeachReply(text);
    if (reply === "other") return null;
    const message = deps.personSays(threadId, text, sendId, sender);
    const clear = () => deps.pending.clear(botId, threadId);
    if (reply === "no") {
      clear();
      deps.botSays(botId, threadId, "Tudo bem, descartei.");
      return { ok: true, threadId, message };
    }
    const recording = loadTeachRecording(deps.dir, botId, pending.recId);
    if (!recording) {
      clear();
      deps.botSays(botId, threadId, "Não achei mais a gravação. Pode ensinar de novo?");
      return { ok: true, threadId, message };
    }
    if (reply === "yes") {
      const saved = save(botId, pending.draft, recording);
      if ("error" in saved) {
        // O pendente fica: a pessoa pode tentar de novo ou pedir outro nome.
        deps.botSays(botId, threadId, `Não consegui salvar a tarefa: ${saved.error}. Quer mudar alguma coisa?`);
      } else {
        clear();
        deps.botSays(botId, threadId, saved.updated
          ? `Pronto, atualizei a tarefa. É só pedir: "${pending.draft.trigger}".`
          : `Pronto, salvei como tarefa. É só pedir: "${pending.draft.trigger}".`);
      }
      return { ok: true, threadId, message };
    }
    // "muda X": refaz o rascunho com o ajuste e pergunta de novo.
    const draft = await makeDraft(recording, { change: reply.change, previous: pending.draft });
    if (!draft) {
      deps.botSays(botId, threadId, "Não consegui refazer agora. Quer salvar como está ou descartar?");
      return { ok: true, threadId, message };
    }
    const asked = deps.botSays(botId, threadId, askLine(draft));
    deps.pending.set({ ...pending, draft, askedMessageId: asked.id, at: now() });
    return { ok: true, threadId, message };
  }

  return { finishRecording, answer };
}
