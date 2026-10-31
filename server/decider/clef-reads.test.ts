import { describe, expect, it, vi } from "vitest";

import {
  readApprovalReply, readNeedsInput, readNothingNew, readReactionOption, readSpokenConsent, readTurnErrorClass,
} from "./clef-reads.ts";
import type { Decider } from "./index.ts";

const yes = (p: number) => ({ ok: true as const, provider: "clef" as const, answers: { answer: { type: "yesno" as const, p } }, latencyMs: 5 });
const picked = (choice: string, pTop: number, margin: number) =>
  ({ ok: true as const, provider: "clef" as const, answers: { type: "choice" as const, choice, pTop, margin, probabilities: {} }, latencyMs: 5 });
const failed = { ok: false as const, reason: "timeout" as const };

function asker(result: unknown) {
  const ask = vi.fn().mockResolvedValue(result);
  return { decider: { ask } as unknown as Pick<Decider, "ask">, ask };
}
function chooser(result: unknown) {
  const choose = vi.fn().mockResolvedValue(result);
  return { decider: { choose } as unknown as Pick<Decider, "choose">, choose };
}

describe("approval and voice readings", () => {
  it("ask a noul on their own job with the question and the reply, secrets cut out", async () => {
    const { decider, ask } = asker(yes(0.97));
    await expect(readApprovalReply(decider, "pode mandar, ficou ótimo", "Posso enviar o e-mail para ana@x.com? token sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")).resolves.toBe(0.97);
    const [seam, state, questions] = ask.mock.calls[0]!;
    expect(seam).toBe("replyReading");
    expect(state.resposta_da_pessoa).toBe("pode mandar, ficou ótimo");
    expect(JSON.stringify(state)).not.toContain("AAAAAAAAAAAAAAAAAAAAAAAA");
    expect(questions.answer).toMatchObject({ type: "yesno", criteria: { yes: expect.any(String), no: expect.any(String) } });
  });

  it("are null on any failure, and a throw is a null too", async () => {
    await expect(readApprovalReply(asker(failed).decider, "x", "y?")).resolves.toBeNull();
    const ask = vi.fn().mockRejectedValue(new Error("boom"));
    await expect(readSpokenConsent({ ask } as unknown as Pick<Decider, "ask">, "sim pode", "May I?")).resolves.toBeNull();
  });

  it("voice goes on its own job", async () => {
    const { decider, ask } = asker(yes(0.9));
    await readSpokenConsent(decider, "sim, pode", "I want to run a command. May I?");
    expect(ask.mock.calls[0]![0]).toBe("voiceConsent");
  });
});

describe("reaction reading", () => {
  const input = { question: "Quando publico?", options: ["Publicar hoje", "Deixar para amanhã"], answer: "yes" as const };

  it("returns the option the model picks with room to spare", async () => {
    const { decider, choose } = chooser(picked("o0", 0.93, 0.86));
    await expect(readReactionOption(decider, input)).resolves.toBe("Publicar hoje");
    expect(choose.mock.calls[0]![0]).toBe("reactionReading");
    expect(Object.keys(choose.mock.calls[0]![2].options)).toEqual(["o0", "o1", "nenhuma"]);
  });

  it.each([
    ["no option fits", picked("nenhuma", 0.95, 0.9)],
    ["it is not sure", picked("o1", 0.7, 0.5)],
    ["two are close", picked("o1", 0.86, 0.1)],
    ["the call failed", failed],
  ])("is null when %s", async (_name, result) => {
    await expect(readReactionOption(chooser(result).decider, input)).resolves.toBeNull();
  });
});

describe("routine news", () => {
  it("is quiet only at 0.9 or more", async () => {
    await expect(readNothingNew(asker(yes(0.95)).decider, { reply: "Conferi os três sites: nada mudou desde ontem.", prompt: "Veja os sites" })).resolves.toBe(true);
    await expect(readNothingNew(asker(yes(0.85)).decider, { reply: "Conferi: nada mudou.", prompt: "x" })).resolves.toBe(false);
    await expect(readNothingNew(asker(failed).decider, { reply: "Conferi: nada mudou.", prompt: "x" })).resolves.toBe(false);
  });

  it("never asks about a reply with a question, a NEEDS INPUT, or a long report", async () => {
    const { decider, ask } = asker(yes(0.99));
    await expect(readNothingNew(decider, { reply: "Nada mudou. Quer que eu olhe outro?", prompt: "x" })).resolves.toBe(false);
    await expect(readNothingNew(decider, { reply: "NEEDS INPUT: qual site", prompt: "x" })).resolves.toBe(false);
    await expect(readNothingNew(decider, { reply: "a".repeat(1_500), prompt: "x" })).resolves.toBe(false);
    expect(ask).not.toHaveBeenCalled();
  });
});

describe("needs input", () => {
  it("names the last question line when the model says the work waits on the person", async () => {
    await expect(readNeedsInput(asker(yes(0.95)).decider, "Fiz o rascunho.\nQual das duas fotos vai na capa?\nAssim que disser, eu sigo."))
      .resolves.toBe("Qual das duas fotos vai na capa?");
  });

  it("is undefined under 0.9 or on failure", async () => {
    await expect(readNeedsInput(asker(yes(0.6)).decider, "Pronto. Quer que eu faça a versão curta?")).resolves.toBeUndefined();
    await expect(readNeedsInput(asker(failed).decider, "Qual foto?")).resolves.toBeUndefined();
  });
});

describe("turn error class", () => {
  it("returns the class picked at 0.8 or more, never usage-limit, never other", async () => {
    const { decider, choose } = chooser(picked("engine-down", 0.9, 0.8));
    await expect(readTurnErrorClass(decider, "upstream returned garbage, worker died")).resolves.toBe("engine-down");
    expect(Object.keys(choose.mock.calls[0]![2].options)).not.toContain("usage-limit");
    await expect(readTurnErrorClass(chooser(picked("outro", 0.95, 0.9)).decider, "x")).resolves.toBeNull();
    await expect(readTurnErrorClass(chooser(picked("disk-full", 0.6, 0.3)).decider, "x")).resolves.toBeNull();
    await expect(readTurnErrorClass(chooser(failed).decider, "x")).resolves.toBeNull();
  });
});
