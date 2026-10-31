import { describe, expect, it } from "vitest";
import { parseSkillMd } from "../../shared/skill-md.ts";
import type { TeachRecording, TeachStep } from "../../shared/teach.ts";
import { botAskedToBeShown, fallbackTeachDraft, parseTeachDraft, teachPrompt, teachSkillMd, uniqueTeachName } from "./draft.ts";

const url = "https://suporte.exemplo.com/caixa";
const step = (n: number, action: TeachStep["action"], extra: Partial<TeachStep> = {}): TeachStep => ({ n, at: n, url, title: "Suporte", action, ...extra });

const recording: TeachRecording = {
  id: "rec1", botId: "b", threadId: "t", startedAt: 0, endedAt: 9,
  steps: [
    step(1, { kind: "navigate", url }),
    step(2, { kind: "click", text: "Responder", role: "button", selector: "#r" }),
    step(3, { kind: "type", field: "Mensagem", selector: "#m", value: "Oi, já resolvemos." }),
    step(4, { kind: "click", text: "Enviar", role: "button", selector: "#e" }, { critical: true }),
  ],
};

describe("fallbackTeachDraft e teachSkillMd", () => {
  it("gera um SKILL.md valido com as secoes e o passo Enviar nas aprovacoes", () => {
    const draft = fallbackTeachDraft(recording);
    expect(draft.name).toBe("tarefa-suporte-exemplo-com-4");
    const md = teachSkillMd(draft, recording);
    const parsed = parseSkillMd(md);
    expect("error" in parsed).toBe(false);
    if ("error" in parsed) return;
    expect(parsed.name).toBe(draft.name);
    for (const title of ["## Objetivo", "## Quando usar", "## Passos", "## Pontos de conferência", "## Se a página mudar", "## Ações que pedem aprovação"]) expect(md).toContain(title);
    expect(md).toContain('1. Abrir suporte.exemplo.com/caixa');
    expect(md).toContain('2. Clicar em "Responder" (papel: button; seletor: #r');
    expect(md).toMatch(/## Ações que pedem aprovação\n- Passo 4: Clicar em "Enviar"/);
    expect(md).toContain("Me mostra só onde fica");
    expect(md).not.toContain("## Login");
    // Tarefa ensinada se pede em palavras: nada do cabecalho de comando escrito (/nome) em ingles.
    expect(md).not.toContain("A command the user wrote");
    expect(md).not.toContain(`# /${draft.name}`);
    expect(md).toContain("Tarefa ensinada pela pessoa no navegador do robô.");
  });

  it("passos secretos viram a secao Login, sem valor", () => {
    const rec: TeachRecording = { ...recording, steps: [...recording.steps, step(5, { kind: "type-secret", field: "Senha", selector: "#p", secret: "password", site: "suporte.exemplo.com" })] };
    const md = teachSkillMd(fallbackTeachDraft(rec), rec);
    expect(md).toContain("## Login");
    expect(md).toContain("Chaveiro");
    expect(md).toContain("Digitar a senha do site suporte.exemplo.com");
    expect(md).toContain("Nunca peça senha ou código no chat");
  });
});

describe("parseTeachDraft", () => {
  it("le JSON do modelo, inclusive com texto em volta e cerca de codigo", () => {
    const out = parseTeachDraft('Claro! Aqui vai:\n```json\n{"name":"Responder suporte","description":"Responde a conversa mais antiga.","sentence":"Aprendi: responder a conversa mais antiga do suporte.","trigger":"faz aquela do suporte","objective":"Responder o suporte","steps":["Abrir a caixa do suporte","Clicar em Responder"],"checks":["A conversa abriu"]}\n```\nPronto.');
    expect(out).not.toBeNull();
    expect(out!.name).toBe("responder-suporte");
    expect(out!.sentence).toBe("responder a conversa mais antiga do suporte");
    expect(out!.trigger).toBe("faz aquela do suporte");
    expect(out!.instructions).toContain("1. Abrir a caixa do suporte");
    expect(out!.instructions).toContain("## Pontos de conferência");
  });

  it("devolve null para lixo e aceita chaves dentro de texto", () => {
    expect(parseTeachDraft("sem json")).toBeNull();
    expect(parseTeachDraft('{"sentence":"x"}')).toBeNull();
    expect(parseTeachDraft('{"sentence":"abrir {a}","steps":["um"]}')).not.toBeNull();
  });

  it("guarda updates quando e nome de skill valido", () => {
    expect(parseTeachDraft('{"sentence":"achar o botao","steps":["x"],"updates":"minha-tarefa"}')!.updates).toBe("minha-tarefa");
  });
});

describe("teachPrompt e nomes", () => {
  it("o prompt nao leva segredo e pede so JSON; ajuste e trecho entram", () => {
    const prompt = teachPrompt({ recording, taught: [{ name: "x", description: "y" }], change: "mais curto", lastBotLine: 'Me mostra só onde fica "Enviar".' });
    expect(prompt).toContain("SOMENTE com um objeto JSON");
    expect(prompt).toContain("Ajuste pedido pela pessoa: mais curto");
    expect(prompt).toContain("updates");
    expect(botAskedToBeShown('Me mostra só onde fica o botão.')).toBe(true);
    expect(botAskedToBeShown("Oi")).toBe(false);
  });

  it("uniqueTeachName evita colisao", () => {
    expect(uniqueTeachName("a", [])).toBe("a");
    expect(uniqueTeachName("a", ["a", "a-2"])).toBe("a-3");
  });
});
