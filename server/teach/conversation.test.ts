import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseSkillMd } from "../../shared/skill-md.ts";
import type { TeachRecording, TeachStep } from "../../shared/teach.ts";
import type { ResolvedSender } from "../../shared/wire.ts";
import type { Message } from "../store.ts";
import { createTeachConversation } from "./conversation.ts";
import { TeachPendingStore } from "./pending.ts";
import { TeachRecorder } from "./recorder.ts";
import { TaughtStore } from "./repeat.ts";

const url = "https://suporte.exemplo.com/caixa";
const step = (n: number, action: TeachStep["action"], extra: Partial<TeachStep> = {}): TeachStep => ({ n, at: n, url, title: "Suporte", action, ...extra });
const recording: TeachRecording = {
  id: "rec1", botId: "bot1", threadId: "t1", startedAt: 0, endedAt: 9,
  steps: [
    step(1, { kind: "navigate", url }),
    step(2, { kind: "click", text: "Responder", role: "button", selector: "#r" }),
    step(3, { kind: "click", text: "Enviar", role: "button", selector: "#e" }, { critical: true }),
  ],
};
const admin: ResolvedSender = { name: "Avery", admin: true };
const guest: ResolvedSender = { name: "Visitante" };

let dir: string;
let said: Array<{ who: "bot" | "person"; text: string; id?: string }>;
let installed: Map<string, { text: string; enabled: boolean }>;
let modelAnswer: string | null;
let counter: number;

