import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { classifyTeachReply, PENDING_TTL_MS, TeachPendingStore } from "./pending.ts";

describe("classifyTeachReply", () => {
  it("sim", () => {
    for (const t of ["sim", "Sim!", "pode salvar", "Pode", "salva", "isso", "ok", "Beleza", "manda ver", "yes", "s"]) expect(classifyTeachReply(t)).toBe("yes");
  });
  it("nao", () => {
    for (const t of ["não", "nao", "Não.", "descarta", "deixa", "esquece", "cancela", "no"]) expect(classifyTeachReply(t)).toBe("no");
  });
  it("muda", () => {
    expect(classifyTeachReply("muda o texto para X")).toEqual({ change: "muda o texto para X" });
    expect(classifyTeachReply("Na verdade, responda em inglês")).toEqual({ change: "Na verdade, responda em inglês" });
    expect(classifyTeachReply("sim, mas muda o nome")).toEqual({ change: "sim, mas muda o nome" });
  });
  it("outra coisa segue o fluxo normal", () => {
    for (const t of ["", "quanto custa o plano?", "deixa eu ver isso depois com calma", "sim eu acho que a gente pode conversar sobre isso depois"]) expect(classifyTeachReply(t)).toBe("other");
  });
});

describe("TeachPendingStore", () => {
  let dir = "";
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });
  it("guarda um por conversa e expira em 24 h", () => {
    dir = mkdtempSync(join(tmpdir(), "pend-"));
    let now = 1_000;
    const store = new TeachPendingStore(dir, () => now);
    const draft = { name: "a", description: "d", sentence: "s", trigger: "t", instructions: "i" };
    store.set({ botId: "b", threadId: "t1", recId: "r1", draft, askedMessageId: "m", at: now });
    store.set({ botId: "b", threadId: "t1", recId: "r2", draft, askedMessageId: "m2", at: now });
    expect(store.get("b", "t1")?.recId).toBe("r2");
    expect(store.get("b", "t2")).toBeNull();
    now += PENDING_TTL_MS + 1;
    expect(store.get("b", "t1")).toBeNull();
  });
});
