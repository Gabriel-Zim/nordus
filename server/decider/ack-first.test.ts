import { describe, expect, it, vi } from "vitest";

import { ACK_LINES, ackLine, ackNote, needsWork, quickMessage } from "./ack-first.ts";

const answer = (work: number, kind: string, pTop: number) => ({
  ask: vi.fn(async () => ({ ok: true, provider: "jev", latencyMs: 150, answers: { work: { type: "yesno", p: work }, kind: { type: "choice", choice: kind, pTop, margin: 0.3, probabilities: { [kind]: pTop } } } })),
}) as any;

describe("immediate line before work", () => {
  it("has fifty short phrases in six kinds, with no name, dash or jargon", () => {
    const all = Object.values(ACK_LINES).flat();
    expect(all.length).toBe(50);
    expect(new Set(all).size).toBe(50);
    for (const line of all) {
      expect(line.length).toBeLessThan(40);
      expect(line).not.toMatch(/—|\{name\}|Avery/);
    }
    expect(all.filter((line) => line.startsWith("Pode deixar")).length).toBeLessThanOrEqual(3);
  });

  it("never asks for greetings, thanks and okays", async () => {
    for (const text of ["ok", "valeu!", "bom dia", "Obrigado.", "👍"]) expect(quickMessage(text)).toBe(true);
    const decider = answer(1, "check", 1);
    expect(await needsWork(decider, "bom dia")).toBeNull();
    expect(decider.ask).not.toHaveBeenCalled();
  });

  it("one call says whether work is needed and what kind of request it is", async () => {
    const decider = answer(0.9, "reminder", 0.85);
    expect(await needsWork(decider, "me lembra de cancelar o UNIVERSAL+ em 6 dias")).toBe("reminder");
    expect(decider.ask.mock.calls[0]![0]).toBe("ackFirst");
    expect(await needsWork(answer(0.3, "check", 0.9), "qual é a capital da França?")).toBeNull();
    expect(await needsWork(answer(0.9, "creative", 0.4), "faz algo")).toBe("check");
    expect(await needsWork({ ask: vi.fn(async () => ({ ok: false, reason: "timeout" })) } as any, "checa a agenda")).toBeNull();
  });

  it("rotates inside the kind and never repeats the last line", () => {
    expect(ackLine("reminder", 0)).toBe("Anotado, te lembro.");
    expect(ackLine("reminder", 1)).toBe("Combinado, vou agendar.");
    expect(ackLine("reminder", 0, "Anotado, te lembro.")).toBe("Combinado, vou agendar.");
    expect(new Set([0, 1, 2, 3, 4].map((turn) => ackLine("check", turn))).size).toBe(5);
  });

  it("tells the bot the line was sent", () => {
    expect(ackNote("Anotado, te lembro.")).toContain("Do not write another acknowledgement");
  });
});