function setup() {
  const recorder = new TeachRecorder({ dir, cdpUrl: async () => null });
  const pending = new TeachPendingStore(dir);
  const taught = new TaughtStore(dir);
  const convo = createTeachConversation({
    dir, recorder, pending, taught,
    botSays: (_b, _t, text) => { const id = `m${++counter}`; said.push({ who: "bot", text, id }); return { id, at: 0, role: "bot", kind: "text", text } as Message; },
    personSays: (_t, text) => { said.push({ who: "person", text }); return { id: `m${++counter}`, at: 0, role: "user", kind: "text", text } as Message; },
    lastBotMessage: () => { const last = said.filter((s) => s.who === "bot").at(-1); return last ? { id: last.id!, text: last.text } : undefined; },
    generateText: async () => modelAnswer,
    skills: {
      names: () => [...installed.keys()],
      read: (_b, name) => installed.get(name)?.text ?? null,
      install: (_b, name, text) => {
        const parsed = parseSkillMd(text);
        if ("error" in parsed || parsed.name !== name) return { error: "SKILL.md invalido" };
        if (installed.has(name)) return { error: "ja existe" };
        installed.set(name, { text, enabled: false });
        return { ok: true };
      },
      remove: (_b, name) => { installed.delete(name); },
      enable: (_b, name) => { installed.get(name)!.enabled = true; return { ok: true }; },
    },
  });
  return { convo, pending, taught };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "teach-convo-"));
  said = []; installed = new Map(); modelAnswer = null; counter = 0;
  mkdirSync(join(dir, "bot1", "rec1"), { recursive: true });
  writeFileSync(join(dir, "bot1", "rec1", "recording.json"), JSON.stringify(recording));
});
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe("conversa de ensinar uma tarefa", () => {
  it("gravacao terminada: pergunta 'Salvo como tarefa?' e deixa pendente", async () => {
    const { convo, pending } = setup();
    await convo.finishRecording(recording);
    expect(said).toHaveLength(1);
    expect(said[0]!.text).toMatch(/^Aprendi: .+\. Salvo como tarefa\?$/);
    expect(pending.get("bot1", "t1")?.recId).toBe("rec1");
  });

  it("'sim' de admin instala e liga a skill, responde e nao abre turno", async () => {
    modelAnswer = '{"name":"responder-suporte","description":"Responde o suporte.","sentence":"responder a conversa do suporte","trigger":"faz aquela do suporte","steps":["Abrir a caixa do suporte","Clicar em Responder","Enviar"],"checks":["A conversa abriu"]}';
    const { convo, pending, taught } = setup();
    await convo.finishRecording(recording);
    expect(said[0]!.text).toBe("Aprendi: responder a conversa do suporte. Salvo como tarefa?");
    const receipt = await convo.answer({ botId: "bot1", threadId: "t1", text: "sim", sendId: "s1", sender: admin });
    expect(receipt).toMatchObject({ ok: true, threadId: "t1" });
    expect(installed.get("responder-suporte")?.enabled).toBe(true);
    expect(installed.get("responder-suporte")!.text).toContain("Passo 3: Clicar em \"Enviar\"");
    expect(said.at(-1)!.text).toBe('Pronto, salvei como tarefa. É só pedir: "faz aquela do suporte".');
    expect(pending.get("bot1", "t1")).toBeNull();
    expect(taught.list("bot1")).toMatchObject([{ name: "responder-suporte", trigger: "faz aquela do suporte" }]);
  });

  it("'sim' de quem nao e admin segue como mensagem normal", async () => {
    const { convo, pending } = setup();
    await convo.finishRecording(recording);
    for (const sender of [guest, undefined]) {
      expect(await convo.answer({ botId: "bot1", threadId: "t1", text: "sim", sender })).toBeNull();
    }
    expect(installed.size).toBe(0);
    expect(pending.get("bot1", "t1")).not.toBeNull();
  });

  it("se o robo falou outra coisa depois da pergunta, o 'sim' nao e da tarefa", async () => {
    const { convo, pending } = setup();
    await convo.finishRecording(recording);
    said.push({ who: "bot", text: "Posso enviar o e-mail?", id: "outra" });
    expect(await convo.answer({ botId: "bot1", threadId: "t1", text: "sim", sender: admin })).toBeNull();
    expect(installed.size).toBe(0);
    expect(pending.get("bot1", "t1")).not.toBeNull();
  });

  it("'nao' descarta e outra coisa segue normal", async () => {
    const { convo, pending } = setup();
    await convo.finishRecording(recording);
    expect(await convo.answer({ botId: "bot1", threadId: "t1", text: "qual o preço do plano pro?", sender: admin })).toBeNull();
    const receipt = await convo.answer({ botId: "bot1", threadId: "t1", text: "não", sender: admin });
    expect(receipt).not.toBeNull();
    expect(said.at(-1)!.text).toBe("Tudo bem, descartei.");
    expect(pending.get("bot1", "t1")).toBeNull();
    expect(installed.size).toBe(0);
  });

  it("'muda X' refaz o rascunho e pergunta de novo, mantendo pendente", async () => {
    modelAnswer = '{"name":"a-um","sentence":"primeira versao","steps":["x"],"trigger":"faz a um"}';
    const { convo, pending } = setup();
    await convo.finishRecording(recording);
    modelAnswer = '{"name":"a-dois","sentence":"segunda versao","steps":["y"],"trigger":"faz a dois"}';
    await convo.answer({ botId: "bot1", threadId: "t1", text: "muda o nome para a dois", sender: admin });
    expect(said.at(-1)!.text).toBe("Aprendi: segunda versao. Salvo como tarefa?");
    expect(pending.get("bot1", "t1")?.draft.name).toBe("a-dois");
    expect(installed.size).toBe(0);
  });

  it("sem modelo, o resumo simples dos passos serve", async () => {
    const { convo } = setup();
    await convo.finishRecording(recording);
    await convo.answer({ botId: "bot1", threadId: "t1", text: "pode salvar", sender: admin });
    expect([...installed.keys()][0]).toMatch(/^tarefa-suporte-exemplo-com-3$/);
  });

  it("nome repetido ganha sufixo e uma tarefa ensinada pode ser atualizada", async () => {
    installed.set("tarefa-suporte-exemplo-com-3", { text: "x", enabled: true });
    const { convo, taught } = setup();
    await convo.finishRecording(recording);
    await convo.answer({ botId: "bot1", threadId: "t1", text: "sim", sender: admin });
    expect(installed.has("tarefa-suporte-exemplo-com-3-2")).toBe(true);
    // atualizar
    modelAnswer = '{"name":"x","sentence":"achar o botao novo","steps":["novo"],"updates":"tarefa-suporte-exemplo-com-3-2"}';
    await convo.finishRecording(recording);
    expect(said.at(-1)!.text).toBe('Aprendi o trecho novo: achar o botao novo. Atualizo a tarefa "tarefa-suporte-exemplo-com-3-2"?');
    await convo.answer({ botId: "bot1", threadId: "t1", text: "sim", sender: admin });
    expect(installed.get("tarefa-suporte-exemplo-com-3-2")!.text).toContain("novo");
    expect(taught.list("bot1")).toHaveLength(1);
  });
});
