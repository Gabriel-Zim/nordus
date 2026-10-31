import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TaughtStore, taughtTaskTurnText, type TaughtTask } from "./repeat.ts";

const suporte: TaughtTask = { name: "responder-suporte", description: "Responde a conversa mais antiga do suporte.", trigger: "faz aquela do suporte", path: "/ws/skills/responder-suporte/SKILL.md" };
const financeiro: TaughtTask = { name: "baixar-extrato", description: "Baixa o extrato do financeiro.", trigger: "baixa o extrato", path: "/ws/skills/baixar-extrato/SKILL.md" };

describe("taughtTaskTurnText", () => {
  it("o gatilho manda ler o SKILL.md e usar o navegador", () => {
    const out = taughtTaskTurnText("Faz aquela do suporte, por favor", [suporte, financeiro])!;
    expect(out).toContain("Faz aquela do suporte, por favor");
    expect(out).toContain('"/ws/skills/responder-suporte/SKILL.md"');
    expect(out).toContain("navegador");
    expect(out).toContain("pergunte na conversa e espere");
    expect(out).toContain("Me mostra só onde fica <elemento>.");
  });
  it("casa pelo nome quando a frase tem aquela, tarefa, de novo ou repete", () => {
    expect(taughtTaskTurnText("repete a tarefa do suporte", [suporte, financeiro])).toContain("responder-suporte");
    expect(taughtTaskTurnText("faz de novo aquele extrato", [suporte, financeiro])).toContain("baixar-extrato");
  });
  it("texto sem relacao vira null", () => {
    expect(taughtTaskTurnText("quanto custa o plano?", [suporte])).toBeNull();
    expect(taughtTaskTurnText("o suporte respondeu hoje", [suporte])).toBeNull();
    expect(taughtTaskTurnText("/goal faz isso", [suporte])).toBeNull();
    expect(taughtTaskTurnText("faz aquela tarefa", [suporte, financeiro])).toBeNull();
  });
});

describe("TaughtStore", () => {
  let dir = "";
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });
  it("guarda e troca pelo nome", () => {
    dir = mkdtempSync(join(tmpdir(), "taught-"));
    const store = new TaughtStore(dir);
    store.put("b", { name: "a", description: "d", trigger: "t", taughtAt: 1 });
    store.put("b", { name: "a", description: "d2", trigger: "t2", taughtAt: 2 });
    store.put("b", { name: "c", description: "d", trigger: "t", taughtAt: 3 });
    expect(store.list("b").map((e) => [e.name, e.description])).toEqual([["a", "d2"], ["c", "d"]]);
    expect(store.list("../x")).toEqual([]);
  });
});
